import { InvoiceStatus, TransactionType } from '@/types'
import type { Debt, Invoice, Receivable, Transaction } from '@/types'
import { INVOICE_STATUS_LABEL } from '@/lib/invoice-status'
import { expenseSignedAmount, isIncomeTransaction } from '@/lib/money-semantics'
import { settlementStatus } from '@/lib/settlement-status'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Eventos do calendário financeiro
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O calendário responde: **"quais fatos financeiros têm uma data relevante
 * neste mês?"**
 *
 * Cada evento fica no mês da SUA data — nunca é movido para o mês visível.
 * Uma dívida vencida em junho e ainda aberta pertence ao calendário de junho,
 * não ao de agosto: mover a data mentiria sobre quando o fato aconteceu. Quem
 * garante a permanência visual do que está em atraso é o painel "Atenção
 * agora", que é current-state por definição.
 *
 * Este módulo é **puro**: recebe as listas já carregadas e devolve o mapa de
 * eventos. Nenhum fetch aqui — é o que permite testá-lo na Fase 10.
 */

export type CalEventKind =
  | 'invoice-due'
  | 'debt'
  | 'receivable'
  | 'expense'
  | 'income'
  | 'refund'

/** Direção do dinheiro — separada do STATUS. */
export type CalEventDirection = 'out' | 'in' | 'neutral'

export interface CalEvent {
  /**
   * Identidade estável: `<kind>:<entityId>`.
   *
   * Antes a lista usava o índice do array como key. Além de instável, isso
   * impedia detectar a mesma entidade entrando duas vezes.
   */
  id: string
  kind: CalEventKind
  title: string
  amount: number
  /** Vocabulário oficial: "Em atraso", nunca "Vencida"/"Atrasada". */
  status: string
  direction: CalEventDirection
  /** `true` quando o fato já se concluiu (pago, recebido, faturado). */
  settled: boolean
  /** Contexto secundário — hoje, a decomposição da fatura. */
  detail?: string
  /** Para onde a linha navega. */
  href: string
}

/** Rótulo do TIPO — o evento precisa ser legível sem depender de cor. */
export const CAL_KIND_LABEL: Record<CalEventKind, string> = {
  'invoice-due': 'Fatura',
  debt: 'Dívida',
  receivable: 'A receber',
  expense: 'Saída',
  income: 'Receita',
  refund: 'Estorno',
}

/**
 * Tipos de Transaction que acontecem NA DATA da transação.
 *
 * `CREDIT_CARD` fica de fora de propósito: no calendário, crédito é
 * representado pelo vencimento da fatura. Incluir a compra também criaria dois
 * eventos para o mesmo dinheiro — um no dia da compra e outro quando a fatura
 * vence — e o calendário deixaria de dizer o que significa.
 */
const DIRECT_TYPES: readonly TransactionType[] = [
  TransactionType.DEBIT_CARD,
  TransactionType.PIX,
  TransactionType.BOLETO,
  TransactionType.INCOME,
]

/** Extrai (ano, mês, dia) de uma data ISO sem passar por `Date`. */
function civilParts(iso: string): [number, number, number] {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return [year, month, day]
}

/**
 * Decomposição das faturas por `invoiceId`, numa única passagem.
 *
 * Uma fatura de R$ 1.000 com R$ 300 de compras da Eva vale R$ 1.000 no
 * vencimento — é o que o banco cobra. Mas a tela precisa poder dizer que
 * R$ 700 são do usuário, senão o mesmo mês aparece com dois números sem
 * explicação (o card de categorias mostra R$ 700).
 *
 * `Map` construído de uma vez: nada de `invoices.map(fetch)` por fatura.
 */
export function buildInvoiceBreakdown(
  transactions: readonly Transaction[],
): Map<string, { own: number; others: number }> {
  const byInvoice = new Map<string, { own: number; others: number }>()

  for (const tx of transactions) {
    if (!tx.invoiceId) continue
    const signed = expenseSignedAmount(tx)
    if (signed === 0) continue

    const entry = byInvoice.get(tx.invoiceId) ?? { own: 0, others: 0 }
    if (tx.personId) entry.others += signed
    else entry.own += signed
    byInvoice.set(tx.invoiceId, entry)
  }

  return byInvoice
}

export interface CalendarInput {
  year: number
  month: number
  debts: readonly Debt[]
  receivables: readonly Receivable[]
  invoices: readonly Invoice[]
  transactions: readonly Transaction[]
  /** Nome do banco por id — evita `banks.find()` dentro do laço. */
  bankNames: ReadonlyMap<string, string>
}

/**
 * Ordem dos eventos dentro de um dia.
 *
 * Obrigações primeiro (é o que exige ação), depois o que se espera receber,
 * depois o que já se movimentou. Antes a ordem era a incidental dos arrays de
 * entrada, então mudava sem motivo aparente.
 */
const KIND_ORDER: Record<CalEventKind, number> = {
  'invoice-due': 0,
  debt: 1,
  receivable: 2,
  expense: 3,
  refund: 4,
  income: 5,
}

export function buildCalendarEvents(
  input: CalendarInput,
): Map<number, CalEvent[]> {
  const { year, month, bankNames } = input
  const map = new Map<number, CalEvent[]>()
  /** Protege contra a mesma entidade entrar duas vezes pelo mesmo tipo. */
  const seen = new Set<string>()

  function push(day: number, event: CalEvent) {
    if (day < 1 || seen.has(event.id)) return
    seen.add(event.id)
    const list = map.get(day) ?? []
    list.push(event)
    map.set(day, list)
  }

  /** `true` quando a data ISO cai no mês exibido. */
  function inMonth(iso: string): number | null {
    const [y, m, d] = civilParts(iso)
    return y === year && m === month ? d : null
  }

  /*
    Decomposição calculada UMA vez, fora do laço.

    Construí-la dentro do `for` refaria a varredura de todas as transações por
    fatura — O(n·m), o mesmo padrão que a Fase 6B removeu de outra tela.
  */
  const invoiceBreakdown = buildInvoiceBreakdown(input.transactions)

  // ── Faturas: vencimento ──
  for (const invoice of input.invoices) {
    if (Number(invoice.totalAmount) === 0) continue
    const day = inMonth(invoice.dueDate)
    if (day === null) continue

    /*
      Fatura PAGA continua no calendário do mês em que venceu.

      O calendário é registro de fatos do mês, não lista de pendências —
      diferente de "Atenção agora", que exclui resolvidos.
    */
    const breakdown = invoiceBreakdown.get(invoice.id)
    const others = breakdown?.others ?? 0
    const own = breakdown?.own ?? 0

    push(day, {
      id: `invoice:${invoice.id}`,
      kind: 'invoice-due',
      title: bankNames.get(invoice.bankId) ?? 'Fatura',
      /** BRUTO: é o valor que o banco cobra no vencimento. */
      amount: Number(invoice.totalAmount),
      status: INVOICE_STATUS_LABEL[invoice.status],
      direction: 'out',
      settled: invoice.status === InvoiceStatus.PAID,
      /*
        Sem terceiros, a decomposição é ruído: "R$ 700 seus · R$ 0 de outras
        pessoas" não informa nada que o total já não diga.
      */
      detail:
        others > 0
          ? `${formatBRL(own)} seus · ${formatBRL(others)} de outras pessoas`
          : undefined,
      href: `/banks/${invoice.bankId}/invoices`,
    })
  }

  // ── Dívidas: vencimento ──
  for (const debt of input.debts) {
    const day = inMonth(debt.dueDate)
    if (day === null) continue

    const status = settlementStatus(debt)
    push(day, {
      id: `debt:${debt.id}`,
      kind: 'debt',
      title: debt.title,
      amount: Number(debt.amount),
      status: DEBT_STATUS[status],
      direction: 'out',
      settled: debt.isPaid,
      href: `/debts?highlight=${debt.id}`,
    })
  }

  // ── Cobranças: vencimento ──
  for (const receivable of input.receivables) {
    const day = inMonth(receivable.dueDate)
    if (day === null) continue

    const status = settlementStatus(receivable)
    push(day, {
      id: `receivable:${receivable.id}`,
      kind: 'receivable',
      title: receivable.title,
      amount: Number(receivable.amount),
      status: RECEIVABLE_STATUS[status],
      /*
        Pendente NÃO é entrada de dinheiro.

        A versão anterior pintava recebível pendente de verde, o mesmo token de
        recebido — dinheiro que talvez entre lido como dinheiro que entrou.
      */
      direction: receivable.isPaid ? 'in' : 'neutral',
      settled: receivable.isPaid,
      href: `/receivables?highlight=${receivable.id}`,
    })
  }

  // ── Movimentações diretas: data da transação ──
  for (const tx of input.transactions) {
    if (!DIRECT_TYPES.includes(tx.type)) continue
    const day = inMonth(tx.date)
    if (day === null) continue

    const isRefund = Boolean(tx.isRefund)
    const income = isIncomeTransaction(tx)

    push(day, {
      id: `transaction:${tx.id}`,
      /*
        Estorno é tipo próprio: não é receita (não infla entrada) nem saída
        (devolve dinheiro). A distinção já vale no Extrato.
      */
      kind: isRefund ? 'refund' : income ? 'income' : 'expense',
      title: tx.title,
      amount: Number(tx.amount),
      status: TRANSACTION_STATUS[isRefund ? 'refund' : income ? 'income' : 'expense'],
      direction: isRefund || income ? 'in' : 'out',
      /** Transação é fato consumado por definição — ela só existe se ocorreu. */
      settled: true,
      detail: tx.category?.name,
      /* Reusa o deep-link da Fase 8B em vez de criar um segundo mecanismo. */
      href: `/transactions?startDate=${tx.date.slice(0, 10)}&endDate=${tx.date.slice(0, 10)}&highlight=${tx.id}`,
    })
  }

  // Ordem estável: tipo, depois título.
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.title.localeCompare(b.title, 'pt-BR'),
    )
  }

  return map
}

const DEBT_STATUS: Record<'paid' | 'overdue' | 'pending', string> = {
  paid: 'Pago',
  overdue: 'Em atraso',
  pending: 'Pendente',
}

const RECEIVABLE_STATUS: Record<'paid' | 'overdue' | 'pending', string> = {
  paid: 'Recebido',
  overdue: 'Em atraso',
  pending: 'Pendente',
}

const TRANSACTION_STATUS: Record<'expense' | 'income' | 'refund', string> = {
  expense: 'Pago',
  income: 'Recebido',
  refund: 'Estornado',
}

/** `formatCurrency` local para o helper não depender de componente. */
function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}
