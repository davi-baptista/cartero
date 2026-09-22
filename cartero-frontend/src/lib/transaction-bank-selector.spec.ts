import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SHEET = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/transactions/transaction-sheet.tsx'),
  'utf8',
)

describe('transaction bank selector — optional bank UX', () => {
  it('collapses optional bank into one quiet action', () => {
    expect(SHEET).toContain('Adicionar banco (opcional)')
    expect(SHEET).toContain('{showBankSelector && <Label>Banco</Label>}')
    expect(SHEET).toContain("!bankIsRequired && 'order-last'")
    expect(SHEET).not.toContain('Sem banco')
  })

  it('removes optional bank without exposing a technical sentinel', () => {
    expect(SHEET).toContain("setValue('bankId', undefined, { shouldDirty: true })")
    expect(SHEET).toContain('bankId: normalized.bankId || undefined')
    expect(SHEET).toContain('Remover banco')
  })

  it('shows bank creation only after the bank section exists', () => {
    expect(SHEET).toContain('onClick={handleOpenBankCreate}')
    expect(SHEET).toContain('Novo banco')
  })

  it('does not hide an existing real bank in edit mode', () => {
    expect(SHEET).toContain('setShowOptionalBank(Boolean(editTarget?.bankId && !editTarget.bank?.isSystem)')
  })

  it('starts a manual create without a default nature or payment method', () => {
    expect(SHEET).toContain('type: undefined as unknown as TransactionType')
    expect(SHEET).not.toContain('createDefaults?.type ?? TransactionType.PIX')
    expect(SHEET).toContain("setValue('type', undefined as unknown as TransactionType")
  })

  it('progressively reveals expense methods and details', () => {
    expect(SHEET).toContain("{selectedKind === 'expense' && (")
    expect(SHEET).toContain('{selectedType && (<>')
    expect(SHEET).toContain("disabled={isSubmitting || (!isEditing && !selectedType)}")
  })

  it('allows the incomplete expense state without validating a fake domain type', () => {
    expect(SHEET).toContain('type: z.enum(transactionTypeValues).optional()')
    expect(SHEET).toContain("setValue('type', undefined as unknown as TransactionType")
    expect(SHEET).toContain('if (!data.type) return')
  })

  it('maps only concrete methods to canonical transaction types', () => {
    expect(SHEET).toContain('function handleMethodChange(method: PaymentMethod)')
    expect(SHEET).toContain('applyType(method)')
    expect(SHEET).toContain('applyType(TransactionType.INCOME)')
    expect(SHEET).not.toContain("TransactionType.EXPENSE")
  })

  it('keeps expense intent independent from canonical payment type', () => {
    expect(SHEET).toContain('useState<TransactionKind | null>(null)')
    expect(SHEET).toContain('const selectedKind = entryIntent ?? undefined')
    expect(SHEET).toContain('setEntryIntent(kind)')
    expect(SHEET).toContain("setEntryIntent('expense')")
    expect(SHEET).toContain("{selectedKind === 'expense' && (")
  })
})
