import { describe, expect, it } from 'vitest'
import { buildStatementMetadataSegments } from './statement-metadata'

describe('statement metadata segments', () => {
  it('deduplicates equivalent labels without regard to case', () => {
    expect(buildStatementMetadataSegments({
      categoryName: 'Assinatura',
      subscription: true,
    })).toEqual(['Assinatura'])
  })

  it('preserves bank, category, and invoice context in canonical order', () => {
    expect(buildStatementMetadataSegments({
      bankName: 'Nubank',
      categoryName: 'Assinatura',
      subscription: true,
      invoicePeriod: 'out/2026',
    })).toEqual(['Nubank', 'Assinatura', 'fatura out/2026'])
  })

  it('preserves person context even when another label has the same text', () => {
    expect(buildStatementMetadataSegments({
      categoryName: 'pago para Mariana Souza',
      personContext: { label: 'pago para', personName: 'Mariana Souza' },
    })).toEqual(['pago para Mariana Souza', 'pago para Mariana Souza'])

    expect(buildStatementMetadataSegments({
      receivablePersonName: 'Rafael Lima',
    })).toEqual(['a receber de Rafael Lima'])
  })

  it('keeps the first matching label and retains order for distinct labels', () => {
    expect(buildStatementMetadataSegments({
      bankName: '  NuBank ',
      categoryName: 'Transporte',
      subscription: true,
      invoicePeriod: 'out/2026',
      isRefund: true,
    })).toEqual(['NuBank', 'Transporte', 'assinatura', 'fatura out/2026', 'reembolso'])
  })
})
