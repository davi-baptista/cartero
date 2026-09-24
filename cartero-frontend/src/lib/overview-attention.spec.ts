import { describe, expect, it } from 'vitest'
import { InvoiceStatus } from '@/types'
import type { Bank, Debt, Invoice, Receivable } from '@/types'
import {
  ATTENTION_DAYS_WINDOW,
  ATTENTION_LIMIT,
  attentionDueUrgency,
  attentionWindowEnd,
  buildAttentionSelection,
  selectAttentionInvoices,
  selectPendingByDueDate,
} from './overview-attention'
import { settlementStatus } from './settlement-status'
import { formatDateValue } from './date'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * "Atenção agora" — seleção pura (Overview Agenda V1)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Congela o comportamento herdado de `overview/page.tsx` antes da extração —
 * nenhuma regra muda aqui, só ganha nome e cobertura.
 */

const TODAY = new Date(2026, 8, 16) // 2026-09-16, civil local

const BANKS: Bank[] = [
  { id: 'b1', userId: 'u1', name: 'Nubank', invoiceCloseDate: 3, invoiceDueDate: 10 } as Bank,
]

function invoice(over: Partial<Invoice> & { id: string }): Invoice {
  return {
    id: over.id,
    userId: 'u1',
    bankId: over.bankId ?? 'b1',
    month: over.month ?? 9,
    year: over.year ?? 2026,
    status: over.status ?? InvoiceStatus.OPEN,
    totalAmount: over.totalAmount ?? 1000,
    closeDate: over.closeDate ?? '2026-09-20',
    dueDate: over.dueDate ?? '2026-09-27',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as Invoice
}

function debt(over: Partial<Debt> & { id: string }): Debt {
  return {
    id: over.id,
    userId: 'u1',
    creditorName: 'Eva',
    title: over.title ?? 'Aluguel',
    amount: over.amount ?? 300,
    occurredAt: '2026-09-01',
    dueDate: over.dueDate ?? '2026-09-18',
    isAlertEnabled: true,
    isPaid: over.isPaid ?? false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as Debt
}

function receivable(over: Partial<Receivable> & { id: string }): Receivable {
  return {
    id: over.id,
    userId: 'u1',
    debtorName: 'Eva',
    title: over.title ?? 'Ingresso',
    amount: over.amount ?? 300,
    occurredAt: '2026-09-01',
    dueDate: over.dueDate ?? '2026-09-18',
    isPaid: over.isPaid ?? false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as Receivable
}

describe('selectAttentionInvoices', () => {
  it('A1: OPEN com fechamento dentro da janela entra', () => {
    const inv = invoice({ id: 'i1', status: InvoiceStatus.OPEN, closeDate: '2026-09-20' })
    const result = selectAttentionInvoices([inv], BANKS, TODAY)
    expect(result.map((i) => i.id)).toEqual(['i1'])
  })

  it('OVERDUE sempre entra, mesmo fora da janela nominal', () => {
    const inv = invoice({ id: 'i1', status: InvoiceStatus.OVERDUE, dueDate: '2026-01-01' })
    const result = selectAttentionInvoices([inv], BANKS, TODAY)
    expect(result.map((i) => i.id)).toEqual(['i1'])
  })

  it('PAID nunca entra', () => {
    const inv = invoice({ id: 'i1', status: InvoiceStatus.PAID })
    const result = selectAttentionInvoices([inv], BANKS, TODAY)
    expect(result).toEqual([])
  })

  it('totalAmount zero é excluído', () => {
    const inv = invoice({ id: 'i1', status: InvoiceStatus.OVERDUE, totalAmount: 0 })
    const result = selectAttentionInvoices([inv], BANKS, TODAY)
    expect(result).toEqual([])
  })

  it('OPEN fora da janela de 7 dias é excluído', () => {
    const inv = invoice({ id: 'i1', status: InvoiceStatus.OPEN, closeDate: '2026-10-15', dueDate: '2026-10-22' })
    const result = selectAttentionInvoices([inv], BANKS, TODAY)
    expect(result).toEqual([])
  })

  it('OPEN com fechamento já passado cai para o vencimento (fallback cron atrasado)', () => {
    const inv = invoice({ id: 'i1', status: InvoiceStatus.OPEN, closeDate: '2026-09-01', dueDate: '2026-09-20' })
    const result = selectAttentionInvoices([inv], BANKS, TODAY)
    expect(result.map((i) => i.id)).toEqual(['i1'])
  })

  it('bank inexistente exclui a invoice', () => {
    const inv = invoice({ id: 'i1', status: InvoiceStatus.OPEN, bankId: 'ghost' })
    const result = selectAttentionInvoices([inv], BANKS, TODAY)
    expect(result).toEqual([])
  })

  it('ordena OVERDUE primeiro, depois por competência crescente', () => {
    const overdue = invoice({ id: 'overdue', status: InvoiceStatus.OVERDUE, year: 2026, month: 8 })
    const closedSep = invoice({ id: 'closed-sep', status: InvoiceStatus.CLOSED, year: 2026, month: 9, dueDate: '2026-09-20' })
    const closedAug = invoice({ id: 'closed-aug', status: InvoiceStatus.CLOSED, year: 2026, month: 8, dueDate: '2026-09-18' })
    const result = selectAttentionInvoices([closedSep, overdue, closedAug], BANKS, TODAY)
    expect(result.map((i) => i.id)).toEqual(['overdue', 'closed-aug', 'closed-sep'])
  })

  it('A7: invoices não têm cap — todas as elegíveis aparecem', () => {
    const invoices = Array.from({ length: 6 }, (_, i) =>
      invoice({ id: `i${i}`, status: InvoiceStatus.OVERDUE, bankId: 'b1' }),
    )
    const result = selectAttentionInvoices(invoices, BANKS, TODAY)
    expect(result).toHaveLength(6)
  })
})

describe('selectPendingByDueDate (debts/receivables)', () => {
  const windowEnd = attentionWindowEnd(TODAY)

  it('A2: item vencido (overdue) entra sem cutoff inferior', () => {
    const d = debt({ id: 'd1', dueDate: '2026-01-01' })
    const result = selectPendingByDueDate([d], windowEnd)
    expect(result.map((x) => x.id)).toEqual(['d1'])
  })

  it('A3: item vencendo dentro de 7 dias entra', () => {
    const d = debt({ id: 'd1', dueDate: '2026-09-20' })
    const result = selectPendingByDueDate([d], windowEnd)
    expect(result.map((x) => x.id)).toEqual(['d1'])
  })

  it('A3b: item exatamente no limite de +7 dias entra', () => {
    const r = receivable({ id: 'r-limit', dueDate: windowEnd })
    const result = selectPendingByDueDate([r], windowEnd)
    expect(result.map((x) => x.id)).toEqual(['r-limit'])
  })

  it('A3c: item em +8 dias fica fora', () => {
    const afterWindow = new Date(TODAY)
    afterWindow.setDate(afterWindow.getDate() + ATTENTION_DAYS_WINDOW + 1)
    const r = receivable({ id: 'r-after-limit', dueDate: formatDateValue(afterWindow) })
    const result = selectPendingByDueDate([r], windowEnd)
    expect(result).toEqual([])
  })

  it('A4: item fora da janela (>7 dias) é excluído', () => {
    const d = debt({ id: 'd1', dueDate: '2026-10-01' })
    const result = selectPendingByDueDate([d], windowEnd)
    expect(result).toEqual([])
  })

  it('A5: item pago é excluído mesmo dentro da janela', () => {
    const d = debt({ id: 'd1', dueDate: '2026-09-18', isPaid: true })
    const result = selectPendingByDueDate([d], windowEnd)
    expect(result).toEqual([])
  })

  it('A6: mesma regra vale para receivables', () => {
    const r1 = receivable({ id: 'r1', dueDate: '2026-01-01' })
    const r2 = receivable({ id: 'r2', dueDate: '2026-10-01' })
    const result = selectPendingByDueDate([r1, r2], windowEnd)
    expect(result.map((x) => x.id)).toEqual(['r1'])
  })

  it('ordena por dueDate ascendente', () => {
    const d1 = debt({ id: 'later', dueDate: '2026-09-20' })
    const d2 = debt({ id: 'earlier', dueDate: '2026-09-17' })
    const result = selectPendingByDueDate([d1, d2], windowEnd)
    expect(result.map((x) => x.id)).toEqual(['earlier', 'later'])
  })
})

describe('buildAttentionSelection', () => {
  it('A7: aplica ATTENTION_LIMIT (3) a debts e receivables, mas não a invoices', () => {
    const debts = Array.from({ length: 5 }, (_, i) =>
      debt({ id: `d${i}`, dueDate: `2026-09-1${i}` }),
    )
    const receivables = Array.from({ length: 5 }, (_, i) =>
      receivable({ id: `r${i}`, dueDate: `2026-09-1${i}` }),
    )
    const invoices = Array.from({ length: 5 }, (_, i) =>
      invoice({ id: `i${i}`, status: InvoiceStatus.OVERDUE }),
    )

    const selection = buildAttentionSelection(
      { invoices, banks: BANKS, debts, receivables },
      TODAY,
    )

    expect(selection.debts).toHaveLength(ATTENTION_LIMIT)
    expect(selection.receivables).toHaveLength(ATTENTION_LIMIT)
    expect(selection.debtsAll).toHaveLength(5)
    expect(selection.receivablesAll).toHaveLength(5)
    expect(selection.invoices).toHaveLength(5)
  })

  it('A9: seleção não recebe nem depende de mês/período algum — é sempre "hoje"', () => {
    // A assinatura de buildAttentionSelection não aceita year/month — a
    // única entrada temporal é `today`. Isso é a prova estrutural de que
    // navegar de mês no calendário não pode afetar esta seleção.
    const selection = buildAttentionSelection(
      { invoices: [], banks: BANKS, debts: [], receivables: [] },
      TODAY,
    )
    expect(selection.windowEnd).toBe(attentionWindowEnd(TODAY))
  })
})

describe('attentionDueUrgency (Temporal Stabilization V1: due-today consistency)', () => {
  it('F1: vence ontem: overdue', () => {
    expect(attentionDueUrgency('2026-09-15', TODAY)).toBe('overdue')
  })

  it('F2: vence hoje: NÃO overdue (urgent) — alinhado com settlementStatus/Invoice/Debt backend', () => {
    // Mutation guard: se a implementação reintroduzir `diff <= 0`, este
    // teste falha — é o teste que deve MATAR a semântica anterior.
    expect(attentionDueUrgency('2026-09-16', TODAY)).toBe('urgent')
    expect(attentionDueUrgency('2026-09-16', TODAY)).not.toBe('overdue')
  })

  it('F3: vence amanhã: urgent (pending/future)', () => {
    expect(attentionDueUrgency('2026-09-17', TODAY)).toBe('urgent')
  })

  it('F5: mesmo dueDate=hoje não recebe status conflitante entre Attention e Calendar/settlementStatus', () => {
    // A mesma dívida, mesmo dueDate, hoje: nenhuma das duas authorities pode
    // classificá-la como "vencida" — settlementStatus (Calendário) e
    // attentionDueUrgency (Atenção agora) precisam concordar em "não overdue".
    //
    // `settlementStatus` não aceita `today` injetável (usa o relógio real da
    // máquina) — por isso este teste usa o "hoje" de verdade em vez de uma
    // string fixa, para não depender de coincidência de data.
    const dueToday = formatDateValue()
    const calendarStatus = settlementStatus({ isPaid: false, dueDate: dueToday })
    const attentionUrgency = attentionDueUrgency(dueToday, new Date())

    expect(calendarStatus).toBe('pending')
    expect(attentionUrgency).toBe('urgent')
    expect(calendarStatus).not.toBe('overdue')
    expect(attentionUrgency).not.toBe('overdue')
  })
})

describe('ATTENTION_DAYS_WINDOW', () => {
  it('continua 7, não alterado nesta rodada', () => {
    expect(ATTENTION_DAYS_WINDOW).toBe(7)
  })
})
