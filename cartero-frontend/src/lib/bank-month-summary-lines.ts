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

/**
 * Em que ciclo o mês exibido está, em relação a hoje.
 *
 * Subiu para cá do trailing das rows: ali se repetia linha a linha e
 * atrapalhava a leitura do estado de cada fatura. No resumo vale uma vez para
 * o mês inteiro, que é o escopo natural da informação.
 */
export type MonthCycle = 'current' | 'future' | 'past'

export type SummaryLine =
  | { kind: 'empty'; text: string }
  | {
      kind: 'composition'
      parts: Array<{ kind: 'own' | 'thirdParty'; amount: number }>
    }
  /**
   * A linha de ciclo, com o progresso de quitação como COMPLEMENTO opcional.
   *
   * Antes o ciclo viajava dentro de `remaining` e `count` — duas linhas que
   * cada uma tinha sua própria condição de existir. No mês corrente sem nada
   * pago e COM terceiros, nenhuma das duas era emitida, e "Faturas atuais"
   * desaparecia junto: o rótulo do ciclo dependia, por acidente, do estado de
   * pagamento.
   *
   * Agora são conceitos independentes. O ciclo é um fato do CALENDÁRIO — o mês
   * exibido é o corrente ou não — e não muda quando uma fatura é paga. O
   * complemento é um fato de QUITAÇÃO, e continua condicional.
   */
  | {
      kind: 'cycle'
      cycle: MonthCycle
      /** `null` quando o valor pendente repetiria o total exibido acima. */
      remaining: number | null
      /** Contagem, quando não há complemento nem terceiros a mostrar. */
      count: string | null
    }
  | { kind: 'settled'; text: string }

/** Rótulo do ciclo. `past` fica sem rótulo — ver `cycleLabel`. */
export const CYCLE_LABEL: Record<MonthCycle, string | null> = {
  current: 'Faturas atuais',
  future: 'Faturas futuras',
  /*
    Mês passado não recebe rótulo.

    "Faturas passadas" seria redundante — o seletor já diz o mês, e o estado
    de cada fatura aparece na row. O caso relevante do passado é a fatura em
    atraso, e essa se anuncia sozinha: vermelho na row e no "Faltam".
  */
  past: null,
}

/** O ciclo do mês exibido contra o mês de hoje. */
export function monthCycleOf(
  period: { month: number; year: number },
  today: { month: number; year: number },
): MonthCycle {
  if (period.year !== today.year) {
    return period.year > today.year ? 'future' : 'past'
  }
  if (period.month === today.month) return 'current'
  return period.month > today.month ? 'future' : 'past'
}

/** Tolerância de centavo, a mesma de `invoiceSectionParts`. */
const EPSILON = 0.005

export function bankMonthSummaryLines(
  summary: BankMonthSummary,
  cycle: MonthCycle = 'current',
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

  /*
    Tudo quitado encerra a linha secundária.

    "Tudo em dia" já é conclusivo, e prefixá-lo com "Faturas atuais ·" só
    adicionaria palavra a algo que não pede contexto — nada resta a fazer,
    seja o mês qual for.
  */
  if (tudoPago) {
    linhas.push({ kind: 'settled', text: 'Tudo em dia' })
    return linhas
  }

  /*
    ── Duas decisões independentes ──

    O CICLO é um fato do calendário: o mês exibido é o corrente, um futuro ou
    um passado. Não muda quando uma fatura é paga.

    O COMPLEMENTO é um fato de quitação, e só aparece quando acrescenta
    informação: com nada pago, o valor pendente É o total logo acima, e
    repeti-lo não informa nada.
  */
  const nadaPago = Math.abs(summary.unpaid - summary.total) <= EPSILON
  const remaining = nadaPago ? null : summary.unpaid

  /*
    A contagem é o último recurso: existe para a linha não ficar vazia quando
    não há complemento de quitação, nem composição, nem rótulo de ciclo — o
    caso do mês passado com nada pago e sem terceiros.
  */
  const precisaContagem =
    remaining === null && !temTerceiros && CYCLE_LABEL[cycle] === null

  linhas.push({
    kind: 'cycle',
    cycle,
    remaining,
    count: precisaContagem
      ? `${summary.invoiceCount} ${
          summary.invoiceCount === 1 ? 'fatura em aberto' : 'faturas em aberto'
        }`
      : null,
  })

  return linhas
}
