import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const SETTLE = read('src/app/(dashboard)/persons/settle-person-dialog.tsx')
const MARK = read('src/app/(dashboard)/transactions/mark-as-paid-dialog.tsx')
const FIELDS = read('src/components/settlement-payment-fields.tsx')
const INVOICE = read('src/components/invoice-details-drawer.tsx')
const PEOPLE = read('src/components/person-statement-drawer.tsx')
const PAID_INVOICES = read('src/app/(dashboard)/banks/[id]/invoices/page.tsx')

describe('shared settlement payment fields', () => {
  it('is consumed by person settlement and mark-as-paid', () => {
    expect(SETTLE).toContain('SettlementPaymentFields')
    expect(MARK).toContain('SettlementPaymentFields')
  })

  it('keeps optional bank collapsed and exposes the shared affordances', () => {
    expect(FIELDS).toContain('Adicionar banco (opcional)')
    expect(FIELDS).toContain('Remover banco')
    expect(FIELDS).toContain('Criar novo banco')
    expect(FIELDS).not.toContain('+ Novo banco')
    expect(FIELDS).not.toContain('Sem banco')
  })

  it('uses bank display names and selects a newly created bank', () => {
    expect(FIELDS).toContain('bankDisplayName(selectedBank)')
    expect(FIELDS).toContain('bankDisplayName(bank)')
    expect(FIELDS).toContain('onBankIdChange(bank.id)')
    expect(FIELDS).toContain('createBank')
  })

  it('clears an ineligible optional bank when switching to credit', () => {
    expect(FIELDS).toContain('value === TransactionType.CREDIT_CARD')
    expect(FIELDS).toContain('!isSelectableBank(selectedBank)')
    expect(FIELDS).toContain("onBankIdChange('')")
  })

  it('preserves a selectable bank when switching to credit', () => {
    expect(FIELDS).toContain('selectedBank && !isSelectableBank(selectedBank)')
    expect(FIELDS).toContain('onPaymentTypeChange?.(value)')
  })

  it('keeps shared bank actions at the same secondary-action scale', () => {
    expect(FIELDS).toContain('BANK_ACTION_CLASS')
    expect(FIELDS).toContain('text-xs font-normal leading-5')
  })

  it('keeps credit-card bank requirements in the domain consumers', () => {
    expect(SETTLE).toContain('(!isCredit || Boolean(bankId))')
    expect(MARK).toContain('bankRequired = createTransaction')
    expect(MARK).toContain('type === TransactionType.CREDIT_CARD')
  })

  it('does not render payment fields for a zero-net person settlement', () => {
    expect(SETTLE).toContain("direction !== 'none'")
    expect(SETTLE).toContain("direction = net > 0 ? 'inflow' : net < 0 ? 'outflow' : 'none'")
  })

  it('uses the shared optional bank pattern for invoice payment', () => {
    expect(INVOICE).toContain('SettlementPaymentFields')
    expect(INVOICE).toContain('dateLabel="Data do pagamento"')
    expect(INVOICE).toContain('Informe a data efetiva do pagamento. Você pode adicionar um banco se quiser.')
    expect(INVOICE).not.toContain('Banco/conta (opcional)')
  })

  it('keeps People copy directional and paid invoice month capitalized', () => {
    expect(PEOPLE).toContain('A receber')
    expect(PEOPLE).toContain('A pagar')
    expect(PAID_INVOICES).toContain('capitalize(formatMonthYear(invoice.month, invoice.year))')
  })
})
