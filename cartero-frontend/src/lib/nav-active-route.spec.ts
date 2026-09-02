import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isNavItemActive, shouldNavigate } from './nav-active-route'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O item do menu aponta para uma superfície, não para uma URL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O bug: em `/persons`, abrir o menu e tocar em "Pessoas" disparava
 * navegação. O item era sempre um `<Link href="/persons">`, e a partir de
 * `/persons?personId=abc` isso é uma URL DIFERENTE — o Next iniciava uma
 * transição real que descartava o `personId` e deixava a tela num estado que
 * parecia carregamento perdido.
 *
 * A pergunta certa não é "a URL é a mesma?", e sim "já estou nesta tela?".
 */

describe('NAV-10: query params não quebram a detecção', () => {
  it('a superfície é reconhecida com qualquer query', () => {
    /*
      `?period=`, `?personId=`, `?highlight=` são ESTADOS da mesma tela. Se o
      item perdesse o destaque ao abrir um detalhe, a sidebar deixaria de
      dizer onde o usuário está.
    */
    for (const url of [
      '/persons',
      '/persons?period=2026-08',
      '/persons?personId=abc',
      '/persons?personId=abc&period=2026-09',
      '/persons#topo',
    ]) {
      expect(isNavItemActive('/persons', url), url).toBe(true)
    }
  })

  it('rotas diferentes não se confundem', () => {
    expect(isNavItemActive('/persons', '/banks')).toBe(false)
    expect(isNavItemActive('/banks', '/persons?personId=abc')).toBe(false)
  })

  it('sub-rota conta como a mesma superfície', () => {
    /* O histórico do cartão é parte de Bancos. */
    expect(isNavItemActive('/banks', '/banks/abc/invoices')).toBe(true)
  })

  it('não casa prefixo que não é fronteira de segmento', () => {
    /*
      O `startsWith` ingênuo faria `/banks` casar `/banksomething`. A
      fronteira `/` impede isso.
    */
    expect(isNavItemActive('/banks', '/banksomething')).toBe(false)
    expect(isNavItemActive('/debts', '/debts-archive')).toBe(false)
  })
})

describe('NAV-5/NAV-6: a rota ativa não navega de novo', () => {
  it('estando na superfície, não navega', () => {
    /* O caso exato do bug relatado. */
    expect(shouldNavigate('/persons', '/persons')).toBe(false)
    expect(shouldNavigate('/persons', '/persons?personId=abc')).toBe(false)
  })

  it('outra rota navega normalmente', () => {
    /*
      O risco ao corrigir o same-route é bloquear navegação legítima. Este
      caso é o contrapeso.
    */
    expect(shouldNavigate('/banks', '/persons')).toBe(true)
    expect(shouldNavigate('/overview', '/persons?personId=abc')).toBe(true)
  })

  it('NAV-11: repetir o clique é idempotente', () => {
    /*
      A resposta não depende de quantas vezes se pergunta — não há estado
      acumulado que possa prender a UI.
    */
    for (let i = 0; i < 5; i++) {
      expect(shouldNavigate('/persons', '/persons?personId=abc')).toBe(false)
    }
  })

  it('a decisão é o inverso exato do destaque', () => {
    /*
      Uma fonte, duas leituras. Se divergissem, o item poderia aparecer ativo
      e ainda assim navegar — que é o bug de volta.
    */
    for (const [href, path] of [
      ['/persons', '/persons?personId=abc'],
      ['/banks', '/banks/abc/invoices'],
      ['/banks', '/persons'],
      ['/overview', '/overview'],
    ] as const) {
      expect(shouldNavigate(href, path)).toBe(!isNavItemActive(href, path))
    }
  })
})

describe('o layout aplica a policy', () => {
  const LAYOUT = readFileSync(
    new URL('../app/(dashboard)/layout.tsx', import.meta.url),
    'utf-8',
  )
  const code = LAYOUT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('o destaque vem do helper, não de startsWith solto', () => {
    expect(code).toContain('isNavItemActive(href, pathname)')
    expect(code).not.toContain('pathname.startsWith(href)')
  })

  it('NAV-5: a rota ativa deixa de ser um Link', () => {
    /*
      `button` em vez de `Link` com `preventDefault`: o elemento passa a não
      ter destino, e não faz sentido oferecer "abrir em nova aba" para algo
      que não navega.
    */
    expect(code).toContain('active ? <button type="button" /> : <Link href={href} />')
  })

  it('NAV-8: o menu fecha em qualquer clique de item', () => {
    /* Vale para os dois ramos — navegando ou apenas fechando. */
    expect(code).toContain('if (isMobile) setOpenMobile(false)')
  })

  it('NAV-30: nada de reload como atalho', () => {
    /* A aplicação continua SPA. */
    expect(code).not.toContain('window.location.reload')
    expect(code).not.toContain('window.location.href')
    expect(code).not.toContain('router.refresh()')
  })
})

describe('NAV-1 a NAV-4: a saída do menu mobile', () => {
  const SIDEBAR = readFileSync(
    new URL('../components/ui/sidebar.tsx', import.meta.url),
    'utf-8',
  )
  const SHEET = readFileSync(
    new URL('../components/ui/sheet.tsx', import.meta.url),
    'utf-8',
  )
  const code = SIDEBAR.replace(/\/\*[\s\S]*?\*\//g, '')

  it('NAV-2: existe um X rotulado em português', () => {
    /*
      Havia um `[&>button]:hidden` escondendo o botão padrão do Sheet — e no
      mobile, com o painel cobrindo quase toda a largura, ele era a única
      saída óbvia. O substituto diz "Fechar menu", não "Close".
    */
    expect(code).toContain('aria-label="Fechar menu"')
    expect(code).toContain('<SheetClose')
    expect(code).not.toContain('[&>button]:hidden')
  })

  it('NAV-1: o painel deixa faixa de backdrop visível', () => {
    /*
      Eram 18rem fixos (288px), que numa tela de 390px cobriam quase tudo:
      sem "fora" visível, o menu parecia uma página nova.
    */
    expect(code).toContain('min(18rem, calc(100vw - 3rem))')
    /*
      `max-w` e não `w`: o `SheetContent` traz `data-[side=left]:w-full`, que
      é mais específico e vencia a largura da sidebar — o painel saía com a
      viewport inteira e o backdrop ficava em zero.
    */
    expect(code).toContain('max-w-(--sidebar-width)')
  })

  it('NAV-3/NAV-4: backdrop e Escape vêm da primitive', () => {
    /*
      O Sheet é um Radix Dialog: clique fora e Escape já fecham. Um listener
      manual duplicaria comportamento e poderia divergir.
    */
    expect(SHEET).toContain('SheetPrimitive.Backdrop')
    expect(SHEET).toContain('bg-black/10')
    expect(code).toContain('<Sheet open={openMobile} onOpenChange={setOpenMobile}')
  })

  it('NAV-12: o desktop não passa pelo Sheet', () => {
    /*
      As mudanças de largura e X vivem dentro do ramo `isMobile`. O desktop
      renderiza a sidebar fixa, sem overlay.
    */
    const mobile = code.slice(code.indexOf('if (isMobile) {'))
    expect(mobile).toContain('SIDEBAR_WIDTH_MOBILE')
    expect(mobile).toContain('data-mobile="true"')
  })
})
