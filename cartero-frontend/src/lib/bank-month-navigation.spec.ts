import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Bancos entrou no padrão de navegação de Pessoas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Chegar a uma fatura custava dois níveis: a lista levava a
 * `/banks/:id/invoices`, e de lá o usuário abria o detalhe. Com o mês no topo
 * a fatura já está determinada quando a row é clicada, então a página do meio
 * não tem mais o que decidir.
 *
 * O que este arquivo protege é a REUTILIZAÇÃO: mês pelo contexto global,
 * identidade de URL pela foundation da O4.3, drawer canônico. Cada um desses
 * pontos é um lugar onde uma segunda implementação poderia nascer — e as duas
 * páginas passariam a divergir sem ninguém notar.
 */

const ler = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), 'utf-8')

/** Sem comentários: a prosa cita o comportamento antigo e casaria com as buscas. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const BANKS = code(ler('../app/(dashboard)/banks/page.tsx'))
const PERSONS = code(ler('../app/(dashboard)/persons/page.tsx'))
const LAYOUT = code(ler('../app/(dashboard)/layout.tsx'))

describe('B1-B5: o mês vem do contexto do app', () => {
  it('Bancos usa o MESMO hook que Pessoas', () => {
    /*
      Um `useState` local funcionaria — e faria o período se perder ao navegar
      entre as telas, que é justamente o que o contexto global existe para
      evitar.
    */
    expect(BANKS).toContain('useMonthPeriod()')
    expect(PERSONS).toContain('useMonthPeriod()')
  })

  it('Bancos NÃO mantém estado de mês próprio', () => {
    expect(BANKS).not.toContain('useState<MonthPeriod>')
    expect(BANKS).not.toContain('currentPeriod()')
  })

  it('B1: o seletor aparece em /banks', () => {
    /* Sem entrar no gate, a página teria período mas nenhum controle. */
    expect(LAYOUT).toContain("MONTH_SCOPED_EXACT = ['/banks']")
  })

  it('o seletor NÃO aparece na página de histórico do cartão', () => {
    /*
      `/banks/:id/invoices` lista o histórico inteiro por seção e não lê o
      período — um seletor ali seria um controle que não muda nada. Por isso
      o gate é por caminho EXATO, não por prefixo.
    */
    const invoices = code(ler('../app/(dashboard)/banks/[id]/invoices/page.tsx'))
    expect(invoices).not.toContain('useMonthPeriod')
    expect(LAYOUT).toContain('MONTH_SCOPED_EXACT.includes(pathname)')
  })

  it('o seletor renderizado é o primitive compartilhado', () => {
    /* Uma segunda navegação de mês divergiria em tipografia e atalhos. */
    expect(LAYOUT).toContain('<MonthNav')
    expect(BANKS).not.toContain('<MonthNav')
    expect(PERSONS).not.toContain('<MonthNav')
  })
})

describe('B16-B21: o detalhe da fatura vive na URL', () => {
  it('B16: a row abre o drawer, sem página intermediária', () => {
    expect(BANKS).toContain("useDetailNavigation('invoiceId')")
    expect(BANKS).toContain('onOpenInvoice={detail.open}')
    expect(BANKS).toContain('onOpenInvoice(invoice.id)')
  })

  it('B17-B19: fechar, Back e Forward saem da mesma foundation', () => {
    /*
      `useDetailNavigation` já resolve os três: abre com push, fecha com
      replace e lê o id da URL. Um `useState` paralelo (`selectedInvoice`)
      quebraria Back/Forward em silêncio.
    */
    expect(BANKS).toContain('onOpenChange={(open) => !open && detail.close()}')
    expect(BANKS).not.toContain('selectedInvoice')
    expect(BANKS).not.toContain('setOpenInvoice')
  })

  it('B21: fatura de outro mês não fica aberta sobre a lista', () => {
    /*
      Trocar setembro → agosto deixaria o painel mostrando a fatura de
      setembro sobre uma lista de agosto: duas competências na mesma tela, sem
      dizer qual é qual.
    */
    expect(BANKS).toContain('openInvoiceBelongsToPeriod')
    expect(BANKS).toContain('detail.close()')
  })

  it('o drawer é o canônico, não uma segunda versão', () => {
    /*
      O mesmo componente da página do cartão — com as mutations de transação
      que ele já carrega. Duplicá-lo faria as duas telas divergirem no que é
      possível fazer com uma fatura.
    */
    expect(BANKS).toContain('<InvoiceDetailsDrawer')
    expect(BANKS).toContain("from '@/components/invoice-details-drawer'")
    expect(BANKS).toContain('key={detail.openId ?? ')
  })
})

describe('B20: a gestão do banco continua acessível', () => {
  it('o kebab administra o BANCO, a row mostra o mês', () => {
    /*
      As ações viviam na página do cartão, que deixou de ser o caminho
      principal. Sem trazê-las de volta, editar um banco exigiria descobrir
      uma rota que a interface não oferece mais.
    */
    expect(BANKS).toContain('aria-label={`Mais opções de ${bank.name}`}')
    expect(BANKS).toContain('onEdit={() => setEditBank(bank)}')
    expect(BANKS).toContain('onArchive={')
    expect(BANKS).toContain('onDelete={')
  })

  it('B21: a rota dedicada continua existindo, agora pelo menu', () => {
    /*
      Ela não foi removida — só deixou de ser obrigatória. O histórico
      completo do cartão continua tendo um caminho.
    */
    expect(BANKS).toContain('/banks/${bank.id}/invoices')
  })
})

describe('a página segue o sistema visual de Pessoas', () => {
  it('as duas usam os mesmos tokens de row', () => {
    for (const token of [
      'ROW_AMOUNT_CLASS',
      'ROW_TRAILING_LABEL_CLASS',
      'ROW_ICON_CLASS',
      'FinancialListRow',
    ]) {
      expect(BANKS, `Bancos sem ${token}`).toContain(token)
      expect(PERSONS, `Pessoas sem ${token}`).toContain(token)
    }
  })

  it('o kebab é IRMÃO da row nas duas, sobreposto à direita', () => {
    /*
      Aninhar `button` dentro de `button` é HTML inválido e quebra teclado. As
      duas páginas resolvem igual: `absolute` sobre a linha, com padding
      reservado para não cobrir o valor.
    */
    for (const [nome, fonte] of [
      ['Bancos', BANKS],
      ['Pessoas', PERSONS],
    ] as const) {
      expect(fonte, nome).toContain('absolute top-1/2 right-1 -translate-y-1/2')
      expect(fonte, nome).toContain('pr-10 sm:pr-12')
    }
  })

  it('o resumo do topo tem a mesma tipografia', () => {
    const tipografia = 'text-[22px] font-semibold tabular-nums tracking-[-0.02em]'
    expect(BANKS).toContain(tipografia)
    expect(PERSONS).toContain(tipografia)
  })
})
