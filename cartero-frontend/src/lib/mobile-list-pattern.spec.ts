import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Padrão mobile de lista — duas faixas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * FAIXA 1  identidade · valor · navegação
 * FAIXA 2  UMA metadata financeira, em largura cheia
 *
 * A metadata vivia DENTRO da coluna do título, dividindo espaço com o valor
 * e a seta, e levava `truncate`. Em ~390px a coluna fica estreita e o número
 * era cortado no meio — "R$ 35…" em vez de R$ 350,46. Esconder metade de uma
 * cifra é pior que não mostrá-la: o padrão prefere OMITIR detalhe de terceiro
 * nível (disponível no drawer) a exibi-lo pela metade.
 *
 * A suíte não tem DOM, então o alvo aqui é a COMPOSIÇÃO — as decisões
 * estruturais que sustentam o padrão.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')

const ROW = ler('../components/ui/status-list-row.tsx')
const BANKS = ler('../app/(dashboard)/banks/page.tsx')

describe('itens 2-3: o primitive tem duas faixas', () => {
  it('a metadata sai da coluna do título e ocupa a largura cheia', () => {
    expect(ROW).toContain('w-full text-[11px] leading-tight')
  })

  it('item 10: nenhum valor financeiro é truncado na metadata', () => {
    /*
      O `truncate` da metadata era a causa direta do "R$ 35…". Truncar o
      TÍTULO continua válido — nome longo é texto, não cifra.
    */
    expect(ROW).not.toContain('mt-0.5 truncate text-[11px]')
  })

  it('item 5: as linhas têm altura mínima comparável', () => {
    // Uma com metadata e outra sem não podem parecer tabelas diferentes.
    expect(ROW).toContain('min-h-[62px]')
  })

  it('itens 44-45: há retorno de toque, onde não existe hover', () => {
    expect(ROW).toContain('active:bg-muted/50')
  })

  it('item 41: título trunca, valor e seta não encolhem', () => {
    expect(ROW).toContain('truncate text-[13px] font-medium')
    expect(ROW).toContain('shrink-0 text-[13px] font-semibold')
  })
})

describe('Parte C: a row de Banco segue o padrão de Pessoas', () => {
  it('itens 25/49: a row inteira é um Link, não uma div inerte', () => {
    /*
      Antes era `<div>` sem handler: só o link "Faturas" no canto abria o
      banco. `Link` dá Enter/foco de graça.
    */
    expect(BANKS).toContain('href={`/banks/${bank.id}/invoices`}')
    expect(BANKS).not.toContain(
      'group flex items-center gap-4 border-b border-border px-1 py-4',
    )
  })

  it('item 26: o chevron fica junto do NOME', () => {
    // `pr-12` reserva a faixa do menu; o chevron não vai para o canto.
    expect(BANKS).toContain('pr-12')
  })

  it('item 27: o chevron é decorativo', () => {
    const trecho = BANKS.slice(
      BANKS.indexOf('<ChevronRight'),
      BANKS.indexOf('<ChevronRight') + 260,
    )
    expect(trecho).toContain('aria-hidden')
  })

  it('itens 29/50: o menu é IRMÃO do link, não filho', () => {
    /*
      `button` dentro de `a` é HTML inválido e quebra teclado. A sobreposição
      absoluta resolve sem aninhar, e `stopPropagation` impede que o toque no
      menu navegue.
    */
    expect(BANKS).toContain('absolute right-0 top-1/2')
    expect(BANKS).toContain('event.stopPropagation()')

    const linkFecha = BANKS.indexOf('</Link>')
    const menu = BANKS.indexOf('absolute right-0 top-1/2')
    expect(menu).toBeGreaterThan(linkFecha)
  })

  it('item 48: os rótulos acessíveis distinguem row e menu', () => {
    expect(BANKS).toContain('Abrir detalhes do ${bank.name}')
    expect(BANKS).toContain('Ações do ${bank.name}')
  })

  it('item 61: sem próxima fatura, nenhum R$ 0 é inventado', () => {
    // A metadata financeira só é montada quando existe fatura.
    expect(BANKS).toContain('{nearest !== null && (')
  })

  it('itens 36-37: o prazo truncado sai do mobile', () => {
    /*
      Ele levava `truncate` e concorria com a metadata financeira na mesma
      faixa — "Fecha em 3 di…" é informação pela metade. A data completa está
      no detalhe; lista é resumo.
    */
    expect(BANKS).toContain(
      'hidden truncate text-[11px] text-muted-foreground sm:inline',
    )
  })

  it('item 44: o alvo de toque do menu é confortável', () => {
    expect(BANKS).toContain('size-9 items-center justify-center')
  })
})
