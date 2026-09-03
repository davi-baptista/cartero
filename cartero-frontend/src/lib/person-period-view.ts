import type { NextSettlementItem } from '@/lib/person-next-item'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A row de Pessoas mostra o que HOUVE, e diz separadamente se foi resolvido
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Antes o valor era o saldo em ABERTO. Um mês inteiramente quitado virava
 * R$ 0,00 em todas as linhas, com "SEM SALDO" ao lado — e a lista deixava de
 * responder "quem devia a quem naquele mês?". Reconstruir o histórico exigia
 * abrir pessoa por pessoa.
 *
 * A separação é a mesma que Bancos já usa: uma fatura paga conserva o
 * `totalAmount` e muda o STATUS para "Paga". O valor responde "quanto houve no
 * ciclo"; o status responde "isso ainda está pendente?".
 *
 *   valor    período (pendências + resolvidos), invariável ao settlement
 *   status   derivado do que RESTA em aberto
 *
 * ── Sinal ──
 *
 * Positivo: a pessoa te deve. Negativo: você deve a ela. A convenção não muda
 * — só passa a ser calculada sobre o histórico em vez do saldo aberto.
 */

export type PersonRowStatus =
  | 'receivable'
  | 'debt'
  | 'received'
  | 'paid'
  | 'empty'

/** O mínimo que a row precisa saber da competência. */
export interface PeriodBalance {
  netBalance: number
  periodReceivableTotal: number
  periodDebtTotal: number
  settledReceivablesCount: number
  settledDebtsCount: number
  nextItem?: NextSettlementItem | null
}

const EPSILON = 0.005

/** O líquido HISTÓRICO do mês — o número que a row exibe. */
export function periodNetAmount(b: PeriodBalance): number {
  return b.periodReceivableTotal - b.periodDebtTotal
}

/** A competência movimentou algo, resolvido ou não? */
export function hasPeriodActivity(b: PeriodBalance): boolean {
  return (
    b.periodReceivableTotal > EPSILON ||
    b.periodDebtTotal > EPSILON ||
    b.settledReceivablesCount > 0 ||
    b.settledDebtsCount > 0
  )
}

/**
 * O status da row.
 *
 * ── A ordem das perguntas importa ──
 *
 * Primeiro "houve movimento?", depois "restou algo?". Inverter faria um mês
 * inteiramente resolvido cair em `empty` — o bug que esta fase corrige.
 *
 * ── Misto resolvido segue o sinal do líquido ──
 *
 * Com R$ 500 recebidos e R$ 200 pagos, a row diz `RECEBIDO`. Decisão de
 * produto: menos vocabulário na lista, e a composição dos dois lados fica no
 * drawer, onde há espaço para ela.
 */
export function personRowStatus(b: PeriodBalance): PersonRowStatus {
  if (!hasPeriodActivity(b)) return 'empty'

  /* Ainda há pendência: o status fala do que resta, não do que já foi. */
  if (Math.abs(b.netBalance) > EPSILON) {
    return b.netBalance > 0 ? 'receivable' : 'debt'
  }

  /*
    Nada em aberto, mas houve movimento — o mês está resolvido.

    O líquido histórico decide a palavra. Zero histórico com movimento (R$ 200
    de cada lado, tudo quitado) cai em `received` por convenção: a lista
    precisa de UMA palavra, e "resolvido" nos dois sentidos não distingue nada
    que o valor já não diga.
  */
  return periodNetAmount(b) < -EPSILON ? 'paid' : 'received'
}

/** Copy oficial do trailing. Texto, nunca só cor. */
export const PERSON_ROW_LABEL: Record<PersonRowStatus, string> = {
  receivable: 'A RECEBER',
  debt: 'VOCÊ DEVE',
  received: 'RECEBIDO',
  paid: 'PAGO',
  empty: 'SEM SALDO',
}

/**
 * Tom do trailing.
 *
 * Resolvido usa o verde de sucesso — o mesmo `text-paid` de uma fatura paga.
 * Pendente mantém a direção econômica que a lista já comunicava.
 */
export const PERSON_ROW_TONE: Record<PersonRowStatus, string> = {
  receivable: 'text-receivable',
  debt: 'text-destructive',
  received: 'text-paid',
  paid: 'text-paid',
  empty: 'text-muted-foreground',
}

/**
 * Subtexto de um mês resolvido.
 *
 * Ocupa o lugar do próximo evento, que já não existe — deixar "Receber em 12d"
 * numa linha quitada seria afirmar uma pendência inexistente.
 *
 * Sem data: várias obrigações podem ter sido resolvidas em dias diferentes, e
 * escolher uma seria inventar. A data real de cada uma está no drawer.
 */
export function resolvedSubtext(status: PersonRowStatus): string | null {
  if (status === 'received') return 'Recebido'
  if (status === 'paid') return 'Pago'
  return null
}
