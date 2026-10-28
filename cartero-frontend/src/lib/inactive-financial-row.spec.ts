import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FinancialRowList } from '@/components/ui/drawer-section'
import { formatCurrency } from '@/lib/formatters'

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')

const ROW = read('../components/ui/financial-list-row.tsx')
const PERSONS = read('../app/(dashboard)/persons/page.tsx')
const BANKS = read('../app/(dashboard)/banks/page.tsx')

const DRAWER = read('../components/invoice-details-drawer.tsx')
const DRAWER_LAYOUT = read('../components/ui/drawer-layout.ts')
const ROW_SURFACE = read('../components/ui/financial-drawer-row-surface.ts')
const HEADER = read('../components/ui/drawer-identity-header.tsx')
const MOVEMENTS = read('../app/(dashboard)/movements/statement/page.tsx')

describe('active entities remain accessible without monthly data', () => {
  it('keeps the shared button, focus and chevron semantics', () => {
    expect(ROW).toContain('interactive && <DisclosureChevron />')
    expect(ROW).toContain('<button')
    expect(ROW).toContain('onClick={onView}')
    expect(ROW).toContain('focus-visible:ring')
  })

  it('opens the canonical person drawer even for an empty balance', () => {
    expect(PERSONS).toContain('onView={() => openPerson(person.id)}')
    expect(PERSONS).not.toContain('inactive={isEmpty}')
    expect(PERSONS).toContain('<PersonStatementDrawer')
  })

  it('opens a bank context without a fake invoice id and keeps Add available', () => {
    expect(BANKS).toContain('onOpenEmpty={setEmptyBankId}')
    expect(BANKS).toContain('bank={emptyBank}')
    expect(DRAWER).toContain('const emptyBankMode = !invoiceId && Boolean(bank && period)')
    expect(DRAWER).not.toContain('Nenhuma fatura neste mês.')
    expect(DRAWER).toContain('title="Transações"')
    expect(DRAWER).toContain('count={txs.length}')
    expect(DRAWER).toContain('Adicionar')
    expect(DRAWER).toContain('Nenhuma transação')
    expect(DRAWER).toContain('Adicione uma transação de crédito para criar a fatura.')
    expect(DRAWER).toContain('type: TransactionType.CREDIT_CARD')
    expect(DRAWER).toContain('emptyBankMode && !bank?.isArchived')
  })

  it('shows the existing zero summary card for a bank without an invoice', () => {
    expect(formatCurrency(0)).toMatch(/^R\$\s0,00$/)
    expect(DRAWER).toContain('const total = invoice ? Number(invoice.totalAmount) : 0')
    expect(DRAWER).toContain('const txCount = invoice?.transactions?.length ?? 0')
    expect(DRAWER).toContain('<DrawerSummaryCard>')
    expect(DRAWER).not.toContain('{invoice && <DrawerSummaryCard>')
    expect(DRAWER).toContain('<DrawerSummaryLabel>Total da fatura</DrawerSummaryLabel>')
    expect(DRAWER).toContain('{formatCurrency(total)}')
    expect(DRAWER).toContain('{invoice && reimbursableTotal > 0 && (')
    expect(DRAWER).toContain('const summaryStatus = invoice')
    expect(DRAWER).toMatch(/const canMarkPaid =\s+invoice &&/)
    expect(DRAWER).toContain('const isPaid = invoice?.status === InvoiceStatus.PAID')
    expect(DRAWER).toContain('{invoice && <CategoryChart')
    expect(DRAWER).toContain('count={txs.length}')
    expect(DRAWER).toContain('Adicionar')
    expect(DRAWER).toContain('Adicione uma transação de crédito para criar a fatura.')
  })

  it('uses one scroll owner for summary, composition and transactions', () => {
    const scrollStart = DRAWER.indexOf("'subtle-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto'")
    const scrollEnd = DRAWER.indexOf('</SheetContent>', scrollStart)
    const scrollBody = DRAWER.slice(scrollStart, scrollEnd)
    expect(scrollStart).toBeGreaterThan(0)
    expect(scrollBody.indexOf('<DrawerSummaryCard>')).toBeGreaterThan(0)
    expect(scrollBody.indexOf('<CategoryChart')).toBeGreaterThan(scrollBody.indexOf('<DrawerSummaryCard>'))
    expect(scrollBody.indexOf('<DrawerFinancialList')).toBeGreaterThan(scrollBody.indexOf('<CategoryChart'))
    expect(scrollBody.match(/overflow-y-auto/g)).toHaveLength(1)
    expect(scrollBody).toContain('DRAWER_WIDE_VERTICAL_RHYTHM.sectionTopGap')
    expect(DRAWER_LAYOUT).toContain("sectionTopGap: 'gap-5'")
    expect(DRAWER.indexOf('<DrawerIdentityHeader')).toBeLessThan(scrollStart)
  })

  it('aligns the invoice title and transactions heading on the shared wide inset in both modes', () => {
    expect(HEADER).toContain("inset === 'wide' ? DRAWER_WIDE_CONTENT_INSET : 'px-6'")
    expect(DRAWER).toMatch(/<DrawerIdentityHeader\s+inset="wide"/)
    expect(DRAWER).toContain("className={cn('h-auto flex-wrap border-0 px-4', DRAWER_WIDE_VERTICAL_RHYTHM.sectionHeadingPadding)}")
    expect(DRAWER).toContain('bank ? bankDisplayName(bank,')
    expect(DRAWER).toContain('invoice ? (invoice.bank?.isSystem')
    expect(DRAWER).toContain('!emptyBankMode && (isLoading || !invoice)')
    expect(DRAWER).toContain('<DrawerSummaryCard>')
    expect(DRAWER).toContain('<DrawerFinancialList inset>')
  })

  it('uses canonical individual page rows with a border only before the last item', () => {
    for (const page of [BANKS, PERSONS]) {
      expect(page).toContain('<FinancialRowList variant="page" spaced>')
      expect(page).toContain('separator={false} className={financialDrawerRowSurfaceClass(\'animatedWrapper\')}')
      expect(page).toContain('variant="page"')
      expect(page).toContain('className="space-y-6 pt-2 pb-5"')
      expect(page).not.toContain('className="space-y-6 py-5"')
    }
    expect(ROW_SURFACE).toContain("animatedWrapper: 'rounded-lg'")
    expect(ROW_SURFACE).toContain('hover:bg-muted/30')
    expect(ROW_SURFACE).toContain('focus-visible:ring-3')
    const individual = renderToStaticMarkup(FinancialRowList({ variant: 'page', spaced: true, children: [
      createElement('div', { key: 'first' }, 'Primeiro'),
      createElement('div', { key: 'last' }, 'Último'),
    ] }))
    const single = renderToStaticMarkup(FinancialRowList({ variant: 'page', spaced: true, children: createElement('div', null, 'Único') }))
    const traditional = renderToStaticMarkup(FinancialRowList({ variant: 'page', children: createElement('div', null, 'Movimento') }))
    expect(individual).toContain('flex flex-col gap-2')
    expect(individual).toContain('[&amp;&gt;*]:rounded-lg')
    expect(individual).toContain('[&amp;&gt;*]:border-b')
    expect(individual).toContain('[&amp;&gt;*]:border-border/60')
    expect(individual).toContain('[&amp;&gt;*:last-child]:border-b-0')
    expect(single).toContain('[&amp;&gt;*:last-child]:border-b-0')
    expect(single).toContain('Único')
    expect(individual).not.toContain('divide-y')
    expect(traditional).toContain('divide-y divide-border/60')
    expect(traditional).not.toContain('gap-2')
    expect(MOVEMENTS).toContain('<FinancialRowList variant="page">')
    expect(BANKS).not.toContain("? ''\n            : 'border-t'")
    expect(PERSONS).not.toContain('<div className="border-t border-border">')
    expect(BANKS).toContain('onOpenEmpty={setEmptyBankId}')
    expect(PERSONS).toContain('onView={() => openPerson(person.id)}')
    expect(BANKS).toContain('<InvoiceDetailsDrawer')
    expect(PERSONS).toContain('<PersonStatementDrawer')
    expect(BANKS).not.toContain('<DropdownMenu')
    expect(PERSONS).not.toContain('<DropdownMenu')
  })
})
