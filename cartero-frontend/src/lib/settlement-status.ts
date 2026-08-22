import { formatDateValue } from './date'

/**
 * Status de uma pendência — fonte única para Dívidas e A Receber.
 *
 * O cálculo estava duplicado byte a byte nas duas páginas (`isOverdue`,
 * `StatusDot` e o badge da linha), e o vocabulário já havia divergido: o badge
 * dizia "Em atraso", o contador de A Receber dizia "atrasada" e o de Dívidas
 * dizia "vencida" — três palavras para um estado, duas delas proibidas por
 * `invoice-status.ts`.
 *
 * O status é DERIVADO de `isPaid` + `dueDate`; não existe enum persistido, e
 * criar um só para facilitar a UI colocaria no banco uma informação que muda
 * de valor sozinha à meia-noite.
 */

export type SettlementStatus = 'paid' | 'overdue' | 'pending'

interface Settleable {
  isPaid: boolean
  /** ISO date-only (`YYYY-MM-DD`) ou timestamp ISO. */
  dueDate: string
}

/**
 * Comparação por string ISO, não por `Date`.
 *
 * `dueDate` pode vir como `"2026-09-10"` ou como timestamp completo; o
 * `slice(0, 10)` normaliza os dois, e a ordem lexicográfica de `YYYY-MM-DD`
 * coincide com a cronológica. Evita a armadilha de `new Date(iso)` cair no dia
 * anterior em fuso negativo.
 */
export function settlementStatus(item: Settleable): SettlementStatus {
  if (item.isPaid) return 'paid'

  const today = formatDateValue()
  return item.dueDate.slice(0, 10) < today ? 'overdue' : 'pending'
}

/** `true` quando venceu e continua em aberto. */
export function isOverdue(item: Settleable): boolean {
  return settlementStatus(item) === 'overdue'
}

/**
 * Rótulos por domínio.
 *
 * A conclusão tem nome diferente nos dois: uma dívida é "Paga", uma cobrança é
 * "Recebida". Pendente e em atraso são iguais — e "Em atraso" é o vocabulário
 * oficial, nunca "Vencido" ou "Atrasado".
 */
export const DEBT_STATUS_LABEL: Record<SettlementStatus, string> = {
  // "Pago" — o vocabulário oficial de Debt. `calendar-events.ts` já usava
  // esta forma, e ter as duas em telas diferentes é a mesma deriva que as
  // fases anteriores corrigiram com "Em atraso".
  paid: 'Pago',
  overdue: 'Em atraso',
  pending: 'Pendente',
}

export const RECEIVABLE_STATUS_LABEL: Record<SettlementStatus, string> = {
  paid: 'Recebida',
  overdue: 'Em atraso',
  pending: 'Pendente',
}

/**
 * Classes de cor por status.
 *
 * `pending` usa o token de atenção e `overdue` o destrutivo. Recebível
 * pendente NÃO usa verde só porque é dinheiro entrando — o verde é de
 * conclusão, e a Fase 4 corrigiu isso justamente aqui.
 */
export const SETTLEMENT_STATUS_TEXT: Record<SettlementStatus, string> = {
  paid: 'text-paid',
  overdue: 'text-destructive',
  pending: 'text-pending',
}

export const SETTLEMENT_STATUS_DOT: Record<SettlementStatus, string> = {
  paid: 'bg-paid',
  overdue: 'bg-destructive',
  pending: 'bg-pending',
}

/**
 * Plural do contador de itens em atraso.
 *
 * Existe para os cabeçalhos não voltarem a inventar "vencida"/"atrasada": o
 * texto sai de um só lugar.
 */
export function overdueCountLabel(count: number, domain: 'debt' | 'receivable') {
  const noun = domain === 'debt' ? 'dívida' : 'cobrança';
  const plural = domain === 'debt' ? 'dívidas' : 'cobranças';
  return `${count} ${count === 1 ? noun : plural} em atraso`
}
