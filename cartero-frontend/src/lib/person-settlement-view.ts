import { formatDateValue } from '@/lib/date'
import type { SettlementCompetence } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Apresentação do acerto mensal com uma pessoa
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O drawer é MENSAL: um único seletor governa resumo, lista em aberto e
 * histórico. Ele responde "quanto eu e esta pessoa temos para acertar nesta
 * competência?".
 *
 * As competências (`referenceMonth`/`dueMonth`) vêm resolvidas do backend —
 * este módulo só decide o que mostrar e como rotular, para o settle e a tela
 * usarem exatamente o mesmo universo.
 */

/** O mínimo para posicionar um item no tempo. */
interface Timed {
  dueDate: string
  isPaid: boolean
  referenceMonth: SettlementCompetence
  dueMonth: SettlementCompetence
}

export function compareCompetence(
  a: SettlementCompetence,
  b: SettlementCompetence,
): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month
}

/** `YYYY-MM-DD` do vencimento, para comparar por dia civil. */
function dueDay(item: Timed): string {
  return item.dueDate.slice(0, 10)
}

/**
 * O item pertence ao universo desta competência?
 *
 * União de três condições — nasceu aqui, vence aqui, ou já venceu antes e
 * segue aberto. O retorno é booleano POR ITEM, então o mesmo item nunca gera
 * duas linhas quando satisfaz mais de uma.
 */
export function belongsToCompetence(
  item: Timed,
  selected: SettlementCompetence,
): boolean {
  if (item.isPaid) return false
  if (compareCompetence(item.referenceMonth, selected) === 0) return true
  if (compareCompetence(item.dueMonth, selected) === 0) return true
  // Carry-over: venceu antes desta competência e continua aberto.
  return compareCompetence(item.dueMonth, selected) < 0
}

export type DueState = 'overdue' | 'dueToday' | 'pending' | 'upcoming'

/**
 * Estado temporal do item visto da competência selecionada.
 *
 * `upcoming` ("A vencer") não é status persistido: é um item que veio de uma
 * competência anterior e vence nesta, ainda no prazo. Chamá-lo de "Em atraso"
 * seria falso; de "Pendente", perderia a informação de que veio de antes.
 *
 * No PRÓPRIO dia do vencimento o item ainda não está atrasado.
 */
export function dueStateOf(
  item: Timed,
  selected: SettlementCompetence,
  today = formatDateValue(),
): DueState {
  const due = dueDay(item)

  if (due < today) return 'overdue'
  if (due === today) return 'dueToday'

  return compareCompetence(item.referenceMonth, selected) < 0
    ? 'upcoming'
    : 'pending'
}

/** `10/09` — sem construir `Date`, para não deslocar o dia por fuso. */
function shortDate(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split('-')
  return `${day}/${month}`
}

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/**
 * Microcopy temporal completa de um item em aberto.
 *
 * Preserva três distinções que a lista mistura de propósito: o que está
 * atrasado, o que vence agora, e o que veio de outra competência.
 */
export function dueLabel(
  item: Timed,
  selected: SettlementCompetence,
  today = formatDateValue(),
): string {
  const state = dueStateOf(item, selected, today)
  const due = dueDay(item)
  const cameFromBefore =
    compareCompetence(item.referenceMonth, selected) < 0
  const origin = cameFromBefore
    ? ` · referente a ${MONTH_NAMES[item.referenceMonth.month - 1]}`
    : ''

  switch (state) {
    case 'overdue':
      return `Em atraso${origin} · venceu em ${shortDate(due)}`
    case 'dueToday':
      return `${cameFromBefore ? 'A vencer' : 'Pendente'}${origin} · vence hoje`
    case 'upcoming':
      return `A vencer${origin} · vence em ${shortDate(due)}`
    case 'pending':
      return `Pendente · vence em ${shortDate(due)}`
  }
}

/** Urgência temporal manda na ordem — não a data da compra de origem. */
const STATE_ORDER: Record<DueState, number> = {
  overdue: 0,
  dueToday: 1,
  upcoming: 2,
  pending: 3,
}

export function sortOpenItems<T extends Timed>(
  items: readonly T[],
  selected: SettlementCompetence,
  today = formatDateValue(),
): T[] {
  return [...items].sort((a, b) => {
    const byState =
      STATE_ORDER[dueStateOf(a, selected, today)] -
      STATE_ORDER[dueStateOf(b, selected, today)]
    if (byState !== 0) return byState
    return dueDay(a).localeCompare(dueDay(b))
  })
}

/** Item com valor, para os totais. */
type Monetary = Timed & { amount: number }

export interface CompetenceSummary {
  receivableTotal: number
  debtTotal: number
  /** `receivableTotal - debtTotal`. Informativo — não há compensação. */
  net: number
  itemCount: number
  /** Parcela que veio de competências anteriores, por lado. */
  carriedReceivable: number
  carriedDebt: number
  /** Itens ainda não vencidos — o diálogo de quitação avisa sobre eles. */
  notYetDueCount: number
  isEmpty: boolean
}

/**
 * Resumo do acerto da competência.
 *
 * O saldo é INFORMATIVO: quitar liquida cada item pelo próprio valor. Zero com
 * itens abertos é "saldo líquido zerado", nunca "tudo acertado".
 */
export function summarizeCompetence(
  /*
    Dois parâmetros de tipo distintos: recebível e dívida são entidades
    diferentes, e um único `<T>` obrigaria as duas listas a coincidirem.
  */
  receivables: readonly Monetary[],
  debts: readonly Monetary[],
  selected: SettlementCompetence,
  today = formatDateValue(),
): CompetenceSummary {
  const sum = (items: readonly Monetary[]) =>
    items.reduce((total, item) => total + Number(item.amount), 0)

  const carried = (items: readonly Monetary[]) =>
    items
      .filter((item) => compareCompetence(item.referenceMonth, selected) < 0)
      .reduce((total, item) => total + Number(item.amount), 0)

  const notYetDue = [...receivables, ...debts].filter(
    (item) => dueDay(item) > today,
  ).length

  const receivableTotal = sum(receivables)
  const debtTotal = sum(debts)

  return {
    receivableTotal,
    debtTotal,
    net: receivableTotal - debtTotal,
    itemCount: receivables.length + debts.length,
    carriedReceivable: carried(receivables),
    carriedDebt: carried(debts),
    notYetDueCount: notYetDue,
    isEmpty: receivables.length === 0 && debts.length === 0,
  }
}

/**
 * Seleciona os itens da competência, já ordenados.
 *
 * Genérico sobre o tipo CONCRETO (`SettlementItem<Debt>` etc.) para o chamador
 * não perder `id`, `amount` e os demais campos ao filtrar.
 */
export function openItemsFor<T extends Timed>(
  items: readonly T[],
  selected: SettlementCompetence,
  today = formatDateValue(),
): T[] {
  const eligible = items.filter((item) => belongsToCompetence(item, selected))
  return sortOpenItems(eligible, selected, today)
}

/**
 * Microcopy de um item RESOLVIDO no Histórico.
 *
 * O histórico é arquivado por `referenceMonth` — a competência a que o acerto
 * pertence —, e não pelo mês em que o dinheiro se moveu. Por isso a data real
 * da resolução precisa aparecer na linha: sem ela, uma dívida de julho paga em
 * setembro ficaria no mês certo mas sem dizer quando foi quitada.
 *
 * Quando o vencimento caiu em OUTRA competência, o contexto entra junto —
 * senão "Recebido em 15/10" dentro do histórico de agosto pareceria erro:
 *
 *   mesmo mês  → `Pago em 15/07/2026`
 *   outro mês  → `Venceu em 10/09 · recebido em 15/10`
 *
 * Sem `paidAt` (legado), cai no vencimento: nenhuma data é inventada.
 */
export function resolvedLabel(
  item: {
    dueDate: string
    paidAt?: string | null
    referenceMonth: SettlementCompetence
  },
  kind: 'debt' | 'receivable',
): string {
  const verb = kind === 'receivable' ? 'Recebido' : 'Pago'

  if (!item.paidAt) return `Venceu em ${shortDate(item.dueDate)}`

  const due = item.dueDate.slice(0, 10)
  const [dueYear, dueMonth] = due.split('-').map(Number)
  const venceuEmOutraCompetencia =
    dueYear !== item.referenceMonth.year ||
    dueMonth !== item.referenceMonth.month

  if (venceuEmOutraCompetencia) {
    return `Venceu em ${shortDate(due)} · ${verb.toLowerCase()} em ${shortDate(item.paidAt)}`
  }

  return `${verb} em ${fullDate(item.paidAt)}`
}

/** `15/09/2026` — sem construir `Date`, para não deslocar o dia por fuso. */
function fullDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}
