import { formatDate } from '@/lib/formatters'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O card do drawer tem dois modos, como a row da lista
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Abrindo um mês passado já quitado, o topo dizia:
 *
 *   Nada a acertar
 *   R$ 0,00
 *
 * Verdade sobre a pendência, e inútil como leitura: o mês pode ter
 * movimentado centenas de reais, e o card apagava isso. Para saber quanto foi,
 * o usuário tinha de somar as linhas do histórico logo abaixo.
 *
 * A causa é a mesma que a lista de Pessoas já corrigiu: o resumo saía de
 * `openItemsFor(...)`, que filtra só o que está EM ABERTO. Num mês liquidado
 * as listas voltam vazias, e zero é a resposta correta para a pergunta errada.
 *
 *   ABERTA    "quanto ainda falta acertar?"   → saldo em aberto
 *   QUITADA   "qual foi o saldo do mês?"      → saldo histórico
 *
 * ── A troca é sinalizada ──
 *
 * O título muda para "Saldo final do mês" e uma linha diz "Quitado em DD/MM".
 * Sem isso, um número que muda de base ao quitar o último item pareceria bug —
 * a mesma razão pela qual a row usa `SALDO FINAL`.
 *
 * ── E o vazio continua vazio ──
 *
 * Competência sem nenhum movimento não vira "saldo final de R$ 0,00": nunca
 * ter tido nada com a pessoa e ter quitado tudo são fatos diferentes.
 */

export type CompetenceCardMode = 'open' | 'settled' | 'empty'

/** O que o card precisa saber da competência. */
export interface CompetenceCardSource {
  /** Em aberto na competência. */
  openReceivableTotal: number
  openDebtTotal: number
  openItemCount: number
  /** Resolvidos da MESMA competência — o histórico do mês. */
  settledReceivableTotal: number
  settledDebtTotal: number
  settledItemCount: number
  /** `YYYY-MM-DD` da liquidação integral, ou `null`. */
  settledAt?: string | null
}

export interface CompetenceCard {
  mode: CompetenceCardMode
  /** Título acima do valor. */
  label: string
  /** O valor em destaque. */
  net: number
  /** Composição, sempre no universo que o valor representa. */
  receivableTotal: number
  debtTotal: number
  /** Linha de conclusão, ou `null` enquanto houver pendência. */
  settledNote: string | null
  /** O CTA de quitar só faz sentido com algo aberto. */
  showSettleAction: boolean
}

const EPSILON = 0.005

/** Houve movimento na competência, resolvido ou não? */
export function competenceHasActivity(s: CompetenceCardSource): boolean {
  return s.openItemCount > 0 || s.settledItemCount > 0
}

/**
 * O card da competência.
 *
 * ── A ordem das perguntas ──
 *
 *   1. há pendência?     → ABERTA   (mesmo com líquido zero)
 *   2. houve movimento?  → QUITADA
 *   3. nenhuma das duas  → VAZIA
 *
 * Pendência vem primeiro: é o único estado que pede ação, e confundi-lo com
 * resolvido é o erro mais caro dos três. R$ 200 abertos de cada lado dão
 * líquido zero com duas obrigações vivas — e continuam sendo ABERTA.
 */
export function competenceCard(s: CompetenceCardSource): CompetenceCard {
  if (s.openItemCount > 0) {
    const net = s.openReceivableTotal - s.openDebtTotal

    return {
      mode: 'open',
      label:
        net > EPSILON
          ? 'Saldo a receber'
          : net < -EPSILON
            ? 'Saldo a pagar'
            : /* Os dois lados abertos se anulam, mas há o que acertar. */
              'Saldo a acertar',
      net,
      receivableTotal: s.openReceivableTotal,
      debtTotal: s.openDebtTotal,
      settledNote: null,
      showSettleAction: true,
    }
  }

  if (competenceHasActivity(s)) {
    return {
      mode: 'settled',
      /*
        "Saldo final do mês" nomeia o que o número passou a ser. O título
        anterior falava de pendência ("Nada a acertar"), e mantê-lo sobre um
        valor histórico faria os dois se contradizerem.
      */
      label: 'Saldo final do mês',
      net: s.settledReceivableTotal - s.settledDebtTotal,
      receivableTotal: s.settledReceivableTotal,
      debtTotal: s.settledDebtTotal,
      /*
        A data quando ela é defensável; "Tudo quitado" quando não é. Vários
        itens podem ter sido resolvidos em dias diferentes, e o backend só
        afirma `settledAt` quando o agregado inteiro tem quando.
      */
      settledNote: s.settledAt
        ? `Quitado em ${formatDate(s.settledAt)}`
        : 'Tudo quitado',
      /* Nada aberto: não há o que quitar. */
      showSettleAction: false,
    }
  }

  return {
    mode: 'empty',
    label: 'Nada a acertar',
    net: 0,
    receivableTotal: 0,
    debtTotal: 0,
    settledNote: null,
    showSettleAction: false,
  }
}

/** O sinal do valor. Vazio quando o líquido é zero — não há direção. */
export function competenceCardSign(card: CompetenceCard): '+' | '-' | '' {
  if (card.net > EPSILON) return '+'
  if (card.net < -EPSILON) return '-'
  return ''
}
