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
const INVOICE_DRAWER = code(ler('../components/invoice-details-drawer.tsx'))
const INVOICES_PAGE = code(ler('../app/(dashboard)/banks/[id]/invoices/page.tsx'))
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
    /*
      O que não pode existir é SELEÇÃO local — ela faria o período se perder
      ao navegar entre as telas.

      `currentPeriod()` continua permitido e é usado para outra coisa: saber
      qual é o mês de HOJE, para o trailing distinguir "Fatura atual" de
      "Fatura aberta". Isso é autoridade temporal, não estado de seleção.
    */
    expect(BANKS).not.toContain('useState<MonthPeriod>')
    expect(BANKS).not.toContain('setPeriod')
    expect(BANKS).toContain('useMonthPeriod()')
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
    expect(BANKS).toContain('onOpenInvoice={(id) => { setEmptyBankId(null); detail.open(id) }}')
    expect(BANKS).toContain('onOpenEmpty={setEmptyBankId}')
    expect(BANKS).toContain('onOpenInvoice(invoice.id)')
  })

  it('B17-B19: fechar, Back e Forward saem da mesma foundation', () => {
    /*
      `useDetailNavigation` já resolve os três: abre com push, fecha com
      replace e lê o id da URL. Um `useState` paralelo (`selectedInvoice`)
      quebraria Back/Forward em silêncio.
    */
    expect(BANKS).toContain('onOpenChange={(open) => { if (!open) { detail.close(); setEmptyBankId(null) } }}')
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
  it('mantém ações financeiras no heading de Transações, com arquivamento confirmado', () => {
    const belowCard = INVOICE_DRAWER.slice(INVOICE_DRAWER.indexOf('</DrawerSummaryCard>'), INVOICE_DRAWER.indexOf('{invoice && <CategoryChart'))
    expect(belowCard).not.toContain('Pagar')
    expect(belowCard).not.toContain('Reabrir')
    expect(belowCard).not.toContain('Ver todas as faturas')
    const heading = INVOICE_DRAWER.slice(INVOICE_DRAWER.indexOf('title="Transações"'), INVOICE_DRAWER.indexOf('{txs.length === 0'))
    expect(heading).toContain('canMarkPaid ? (')
    expect(heading).toContain(') : isPaid ? (')
    expect(heading).toContain('canEditTransactions && !selectedCategory')
    expect(heading.indexOf('Pagar')).toBeLessThan(heading.indexOf('Adicionar'))
    expect(heading.indexOf('Reabrir')).toBeLessThan(heading.indexOf('Adicionar'))
    expect(INVOICE_DRAWER).toContain('if (bankInfo.canArchive) setBankArchiveOpen(true)')
    expect(INVOICE_DRAWER).toContain('onConfirm={() => { if (bankInfo?.canArchive) archiveBankMut.mutate() }}')
    expect(INVOICE_DRAWER).not.toContain('canViewBankHistory')
  })
  it('o kebab administra o BANCO, a row mostra o mês', () => {
    /*
      As ações viviam na página do cartão, que deixou de ser o caminho
      principal. Sem trazê-las de volta, editar um banco exigiria descobrir
      uma rota que a interface não oferece mais.
    */
    const row = BANKS.slice(BANKS.indexOf('function BankRow'), BANKS.indexOf('function RowSkeleton'))
    expect(row).not.toContain('<DropdownMenu')
    expect(INVOICE_DRAWER).toContain('<DrawerManagementActions entity="banco"')
  })

  it('`Editar` ABRE o drawer, não só define o alvo', () => {
    /*
      O teste anterior fixava `onEdit={() => setEditBank(bank)}` — a forma
      exata do bug. Definir o alvo não abre nada: o `BankSheet` é controlado
      por `sheetOpen`, e sem `setSheetOpen(true)` o clique não fazia nada
      visível. Editar um cartão exigia entrar em "Ver todas as faturas".

      Verificar as DUAS chamadas é o que prende a regressão; a string do
      handler sozinha passava com o bug presente.
    */
    expect(INVOICE_DRAWER).toContain('onEdit={() => setBankEditOpen(true)}')
    expect(INVOICE_DRAWER).toContain('<BankSheet open={bankEditOpen}')
  })

  it('B21: a página dedicada de histórico continua existindo', () => {
    expect(INVOICES_PAGE).toContain('export default function BankInvoicesPage()')
  })
})

describe('a página segue o sistema visual de Pessoas', () => {
  it('as duas usam os mesmos tokens de row', () => {
    expect(BANKS).toContain('ROW_AMOUNT_CLASS')
    expect(PERSONS).toContain('FinancialRowTrailing')
    for (const token of ['ROW_ICON_CLASS', 'FinancialListRow']) {
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
      const start = fonte.indexOf(nome === 'Bancos' ? 'function BankRow' : 'personSections.groups[section].map')
      const end = fonte.indexOf(nome === 'Bancos' ? 'function RowSkeleton' : '</MotionRow>', start)
      expect(fonte.slice(start, end), nome).not.toContain('<DropdownMenu')
    }
  })

  it('o resumo do topo tem a mesma tipografia', () => {
    const tipografia = 'text-[22px] font-semibold tabular-nums tracking-[-0.02em]'
    expect(BANKS).toContain(tipografia)
    expect(PERSONS).toContain(tipografia)
  })
})
