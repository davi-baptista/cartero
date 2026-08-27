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
const BUDGET = ler('../app/(dashboard)/budget/page.tsx')

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

  it('itens 44-45: sem metadata, a altura vem só do padding', () => {
    /*
      O `min-h` existia para igualar linhas com e sem faixa secundária. Sem
      metadata nas três listas, ele virou espaço reservado para nada — e a
      altura já é a mesma para todas.
    */
    expect(ROW).not.toContain('min-h-[62px]')
    expect(ROW).toContain('items-center')
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

  it('item 34: sem próxima fatura, nenhum R$ 0 é inventado', () => {
    /*
      `NearestInvoiceAmount` devolve `null` quando não há fatura; o badge
      "Em dia" carrega o estado sozinho.
    */
    expect(BANKS).toContain('if (info === null)')
  })

  it('itens 30-31: a composição financeira sai da linha do banco', () => {
    /*
      Sua parte, terceiros e prazos vivem no detalhe da fatura. Na lista eles
      punham dois números a competir com o valor principal.
    */
    expect(BANKS).not.toContain('function NearestInvoiceSplit')
  })

  it('item 44: o alvo de toque do menu é confortável', () => {
    expect(BANKS).toContain('size-9 items-center justify-center')
  })
})

describe('itens 7/17/47: a lista não repete o drawer', () => {
  /**
   * Desktop E mobile: entidade, status, valor, seta. A composição vive no
   * cabeçalho (consolidado) e no drawer (detalhe) — repeti-la na linha punha
   * números a competir e dava a cada registro uma altura.
   */
  const linhasDoOrcamento = BUDGET.slice(
    BUDGET.indexOf('{visibleInvoices.map'),
    BUDGET.indexOf('Pendências anteriores'),
  )

  it('nenhuma das três listas passa `subtitle`', () => {
    expect(linhasDoOrcamento).not.toContain('subtitle=')
  })

  it('a composição da fatura saiu da linha', () => {
    expect(linhasDoOrcamento).not.toContain('Sua parte')
    expect(linhasDoOrcamento).not.toContain('de outras pessoas')
  })

  it('item 8: mas o CABEÇALHO continua consolidando', () => {
    // O dado não sumiu do produto — mudou de camada.
    expect(BUDGET).toContain('sua parte')
    expect(BUDGET).toContain('de outras pessoas')
  })

  it('item 56: o aria da pessoa carrega o que a linha não mostra', () => {
    expect(BUDGET).toContain('peopleRowAriaLabel(person, formatCurrency)')
  })

  it('itens 59-60: `subtitle` sobrevive só para pendências anteriores', () => {
    /*
      Ali o vencimento ORIGINAL é a razão de ser da seção — sem ele a linha
      não se explica. É o único consumidor.
    */
    const usos = BUDGET.match(/subtitle=/g) ?? []
    expect(usos.length).toBe(1)
  })
})

describe('Refinamento visual de Bancos', () => {
  it('itens 2/6: a badge fica no grupo do NOME', () => {
    /*
      Ela vinha DEPOIS do `flex-1` e era empurrada para o canto direito,
      lendo como elemento à parte. A badge qualifica o banco — pertence à
      identidade, não à coluna de valores.
    */
    const grupo = BANKS.slice(
      BANKS.indexOf('flex min-w-0 flex-1 items-center'),
      BANKS.indexOf('"Fatura atual" nomeia'),
    )

    expect(grupo).toContain('{bank.name}')
    expect(grupo).toContain('<NearestInvoiceBadge')
  })

  it('item 1: as duas faixas ficam próximas, sem colapsar', () => {
    // `gap-0.5`: as duas descrevem o MESMO banco.
    expect(BANKS).toContain('gap-0.5')
    expect(BANKS).not.toContain('flex-col justify-center gap-1 py-3')
  })

  it('item 3: o chevron segue o padrão majoritário do site', () => {
    /*
      Auditado: `group-hover:text-primary/60` aparece em Budget, Overview e no
      `StatusListRow` compartilhado; o neutro só em Pessoas. Bancos já seguia
      a maioria — padronizar para o neutro criaria a exceção, não o contrário.
    */
    expect(BANKS).toContain('group-hover:text-primary/60')
    expect(ROW).toContain('group-hover:text-primary/60')
  })

  it('item 8: banco sem fatura não ganha destaque especial', () => {
    // Só os refinamentos de alinhamento; nenhum tratamento próprio.
    expect(BANKS).toContain('{nearest !== null && (')
  })
})

describe('Destaque da fatura atual', () => {
  const INVOICES = ler('../app/(dashboard)/banks/[id]/invoices/page.tsx')

  it('item 4: vira card recolhido, não faixa em bleed', () => {
    /*
      `ring-inset` corria colado nas extremidades da lista e as margens
      pareciam desiguais. `mx-1` + raio + sombra dão a leitura de item
      elevado que os cards do app já usam.
    */
    expect(INVOICES).toContain('mx-1 rounded-xl border border-primary/25')
    expect(INVOICES).toContain('shadow-sm shadow-primary/5')
    expect(INVOICES).not.toContain('ring-1 ring-inset ring-primary/15')
  })

  it('item 4: o fundo continua translúcido, sem azul sólido', () => {
    expect(INVOICES).toContain('bg-primary/[0.06]')
    expect(INVOICES).not.toContain('bg-primary px-2 py-0.5')
  })

  it('item 5: a badge "Atual" volta a ser clara e neutra', () => {
    /*
      Em azul translúcido ela se dissolvia no fundo do card — as duas badges
      viravam a mesma mancha. O contraste é o que a faz ser lida de relance.
    */
    expect(INVOICES).toContain('bg-foreground px-2 py-0.5')
    expect(INVOICES).toContain('text-background')
  })

  it('selecionado continua tendo precedência sobre atual', () => {
    // Com o drawer aberto, a linha aberta é a que precisa se distinguir.
    expect(INVOICES).toContain('isAtual && !isSelected')
    expect(INVOICES).toContain('isSelected ? statusRowBg(invoice.status)')
  })
})
