import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SHEET = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/transactions/transaction-sheet.tsx'),
  'utf8',
)

describe('transaction bank selector — optional bank UX', () => {
  it('offers Sem banco only for non-credit transactions', () => {
    expect(SHEET).toContain("selectedType !== TransactionType.CREDIT_CARD && (")
    expect(SHEET).toContain('<SelectItem value={NO_BANK_OPTION}>Sem banco</SelectItem>')
  })

  it('maps Sem banco to an empty bank field and never exposes the system id', () => {
    expect(SHEET).toContain("value === NO_BANK_OPTION ? '' : value")
    expect(SHEET).toContain('bankId: normalized.bankId || undefined')
  })

  it('does not retain the old removal action', () => {
    expect(SHEET).not.toContain('Remover banco')
  })
})
