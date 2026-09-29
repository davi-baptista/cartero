import { describe, expect, it } from 'vitest'
import { InvoiceStatus } from '@/types'
import { invoiceSummaryStatusPresentation } from './invoice-timing'

const invoice = (status: InvoiceStatus, closeDate = '2026-09-25', dueDate = '2026-10-02') => ({
  status,
  closeDate,
  dueDate,
})

const TODAY = new Date(2026, 8, 25)

describe('invoice summary status urgency', () => {
  it.each([
    [InvoiceStatus.OPEN, '2026-10-01', 'Em aberto', 'informational'],
    [InvoiceStatus.OPEN, '2026-09-30', 'Fechando em breve', 'pending'],
    [InvoiceStatus.OPEN, '2026-09-25', 'Fechando em breve', 'pending'],
    [InvoiceStatus.CLOSED, '2026-10-01', 'Fechada', 'informational'],
    [InvoiceStatus.CLOSED, '2026-09-30', 'Fechada · vencendo em breve', 'pending'],
    [InvoiceStatus.CLOSED, '2026-09-25', 'Fechada · vencendo em breve', 'pending'],
  ] as const)('classifies %s at %s', (status, targetDate, label, tone) => {
    const value = status === InvoiceStatus.OPEN
      ? invoice(status, targetDate)
      : invoice(status, '2026-09-20', targetDate)
    expect(invoiceSummaryStatusPresentation(value, null, TODAY)).toEqual({ label, tone })
  })

  it('keeps overdue destructive and paid successful regardless of timing', () => {
    expect(invoiceSummaryStatusPresentation(invoice(InvoiceStatus.OVERDUE, '2026-09-20', '2026-09-25'), null, TODAY)).toEqual({
      label: 'Vencida desde 25/09/2026', tone: 'destructive',
    })
    expect(invoiceSummaryStatusPresentation(invoice(InvoiceStatus.PAID, '2026-09-25', '2026-09-25'), '24/09/2026', TODAY)).toEqual({
      label: 'Paga em 24/09/2026', tone: 'success',
    })
  })

  it('uses civil dates at the five-day boundary', () => {
    expect(invoiceSummaryStatusPresentation(invoice(InvoiceStatus.OPEN, '2026-09-30'), null, TODAY).tone).toBe('pending')
    expect(invoiceSummaryStatusPresentation(invoice(InvoiceStatus.OPEN, '2026-10-01'), null, TODAY).tone).toBe('informational')
  })
})
