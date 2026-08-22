import type { BudgetSummary } from '@/services/budget.service'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Apresentação de "Acertos com pessoas" no Orçamento
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O card mostra DOIS universos que respondem perguntas diferentes:
 *
 *   · **No orçamento de <mês>** — o que pertenceu financeiramente àquela
 *     competência. Inclui item já quitado, porque ele continuou sendo
 *     obrigação do mês. É o que reconcilia `totalToPay`.
 *
 *   · **Em aberto agora** — quanto ainda falta acertar. Estado atual.
 *
 * Este módulo só ROTULA: o backend já devolve os dois universos calculados
 * (item 31). Nada aqui filtra por `isPaid` nem soma valores por pessoa.
 */

type PersonSettlement = BudgetSummary['peopleSettlements'][number]

/** Tolerância de centavo — evita `-0,00` e ruído de ponto flutuante. */
const EPSILON = 0.005

export type OpenDirection = 'receive' | 'pay' | 'offset' | 'settled'

/**
 * Direção do saldo em aberto.
 *
 * `offset` e `settled` são estados DISTINTOS e é a distinção mais importante
 * daqui: os dois têm `net` zero, mas só `settled` autoriza dizer "Nada em
 * aberto". Com R$ 200 de cada lado ainda há duas obrigações vivas, e chamar
 * isso de quitado seria a mesma afirmação falsa que a Fase 8B removeu da
 * mensagem de WhatsApp.
 */
export function openDirection(person: PersonSettlement): OpenDirection {
  const { net, itemCount } = person.open

  if (itemCount === 0) return 'settled'
  if (net > EPSILON) return 'receive'
  if (net < -EPSILON) return 'pay'
  return 'offset'
}

/** O valor em destaque do bloco "Em aberto agora". */
export function openBalanceLabel(
  person: PersonSettlement,
  formatCurrency: (value: number) => string,
): string {
  switch (openDirection(person)) {
    case 'settled':
      return 'Nada em aberto'
    case 'receive':
      return `${formatCurrency(person.open.net)} a receber`
    case 'pay':
      return `${formatCurrency(Math.abs(person.open.net))} a pagar`
    case 'offset':
      /*
        Saldo zerado COM itens abertos. A composição fica na linha de baixo:
        aqui o texto não pode sugerir conclusão.
      */
      return 'Saldo em aberto zerado'
  }
}

/**
 * Composição do que está em aberto — "A receber X · A pagar Y".
 *
 * Devolve `null` quando não há nada em aberto: a linha de composição some
 * junto, em vez de exibir dois zeros.
 */
export function openCompositionParts(
  person: PersonSettlement,
): Array<{ side: 'receivable' | 'debt'; amount: number }> {
  const parts: Array<{ side: 'receivable' | 'debt'; amount: number }> = []
  if (person.open.receivableTotal > EPSILON) {
    parts.push({ side: 'receivable', amount: person.open.receivableTotal })
  }
  if (person.open.debtTotal > EPSILON) {
    parts.push({ side: 'debt', amount: person.open.debtTotal })
  }
  return parts
}

/**
 * Quanto do que está em aberto veio de competências anteriores.
 *
 * Direcional e LÍQUIDO: com R$ 200 abertos de cada lado o resultado é `null`,
 * porque nada foi trazido em termos líquidos. A versão anterior somava só o
 * lado da dívida e anunciava "+ R$ 200 anterior" nesse mesmo cenário.
 *
 * `null` também quando não há anteriores — a linha simplesmente não aparece.
 */
export function openPriorLabel(
  person: PersonSettlement,
  formatCurrency: (value: number) => string,
): string | null {
  const { priorNet } = person.open

  if (priorNet > EPSILON) {
    return `Inclui ${formatCurrency(priorNet)} a receber de períodos anteriores`
  }
  if (priorNet < -EPSILON) {
    return `Inclui ${formatCurrency(Math.abs(priorNet))} a pagar de períodos anteriores`
  }
  return null
}

/**
 * Contexto do orçamento — a obrigação da competência que compõe `totalToPay`.
 *
 * `null` quando a pessoa não tem dívida no orçamento do mês: nesse caso ela
 * está na lista apenas por ter acerto em aberto (item 12), e uma linha
 * "R$ 0 em dívidas" não informaria nada.
 *
 * Quando existe, aparece MESMO já paga — é justamente o que impede o total do
 * orçamento de deixar de fechar com as linhas visíveis (item 10).
 */
export function budgetContextLabel(
  person: PersonSettlement,
  formatCurrency: (value: number) => string,
): string | null {
  if (person.budget.debtTotal <= EPSILON) return null
  return `${formatCurrency(person.budget.debtTotal)} em dívidas`
}

/**
 * Rótulo acessível completo da linha.
 *
 * Um `aria-label` só, com os dois universos nomeados: quem usa leitor de tela
 * não deve depender da cor nem da posição para saber qual número é obrigação
 * do mês e qual é pendência atual.
 */
export function settlementAriaLabel(
  person: PersonSettlement,
  formatCurrency: (value: number) => string,
  monthLabel: string,
): string {
  const parts = [person.personName]

  const context = budgetContextLabel(person, formatCurrency)
  if (context) parts.push(`no orçamento de ${monthLabel}, ${context}`)

  const composition = openCompositionParts(person)
  if (composition.length > 0) {
    parts.push(
      `em aberto, ${composition
        .map(
          (part) =>
            `${formatCurrency(part.amount)} ${
              part.side === 'receivable' ? 'a receber' : 'a pagar'
            }`,
        )
        .join(' e ')}`,
    )
    parts.push(`saldo em aberto de ${openBalanceLabel(person, formatCurrency)}`)
  } else {
    parts.push('nada em aberto')
  }

  const prior = openPriorLabel(person, formatCurrency)
  if (prior) parts.push(prior.toLowerCase())

  return parts.join(', ')
}
