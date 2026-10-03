import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const invoiceDrawer = source('../components/invoice-details-drawer.tsx')
const transactionSheet = source('../app/(dashboard)/transactions/transaction-sheet.tsx')
const personFlow = source('../components/person-contextual-create-flow.tsx')
const movementsFlow = source('../app/(dashboard)/movements/movements-add-flow.tsx')
const debtSheet = source('../app/(dashboard)/debts/debt-sheet.tsx')
const receivableSheet = source('../app/(dashboard)/receivables/receivable-sheet.tsx')

describe('contextual create polish', () => {
  it('creates from a bank invoice with the canonical transaction form and hidden contextual choices', () => {
    expect(invoiceDrawer).toContain('type: TransactionType.CREDIT_CARD')
    expect(invoiceDrawer).toContain('initialKind="expense"')
    expect(invoiceDrawer).toContain('hideContextualQuestions')
    expect(invoiceDrawer).toContain('hideBankField')
    expect(invoiceDrawer).toContain('contextualTitle={`Nova transação ·')
    expect(invoiceDrawer).not.toContain('formatDateValue(period)')
    expect(transactionSheet).toContain('date: createDefaults?.date ?? accountToday(timeZone)')
    expect(transactionSheet).toContain('name="date"')
    expect(transactionSheet).toContain('bankId: createDefaults?.bankId ??')
    expect(transactionSheet).toContain('className="shrink-0 gap-1 border-b border-border px-6 py-5 pr-14"')
    expect(transactionSheet).toContain('className="flex w-full flex-col gap-0 sm:max-w-md"')
  })

  it('places the unchanged refund switch after payment in the shared transaction form', () => {
    const payment = transactionSheet.indexOf('<Label>Pagamento</Label>')
    const refund = transactionSheet.indexOf('Registrar como estorno')
    const personPurchase = transactionSheet.indexOf('Compra para outra pessoa')
    expect(payment).toBeGreaterThan(-1)
    expect(refund).toBeGreaterThan(payment)
    expect(personPurchase).toBeGreaterThan(refund)
    expect(transactionSheet).toContain('name="isRefund"')
    expect(transactionSheet).toContain('onClick={() => handleRefundToggle(!field.value)}')
    expect(movementsFlow).toContain('<TransactionSheet')
    expect(movementsFlow).toContain('scrollManagedByParent')
    expect(movementsFlow).not.toContain('Registrar estorno')
  })

  it('uses the shared button typography for the bank Add action', () => {
    const addAction = invoiceDrawer.slice(invoiceDrawer.indexOf('title="Transações"'), invoiceDrawer.indexOf('title="Transações"') + 900)
    expect(addAction).toContain('size="sm"')
    expect(addAction).toContain('className="cursor-pointer gap-1 px-2"')
    expect(addAction).not.toContain('text-[11px]')
  })

  it('keeps the person and progressive choices while reusing both canonical forms', () => {
    expect(personFlow).toContain('PROGRESSIVE_REVEAL_CLASS')
    expect(personFlow).toContain('<DebtSheet')
    expect(personFlow).toContain('<ReceivableSheet')
    expect(personFlow).toContain('initialPersonId={personId}')
    expect(personFlow).toContain('hidePersonSelector')
    expect(debtSheet).toContain('!hidePersonSelector')
    expect(receivableSheet).toContain('!hidePersonSelector')
  })
})
