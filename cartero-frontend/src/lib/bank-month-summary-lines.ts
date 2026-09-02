import type { BankMonthSummary } from '@/lib/bank-invoice-selection'
import { invoiceSectionParts } from '@/lib/invoice-composition'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O que dizer abaixo do total do mês
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O resumo dizia sempre a mesma coisa, e por isso frequentemente se repetia:
 *
 *   R$ 1.173,95
 *   1 fatura · R$ 1.173,95 em aberto
 *
 * Quando nada foi pago — o caso mais comum — o "em aberto" é o próprio total,
 * então a linha secundária gastava espaço para repetir o número de cima.
 *
 * A regra passa a ser: **cada linha só aparece quando acrescenta um fato que o
 * total não conta.**
 *
 *   composição   quanto do total é seu e quanto é de outras pessoas
 *   quitação     quanto falta, mas só quando difere do total
 *
 * Duas linhas no máximo. Acima disso o resumo começa a competir com a lista,
 * que é o conteúdo principal da tela.
 *
 * ── "Faltam X para quitar" não é pagamento parcial ──
 *
 * X é a soma das faturas do mês que ainda não estão `PAID` — o valor cai
 * quando uma fatura é quitada INTEIRA. Nenhuma fatura tem saldo parcial neste
 * domínio, e esta linha não introduz um.
 *
 * ── Nem tudo que está pendente é urgente ──
 *
 * A quitação sai em tom neutro. Pendência é o estado normal de um mês em
 * curso; o âmbar fica reservado ao prazo nas rows, onde significa "isto vence
 * logo". Colorir o resumo faria a tela inteira parecer um alerta.
 */

export type SummaryLine =
  | { kind: 'empty'; text: string }
  | {
      kind: 'composition'
      parts: Array<{ kind: 'own' | 'thirdParty'; amount: number }>
    }
  | { kind: 'remaining'; amount: number }
  | { kind: 'settled'; text: string }
  | { kind: 'count'; text: string }

/** Tolerância de centavo, a mesma de `invoiceSectionParts`. */
const EPSILON = 0.005

export function bankMonthSummaryLines(
  summary: BankMonthSummary,
): SummaryLine[] {
  /*
    Nenhuma fatura NÃO é "tudo em dia".

    Um mês sem fatura e um mês inteiramente quitado são fatos diferentes, e
    parabenizar quem simplesmente não gastou seria afirmar algo que não
    aconteceu.
  */
  if (summary.invoiceCount === 0) {
    return [{ kind: 'empty', text: 'Nenhuma fatura neste mês' }]
  }

  const linhas: SummaryLine[] = []

  /*
    A composição usa a MESMA função do Orçamento e do detalhe da fatura, que já
    omite o lado ausente: sem terceiros, "R$ X sua parte" repetiria o total.
  */
  const parts = invoiceSectionParts({
    gross: summary.total,
    own: summary.own,
    thirdParty: summary.thirdParty,
  })
  const temTerceiros = parts.some((p) => p.kind === 'thirdParty')

  if (temTerceiros) linhas.push({ kind: 'composition', parts })

  const tudoPago = summary.unpaid <= EPSILON
  const nadaPago = Math.abs(summary.unpaid - summary.total) <= EPSILON

  if (tudoPago) {
    linhas.push({ kind: 'settled', text: 'Tudo em dia' })
    return linhas
  }

  /*
    Quitação parcial ENTRE faturas: o valor restante é diferente do total, e
    esse é justamente o caso em que a informação não é redundante.
  */
  if (!nadaPago) {
    linhas.push({ kind: 'remaining', amount: summary.unpaid })
    return linhas
  }

  /*
    Nada pago ainda. O valor em aberto É o total, então dizer o número de novo
    não informa nada — e com a composição presente, uma segunda linha só para
    anunciar que tudo está aberto deixaria o bloco pesado sem motivo.
  */
  if (!temTerceiros) {
    linhas.push({
      kind: 'count',
      text: `${summary.invoiceCount} ${
        summary.invoiceCount === 1 ? 'fatura em aberto' : 'faturas em aberto'
      }`,
    })
  }

  return linhas
}
