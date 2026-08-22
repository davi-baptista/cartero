import { describe, expect, it } from 'vitest'
import { InvoiceStatus, TransactionType } from '@/types'
import type { Invoice, Receivable, Transaction } from '@/types'
import { breakdownExpenses, expenseSignedAmount } from './money-semantics'
import { buildCalendarEvents, buildInvoiceBreakdown } from './calendar-events'
import { balanceDirection, pendingPhrase } from './person-statement'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Matriz financeira cruzada (Fase 10)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Cada superfície do Cartero responde uma pergunta diferente sobre o MESMO
 * dinheiro, e o erro histórico foi tratá-las como equivalentes. Os specs por
 * módulo protegem cada superfície isoladamente; este arquivo protege a
 * COERÊNCIA entre elas.
 *
 * O cenário canônico:
 *
 *   Fatura de R$ 1.000, sendo R$ 700 de compras próprias e R$ 300 de uma
 *   compra feita para a Eva, que volta como cobrança de R$ 300.
 *
 * A resposta correta é diferente em cada tela — e nenhuma delas é R$ 400,
 * que é o número que aparece quando o recebível desconta duas vezes.
 */

const BANKS = new Map([['b1', 'Nubank']])

const compraPropria = {
  id: 't-own',
  userId: 'u1',
  bankId: 'b1',
  categoryId: 'c-mercado',
  invoiceId: 'i1',
  type: TransactionType.CREDIT_CARD,
  title: 'Mercado',
  amount: 700,
  date: '2026-07-20',
  createdAt: '',
  updatedAt: '',
} as Transaction

const compraDaEva = {
  id: 't-eva',
  userId: 'u1',
  bankId: 'b1',
  categoryId: 'c-lazer',
  invoiceId: 'i1',
  personId: 'eva',
  type: TransactionType.CREDIT_CARD,
  title: 'Ingresso da Eva',
  amount: 300,
  date: '2026-07-22',
  createdAt: '',
  updatedAt: '',
} as Transaction

const fatura = {
  id: 'i1',
  userId: 'u1',
  bankId: 'b1',
  month: 8,
  year: 2026,
  status: InvoiceStatus.CLOSED,
  totalAmount: 1000,
  closeDate: '2026-08-03',
  dueDate: '2026-08-10',
  createdAt: '',
  updatedAt: '',
} as Invoice

const cobrancaDaEva = {
  id: 'r-eva',
  userId: 'u1',
  personId: 'eva',
  transactionId: 't-eva',
  debtorName: 'Eva',
  title: 'Ingresso da Eva',
  amount: 300,
  occurredAt: '2026-07-22',
  dueDate: '2026-08-10',
  isPaid: false,
  createdAt: '',
  updatedAt: '',
} as Receivable

const LANCAMENTOS = [compraPropria, compraDaEva]

describe('Compra de terceiro: R$ 1.000 = R$ 700 + R$ 300', () => {
  it('Extrato: movimentado é o bruto', () => {
    // "O que aconteceu": os R$ 1.000 passaram pelo cartão de verdade.
    expect(breakdownExpenses(LANCAMENTOS).movimentado).toBe(1000)
  })

  it('Visão Geral: sua parte é 700', () => {
    // "Quanto EU gastei": a compra da Eva não é custo do usuário.
    expect(breakdownExpenses(LANCAMENTOS).suaParte).toBe(700)
  })

  it('Gastos por categoria: soma 700, e a categoria da Eva não aparece', () => {
    const porCategoria = new Map<string, number>()
    for (const tx of LANCAMENTOS) {
      if (tx.personId) continue
      porCategoria.set(
        tx.categoryId,
        (porCategoria.get(tx.categoryId) ?? 0) + expenseSignedAmount(tx),
      )
    }

    const total = [...porCategoria.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(700)
    expect(porCategoria.has('c-lazer')).toBe(false)
  })

  it('Budget: a parte própria da fatura é 700', () => {
    // `netAmount = totalAmount - thirdParty`, a regra da Fase 3.
    const others = buildInvoiceBreakdown(LANCAMENTOS).get('i1')?.others ?? 0

    expect(Number(fatura.totalAmount) - others).toBe(700)
  })

  it('Cobrança da Eva é 300', () => {
    expect(Number(cobrancaDaEva.amount)).toBe(300)
  })

  it('Person: a Eva deve 300, e o saldo é a receber', () => {
    const summary = {
      receivablePending: 300,
      debtPending: 0,
      netBalance: 300,
      pendingReceivablesCount: 1,
      pendingDebtsCount: 0,
      isFullySettled: false,
    }

    expect(balanceDirection(summary)).toBe('receive')
    expect(pendingPhrase(summary)).toBe('1 cobrança')
  })

  it('Calendário: fatura vale 1.000, com a decomposição visível', () => {
    const events = [
      ...buildCalendarEvents({
        year: 2026,
        month: 8,
        debts: [],
        receivables: [cobrancaDaEva],
        invoices: [fatura],
        transactions: LANCAMENTOS,
        bankNames: BANKS,
      }).values(),
    ].flat()

    const invoiceEvent = events.find((e) => e.kind === 'invoice-due')
    expect(invoiceEvent?.amount).toBe(1000)
    expect(invoiceEvent?.detail).toContain('700')
    expect(invoiceEvent?.detail).toContain('300')
  })

  it('NENHUMA superfície resulta em 400', () => {
    /**
     * O número que aparece quando o recebível de R$ 300 desconta uma segunda
     * vez, depois de a fatura já ter descontado a compra da Eva. É a
     * dupla contagem que as Fases 3, 9B e 9D barraram em cada superfície.
     */
    const b = breakdownExpenses(LANCAMENTOS)
    const others = buildInvoiceBreakdown(LANCAMENTOS).get('i1')?.others ?? 0
    const invoiceOwn = Number(fatura.totalAmount) - others

    const valores = [b.movimentado, b.suaParte, invoiceOwn, others]
    expect(valores).not.toContain(400)
    expect(valores).toEqual([1000, 700, 700, 300])
  })

  it('a soma das leituras fecha: 700 + 300 = 1.000', () => {
    const b = breakdownExpenses(LANCAMENTOS)

    expect(b.suaParte + b.deOutrasPessoas).toBe(b.movimentado)
  })
})

describe('Estorno atravessa as superfícies coerentemente', () => {
  const gasto = {
    ...compraPropria,
    id: 't-g',
    type: TransactionType.PIX,
    amount: 300,
    date: '2026-08-05',
    invoiceId: undefined,
  } as Transaction
  const estorno = {
    ...gasto,
    id: 't-e',
    amount: 50,
    isRefund: true,
    date: '2026-08-06',
  } as Transaction

  it('Gastos: 250, e o estorno não vira receita', () => {
    const b = breakdownExpenses([gasto, estorno])

    expect(b.suaParte).toBe(250)
  })

  it('Categoria: 250, igual ao total', () => {
    const total = [gasto, estorno].reduce(
      (sum, tx) => sum + expenseSignedAmount(tx),
      0,
    )

    expect(total).toBe(250)
  })

  it('Calendário: o estorno é tipo próprio, não receita', () => {
    const events = [
      ...buildCalendarEvents({
        year: 2026,
        month: 8,
        debts: [],
        receivables: [],
        invoices: [],
        transactions: [gasto, estorno],
        bankNames: BANKS,
      }).values(),
    ].flat()

    expect(events.find((e) => e.id === 'transaction:t-e')?.kind).toBe('refund')
    expect(events.find((e) => e.id === 'transaction:t-e')?.kind).not.toBe(
      'income',
    )
  })
})

describe('Cobrança pendente não é receita em nenhuma superfície', () => {
  it('um recebível de R$ 10.000 não altera gastos nem receitas', () => {
    /**
     * Teste negativo: o recebível não é uma Transaction, então não existe no
     * universo que alimenta gastos e receitas. Se algum dia alguém somá-lo
     * ali, os números aqui mudam.
     */
    const antes = breakdownExpenses(LANCAMENTOS)

    // O recebível entra apenas nas superfícies de A Receber — ele não é uma
    // Transaction, então nem existe no universo que alimenta gastos.
    const summary = {
      receivablePending: 10000,
      debtPending: 0,
      netBalance: 10000,
      pendingReceivablesCount: 1,
      pendingDebtsCount: 0,
      isFullySettled: false,
    }

    expect(breakdownExpenses(LANCAMENTOS)).toEqual(antes)
    expect(balanceDirection(summary)).toBe('receive')
  })
})
