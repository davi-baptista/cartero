import { InvoiceStatus } from '@/types'
import type { Debt, Invoice, Receivable, Transaction } from '@/types'
import { INVOICE_STATUS_LABEL } from '@/lib/invoice-status'
import { expenseSignedAmount } from '@/lib/money-semantics'
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
  /** Structural identity for contextual agenda grouping; never inferred from text. */
  personId?: string
  personName?: string
  entityId?: string
  bankId?: string
  /** Data civil do vencimento, compartilhada com a agenda contextual. */
  dueDate?: string
  /** Para onde a linha navega. */
  href: string
}

/** Rótulo do TIPO — o evento precisa ser legível sem depender de cor. */
export const CAL_KIND_LABEL: Record<CalEventKind, string> = {
  'invoice-due': 'Fatura',
  debt: 'Dívida',
  receivable: 'A Receber',
}

/** Cor do ponto por entidade; o status fica reservado à agenda contextual. */
export const CAL_KIND_DOT_CLASS: Record<CalEventKind, string> = {
  'invoice-due': 'bg-primary',
  debt: 'bg-destructive',
  receivable: 'bg-receivable',
}

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
  /**
   * "Hoje", em `YYYY-MM-DD` (TZ3) — decide `overdue` vs. `pending` via
   * `settlementStatus`. Opcional: por padrão usa o fuso do navegador
   * (`formatDateValue()`), o comportamento legado exato.
   */
  today?: string
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
      entityId: invoice.id,
      bankId: invoice.bankId,
      dueDate: invoice.dueDate,
    })
  }

  // ── Dívidas: vencimento ──
  for (const debt of input.debts) {
    const day = inMonth(debt.dueDate)
    if (day === null) continue

    const status = settlementStatus(debt, input.today)
    push(day, {
      id: `debt:${debt.id}`,
      kind: 'debt',
      title: debt.title,
      amount: Number(debt.amount),
      status: DEBT_STATUS[status],
      direction: 'out',
      settled: debt.isPaid,
      personId: debt.personId,
      personName: debt.person?.name,
      entityId: debt.id,
      dueDate: debt.dueDate,
      href: `/debts?highlight=${debt.id}`,
    })
  }

  // ── Cobranças: vencimento ──
  for (const receivable of input.receivables) {
    const day = inMonth(receivable.dueDate)
    if (day === null) continue

    const status = settlementStatus(receivable, input.today)
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
      personId: receivable.personId,
      personName: receivable.person?.name,
      entityId: receivable.id,
      dueDate: receivable.dueDate,
      href: `/receivables?highlight=${receivable.id}`,
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

/**
 * Eventos de um dia civil específico dentro do mapa já construído.
 *
 * Existe para a leitura "eventos deste dia" ter um nome — hoje só
 * `eventsByDay.get(day) ?? []` inline no componente. É a authority mínima
 * que o futuro widget "Cartero · Hoje" vai precisar (calendário com o dia
 * civil atual selecionado): ele não precisa de nada além de "dado um mapa de
 * eventos do mês e um dia, devolva a lista daquele dia". Não overengineer —
 * nenhuma noção de "hoje" mora aqui, só indexação por dia.
 */
export function eventsForDay(
  eventsByDay: ReadonlyMap<number, CalEvent[]>,
  day: number | null,
): CalEvent[] {
  if (day === null) return []
  return eventsByDay.get(day) ?? []
}

export type CalendarDayState = {
  allKinds: CalEventKind[]
  overdueKinds: CalEventKind[]
  visibleKinds: CalEventKind[]
  hasUnresolvedOverdue: boolean
}

/**
 * Deriva uma vez a representação de atenção de uma célula.
 *
 * A superfície vermelha e os dots precisam responder à mesma pergunta:
 * existe uma obrigação vencida que ainda não foi resolvida? Quando existe,
 * a célula mostra somente os tipos que ainda exigem atenção; caso contrário,
 * volta a representar todo o histórico do dia.
 */
export function calendarDayState(events: readonly CalEvent[]): CalendarDayState {
  const allKinds = [...new Set(events.map((event) => event.kind))]
  const overdueKinds = [
    ...new Set(
      events
        .filter((event) => !event.settled && event.status === 'Em atraso')
        .map((event) => event.kind),
    ),
  ]
  const hasUnresolvedOverdue = overdueKinds.length > 0

  return {
    allKinds,
    overdueKinds,
    visibleKinds: hasUnresolvedOverdue ? overdueKinds : allKinds,
    hasUnresolvedOverdue,
  }
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

/** `formatCurrency` local para o helper não depender de componente. */
function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}
