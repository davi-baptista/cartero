import { describe, expect, it } from 'vitest'
import { InvoiceStatus, TransactionType } from '@/types'
import type { Debt, Invoice, Receivable, Transaction } from '@/types'
import { buildCalendarEvents, buildInvoiceBreakdown } from './calendar-events'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Eventos do calendário financeiro (Fase 10)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O calendário responde "quais fatos financeiros têm data relevante neste
 * mês?". Cada evento fica no mês da SUA data — nunca é movido para o mês
 * visível, porque isso mentiria sobre quando o fato aconteceu.
 *
 * Os 24 cenários sondados na Fase 9D viraram os testes abaixo. A asserção é
 * sempre sobre o OUTPUT semântico (valor, direção, status, identidade), nunca
 * sobre como o builder chega lá.
 */

const BANKS = new Map([['b1', 'Nubank']])

function invoice(over: Partial<Invoice> & { id: string }): Invoice {
  return {
    id: over.id,
    userId: 'u1',
    bankId: over.bankId ?? 'b1',
    month: over.month ?? 8,
    year: over.year ?? 2026,
    status: over.status ?? InvoiceStatus.CLOSED,
    totalAmount: over.totalAmount ?? 1000,
    closeDate: over.closeDate ?? '2026-08-03',
    dueDate: over.dueDate ?? '2026-08-10',
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
    occurredAt: over.occurredAt ?? '2026-08-01',
    dueDate: over.dueDate ?? '2026-08-05',
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
    occurredAt: over.occurredAt ?? '2026-08-01',
    dueDate: over.dueDate ?? '2026-08-10',
    isPaid: over.isPaid ?? false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as Receivable
}

function transaction(
  over: Partial<Transaction> & { id: string; amount: number; date: string },
): Transaction {
  return {
    id: over.id,
    userId: 'u1',
    bankId: 'b1',
    categoryId: 'c1',
    type: over.type ?? TransactionType.PIX,
    title: over.title ?? 'Lançamento',
    amount: over.amount,
    date: over.date,
    invoiceId: over.invoiceId,
    personId: over.personId,
    isRefund: over.isRefund,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as Transaction
}

/** Todos os eventos do mês, achatados. */
function flat(map: Map<number, ReturnType<typeof buildCalendarEvents> extends Map<number, infer T> ? T : never>) {
  return [...map.values()].flat()
}

function build(over: {
  year?: number
  month?: number
  debts?: Debt[]
  receivables?: Receivable[]
  invoices?: Invoice[]
  transactions?: Transaction[]
}) {
  return buildCalendarEvents({
    year: over.year ?? 2026,
    month: over.month ?? 8,
    debts: over.debts ?? [],
    receivables: over.receivables ?? [],
    invoices: over.invoices ?? [],
    transactions: over.transactions ?? [],
    bankNames: BANKS,
  })
}

describe('Fatura', () => {
  const comTerceiro = {
    invoices: [invoice({ id: 'i1', totalAmount: 1000 })],
    transactions: [
      transaction({
        id: 't1',
        type: TransactionType.CREDIT_CARD,
        amount: 700,
        date: '2026-07-20',
        invoiceId: 'i1',
      }),
      transaction({
        id: 't2',
        type: TransactionType.CREDIT_CARD,
        amount: 300,
        date: '2026-07-22',
        invoiceId: 'i1',
        personId: 'eva',
      }),
    ],
  }

  it('o valor primário é o BRUTO', () => {
    // É o que o banco cobra no vencimento. Descontar terceiros aqui faria a
    // tela discordar da fatura real.
    const event = flat(build(comTerceiro)).find(
      (e) => e.kind === 'invoice-due',
    )

    expect(event?.amount).toBe(1000)
  })

  it('a decomposição aparece quando há terceiros', () => {
    const event = flat(build(comTerceiro)).find(
      (e) => e.kind === 'invoice-due',
    )

    expect(event?.detail).toContain('700')
    expect(event?.detail).toContain('300')
    expect(event?.detail).toContain('de outras pessoas')
  })

  it('sem terceiros, a decomposição é omitida', () => {
    // "R$ 700 seus · R$ 0 de outras pessoas" não informa nada — é ruído.
    const event = flat(
      build({
        invoices: [invoice({ id: 'i1', totalAmount: 700 })],
        transactions: [
          transaction({
            id: 't1',
            type: TransactionType.CREDIT_CARD,
            amount: 700,
            date: '2026-07-20',
            invoiceId: 'i1',
          }),
        ],
      }),
    ).find((e) => e.kind === 'invoice-due')

    expect(event?.detail).toBeUndefined()
  })

  it('fatura PAGA permanece no mês em que venceu', () => {
    /**
     * O calendário é registro de fatos do mês, não lista de pendências —
     * diferente de "Atenção agora", que exclui resolvidos.
     */
    const event = flat(
      build({
        invoices: [invoice({ id: 'i1', status: InvoiceStatus.PAID })],
      }),
    )[0]

    expect(event.status).toBe('Paga')
    expect(event.settled).toBe(true)
  })

  it('fatura de valor zero não gera evento', () => {
    expect(
      flat(build({ invoices: [invoice({ id: 'i1', totalAmount: 0 })] })),
    ).toHaveLength(0)
  })

  it('o vencimento usa a data persistida', () => {
    // Nunca derivada do Bank: a Fase 6B persistiu justamente para o histórico
    // parar de mudar quando a configuração do cartão muda.
    const map = build({
      invoices: [invoice({ id: 'i1', dueDate: '2026-08-17' })],
    })

    expect(map.get(17)).toHaveLength(1)
  })
})

describe('Dívida', () => {
  it('pendente antes do vencimento', () => {
    const event = flat(
      build({ debts: [debt({ id: 'd1', dueDate: '2099-08-05' })], year: 2099 }),
    )[0]

    expect(event.status).toBe('Pendente')
  })

  it('em atraso depois do vencimento', () => {
    // Vocabulário oficial: "Em atraso", nunca "Vencida".
    const event = flat(
      build({ debts: [debt({ id: 'd1', dueDate: '2020-08-05' })], year: 2020 }),
    )[0]

    expect(event.status).toBe('Em atraso')
  })

  it('paga mostra Pago', () => {
    const event = flat(
      build({ debts: [debt({ id: 'd1', isPaid: true })] }),
    )[0]

    expect(event.status).toBe('Pago')
    expect(event.settled).toBe(true)
  })

  it('vencida em junho NÃO reaparece em agosto', () => {
    /**
     * Decisão de produto da Fase 9D: mover a data para agosto mentiria sobre
     * quando o fato aconteceu. É "Atenção agora" que garante a permanência
     * visual do que está em atraso.
     */
    const junho = debt({ id: 'd1', dueDate: '2026-06-15' })

    expect(flat(build({ month: 8, debts: [junho] }))).toHaveLength(0)
    expect(flat(build({ month: 6, debts: [junho] }))).toHaveLength(1)
  })

  it('a direção é sempre saída', () => {
    const event = flat(build({ debts: [debt({ id: 'd1' })] }))[0]

    expect(event.direction).toBe('out')
  })
})

describe('Cobrança', () => {
  it('pendente NÃO usa a direção de entrada', () => {
    /**
     * O defeito corrigido na Fase 9D: pendente usava o verde de "recebido",
     * então dinheiro que TALVEZ entre era pintado como dinheiro que entrou.
     */
    const event = flat(
      build({
        receivables: [receivable({ id: 'r1', dueDate: '2099-08-10' })],
        year: 2099,
      }),
    )[0]

    expect(event.direction).toBe('neutral')
    expect(event.status).toBe('Pendente')
  })

  it('em atraso quando passou do vencimento', () => {
    const event = flat(
      build({
        receivables: [receivable({ id: 'r1', dueDate: '2020-08-10' })],
        year: 2020,
      }),
    )[0]

    expect(event.status).toBe('Em atraso')
  })

  it('recebida usa direção de entrada', () => {
    const event = flat(
      build({ receivables: [receivable({ id: 'r1', isPaid: true })] }),
    )[0]

    expect(event.direction).toBe('in')
    expect(event.status).toBe('Recebido')
    expect(event.settled).toBe(true)
  })
})

describe('Movimentações diretas', () => {
  it.each([
    ['PIX', TransactionType.PIX],
    ['débito', TransactionType.DEBIT_CARD],
    ['boleto', TransactionType.BOLETO],
  ])('%s aparece na data da transação, como saída', (_label, type) => {
    const map = build({
      transactions: [
        transaction({ id: 't1', type, amount: 120, date: '2026-08-15' }),
      ],
    })

    const event = map.get(15)?.[0]
    expect(event?.direction).toBe('out')
    expect(event?.amount).toBe(120)
  })

  it('receita aparece como entrada', () => {
    const event = flat(
      build({
        transactions: [
          transaction({
            id: 't1',
            type: TransactionType.INCOME,
            amount: 500,
            date: '2026-08-20',
          }),
        ],
      }),
    )[0]

    expect(event.kind).toBe('income')
    expect(event.direction).toBe('in')
  })

  it('estorno é tipo próprio, nem receita nem saída', () => {
    const event = flat(
      build({
        transactions: [
          transaction({
            id: 't1',
            amount: 50,
            date: '2026-08-08',
            isRefund: true,
          }),
        ],
      }),
    )[0]

    expect(event.kind).toBe('refund')
    expect(event.kind).not.toBe('income')
  })

  it('transação de outro mês não aparece', () => {
    expect(
      flat(
        build({
          month: 9,
          transactions: [
            transaction({ id: 't1', amount: 120, date: '2026-08-15' }),
          ],
        }),
      ),
    ).toHaveLength(0)
  })
})

describe('CREDIT_CARD é representado pela fatura', () => {
  it('a compra não gera evento próprio', () => {
    /**
     * Incluí-la criaria dois eventos para o mesmo dinheiro: um no dia da
     * compra e outro quando a fatura vence. A compra continua no Extrato.
     */
    const compra = transaction({
      id: 'c1',
      type: TransactionType.CREDIT_CARD,
      amount: 400,
      date: '2026-02-27',
      invoiceId: 'i9',
    })

    expect(flat(build({ month: 2, transactions: [compra] }))).toHaveLength(0)
  })

  it('a competência é o vencimento da fatura', () => {
    const map = build({
      month: 4,
      invoices: [
        invoice({
          id: 'i9',
          month: 4,
          totalAmount: 400,
          dueDate: '2026-04-10',
          status: InvoiceStatus.OPEN,
        }),
      ],
      transactions: [
        transaction({
          id: 'c1',
          type: TransactionType.CREDIT_CARD,
          amount: 400,
          date: '2026-02-27',
          invoiceId: 'i9',
        }),
      ],
    })

    const events = flat(map)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('invoice-due')
  })

  it('crédito órfão (sem fatura) não gera evento nem crasha', () => {
    // Estado legado possível. Nenhuma data é inventada como fallback.
    const orfa = transaction({
      id: 'orf',
      type: TransactionType.CREDIT_CARD,
      amount: 99,
      date: '2026-08-10',
    })

    expect(() => build({ transactions: [orfa] })).not.toThrow()
    expect(flat(build({ transactions: [orfa] }))).toHaveLength(0)
  })
})

describe('Fatos distintos coexistem', () => {
  it('cobrança recebida + entrada real são dois eventos', () => {
    /**
     * Vencimento (10/08) e entrada efetiva (20/08) são fatos diferentes. Não é
     * duplicidade: o calendário não soma eventos num total.
     */
    const map = build({
      receivables: [
        receivable({ id: 'r1', dueDate: '2026-08-10', isPaid: true }),
      ],
      transactions: [
        transaction({
          id: 'tp',
          type: TransactionType.INCOME,
          amount: 300,
          date: '2026-08-20',
        }),
      ],
    })

    expect(map.get(10)).toHaveLength(1)
    expect(map.get(20)).toHaveLength(1)
    expect(map.get(10)?.[0].id).not.toBe(map.get(20)?.[0].id)
  })

  it('dívida paga + transação do pagamento são dois eventos', () => {
    const map = build({
      debts: [debt({ id: 'd1', dueDate: '2026-08-05', isPaid: true })],
      transactions: [
        transaction({ id: 'tp', amount: 500, date: '2026-08-12' }),
      ],
    })

    expect(map.get(5)?.[0].status).toBe('Pago')
    expect(map.get(12)?.[0].kind).toBe('expense')
  })

  it('a fatura não é abatida por uma cobrança do mesmo dia', () => {
    // Sem compensação: obrigação com o banco e valor que Eva deve são coisas
    // distintas, mesmo caindo na mesma data.
    const map = build({
      invoices: [invoice({ id: 'i1', totalAmount: 1000, dueDate: '2026-08-10' })],
      receivables: [receivable({ id: 'r1', dueDate: '2026-08-10' })],
    })

    const day = map.get(10) ?? []
    expect(day).toHaveLength(2)
    expect(day.find((e) => e.kind === 'invoice-due')?.amount).toBe(1000)
  })
})

describe('Identidade e ordem', () => {
  it('a mesma entidade não entra duas vezes', () => {
    const repetida = debt({ id: 'd1' })

    expect(flat(build({ debts: [repetida, repetida] }))).toHaveLength(1)
  })

  it('a identidade é estável e não depende do índice', () => {
    const event = flat(build({ debts: [debt({ id: 'd1' })] }))[0]

    expect(event.id).toBe('debt:d1')
  })

  it('a ordem no dia é obrigação, cobrança, movimentação', () => {
    const map = build({
      invoices: [invoice({ id: 'i1', totalAmount: 100, dueDate: '2026-08-05' })],
      debts: [debt({ id: 'd1', dueDate: '2026-08-05' })],
      receivables: [receivable({ id: 'r1', dueDate: '2026-08-05' })],
      transactions: [transaction({ id: 't1', amount: 5, date: '2026-08-05' })],
    })

    expect(map.get(5)?.map((e) => e.kind)).toEqual([
      'invoice-due',
      'debt',
      'receivable',
      'expense',
    ])
  })
})

describe('Dia civil', () => {
  it('01/09 não aparece em agosto', () => {
    expect(
      flat(
        build({
          month: 8,
          transactions: [
            transaction({ id: 't1', amount: 1, date: '2026-09-01' }),
          ],
        }),
      ),
    ).toHaveLength(0)
  })

  it('timestamp ISO completo é lido pelo dia civil', () => {
    /**
     * A data pode chegar como `2026-09-01T02:00:00.000Z`. O builder recorta os
     * 10 primeiros caracteres em vez de passar por `Date`, então não há
     * conversão de fuso capaz de mover o evento de mês.
     */
    const map = build({
      month: 9,
      transactions: [
        transaction({
          id: 't1',
          amount: 1,
          date: '2026-09-01T02:00:00.000Z',
        }),
      ],
    })

    expect(map.get(1)).toHaveLength(1)
  })
})

describe('buildInvoiceBreakdown', () => {
  it('separa própria de terceiros por fatura', () => {
    const result = buildInvoiceBreakdown([
      transaction({
        id: 't1',
        type: TransactionType.CREDIT_CARD,
        amount: 700,
        date: '2026-07-20',
        invoiceId: 'i1',
      }),
      transaction({
        id: 't2',
        type: TransactionType.CREDIT_CARD,
        amount: 300,
        date: '2026-07-22',
        invoiceId: 'i1',
        personId: 'eva',
      }),
    ])

    expect(result.get('i1')).toEqual({ own: 700, others: 300 })
  })

  it('estorno abate a leitura correspondente', () => {
    const result = buildInvoiceBreakdown([
      transaction({
        id: 't1',
        type: TransactionType.CREDIT_CARD,
        amount: 700,
        date: '2026-07-20',
        invoiceId: 'i1',
      }),
      transaction({
        id: 't2',
        type: TransactionType.CREDIT_CARD,
        amount: 100,
        date: '2026-07-21',
        invoiceId: 'i1',
        isRefund: true,
      }),
    ])

    expect(result.get('i1')?.own).toBe(600)
  })

  it('transação sem fatura é ignorada', () => {
    const result = buildInvoiceBreakdown([
      transaction({ id: 't1', amount: 120, date: '2026-08-15' }),
    ])

    expect(result.size).toBe(0)
  })
})
