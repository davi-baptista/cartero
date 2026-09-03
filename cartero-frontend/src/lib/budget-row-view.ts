import {
  BANK_TRAILING_LABEL,
  BANK_TRAILING_TONE,
  bankTrailingState,
} from '@/lib/bank-invoice-selection'
import { timingUrgency } from '@/lib/invoice-timing'
import type { Invoice } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O Orçamento passa a falar a mesma língua de Bancos e Pessoas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * As rows tinham o estado numa BADGE ao lado do nome, e uma fatura paga acendia
 * quatro sinais de sucesso ao mesmo tempo — fundo do ícone, ícone, valor e
 * badge. A mesma informação em Bancos usa um: o status.
 *
 * Cada row responde quatro perguntas, duas por lado:
 *
 *   ESQUERDA   o que é? · o que acontece temporalmente?
 *   DIREITA    quanto? · qual é o estado?
 *
 * ── Este arquivo é APRESENTAÇÃO ──
 *
 * Nada aqui decide o que entra no Orçamento, quanto é a sua parte, o que é
 * carry ou como uma competência é calculada. Recebe o que o backend já
 * fechou e escolhe rótulo e tom.
 *
 * ── E reusa as policies que já existem ──
 *
 * `bankTrailingState` + `BANK_TRAILING_LABEL`/`TONE` para o estado da fatura,
 * `invoiceTimingLabel`/`invoiceTimingClass` para o prazo dela, `timingUrgency`
 * para o prazo de uma dívida. Uma terceira definição de "fatura vencida" ou de
 * "quantos dias são urgentes" faria o mesmo fato aparecer diferente em duas
 * telas — e ninguém compara telas, só estranha a incoerência.
 */

/** O estado da fatura, no vocabulário de Bancos. */
export function budgetInvoiceStatus(invoice: Invoice): {
  label: string
  tone: string
} {
  const state = bankTrailingState(invoice)
  return { label: BANK_TRAILING_LABEL[state], tone: BANK_TRAILING_TONE[state] }
}

/**
 * O tom do prazo de uma dívida ou acerto.
 *
 * `timingUrgency` é a régua compartilhada (`URGENT_DAYS_WINDOW = 7`), a mesma
 * de Bancos, de Pessoas e da "Atenção agora".
 *
 *   atrasado   destructive   exige ação agora
 *   hoje/≤7d   pending       ainda dá tempo, mas não muito
 *   depois     neutro        é informação, não alerta
 *
 * Resolvido não passa por aqui: uma dívida paga não tem prazo a cumprir, e
 * colorir a data faria a linha parecer pendente.
 */
export function budgetDueTone(dueDate: string, resolved = false): string {
  if (resolved) return ''

  /*
    Dia civil por string, nunca `new Date('YYYY-MM-DD')` — este último é lido
    como UTC e, em fuso negativo, devolve o dia anterior.
  */
  const [year, month, day] = dueDate.slice(0, 10).split('-').map(Number)

  switch (timingUrgency(new Date(year, month - 1, day))) {
    case 'overdue':
      return 'text-destructive'
    case 'today':
    case 'soon':
      return 'text-pending'
    case 'later':
      return ''
  }
}

/**
 * ── "Tudo em dia" ──
 *
 * A frase que Bancos e Pessoas já usam quando nada resta a fazer, no mesmo
 * lugar da tela e no mesmo `text-paid`.
 *
 * Os dois agregados vêm FECHADOS do backend, os mesmos que alimentam a linha
 * "R$ X pago · R$ Y a pagar". Somar status item a item no cliente abriria
 * espaço para a tela discordar do total por um centavo — e este helper é
 * apresentação, não uma segunda contabilidade.
 *
 * ── Três estados, não dois ──
 *
 *   nada aconteceu       nenhum dos dois        sem frase de conclusão
 *   há pendência         totalPending > 0       a composição já explica
 *   tudo resolvido       só totalPaid > 0       "Tudo em dia"
 *
 * O primeiro caso é o que exige cuidado: um mês vazio tem `totalPending: 0`
 * como um mês inteiramente quitado, e sem checar `totalPaid` a tela
 * parabenizaria quem simplesmente não teve obrigação nenhuma. Nunca ter tido
 * e ter quitado todas são fatos diferentes — a mesma distinção que Bancos faz
 * com "Nenhuma fatura neste mês".
 *
 * O total permanece NEUTRO em todos os casos. Quem comunica o estado é esta
 * linha, não o número.
 */
export function budgetAllSettled(summary: {
  totalPaid: number
  totalPending: number
}): boolean {
  /* Tolerância de centavo, a mesma das outras superfícies. */
  const EPSILON = 0.005

  return summary.totalPaid > EPSILON && summary.totalPending <= EPSILON
}
