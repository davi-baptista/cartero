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
 * ══════════════════════════════════════════════════════════════════════════
 * Contexto do orçamento na linha da pessoa
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A contribuição de uma pessoa ao `totalToPay` vem de TRÊS buckets, os mesmos
 * do cálculo global:
 *
 *   · `debtDueInMonth`    — dívida que vence nesta competência
 *   · `currentOpenPrior`  — anterior ainda aberta (só no mês corrente)
 *   · `priorPaidInMonth`  — anterior cujo pagamento aconteceu aqui
 *
 * A versão anterior lia SÓ `priorPaidInMonth`. Em dezembro, uma dívida de
 * R$ 300 que vence no mês e já foi paga depois tinha `debtDueInMonth: 300` e
 * `priorPaidInMonth: 0` — o rótulo voltava `null`, a linha ficava sem
 * contexto, e como a dívida já estava quitada o lado "em aberto" também
 * estava vazio. Resultado: uma linha em branco explicando nada, enquanto os
 * R$ 300 seguiam dentro do total do mês.
 */

/** Quanto a pessoa contribui para o `totalToPay` desta competência. */
export function budgetDebtContribution(person: PersonSettlement): number {
  return person.budget.debtTotal
}

/**
 * A dívida do mês já está explicada pelo lado "em aberto"?
 *
 * Quando `debtDueInMonth` e `open.debtTotal` coincidem, a linha já mostra
 * "A pagar R$ 300" — repetir "R$ 300 em dívidas deste mês" logo abaixo é
 * ruído. O backend continua entregando o valor; esconder o texto é decisão de
 * apresentação (item 8).
 */
function dueIsRedundant(person: PersonSettlement): boolean {
  return (
    Math.abs(person.budget.openDueInMonth - person.open.debtTotal) <= EPSILON
  )
}

/**
 * Contexto do orçamento — só os componentes que ACRESCENTAM informação.
 *
 * Cada bucket tem vocabulário próprio, porque descrevem fatos diferentes:
 * uma dívida que nasceu aqui não é a mesma coisa que um desembolso de
 * pendência antiga. Chamar os R$ 2.580 de agosto de "dívidas de agosto"
 * afirmaria que elas nasceram lá — e não nasceram.
 */
export function budgetContextParts(
  person: PersonSettlement,
  formatCurrency: (value: number) => string,
): string[] {
  const parts: string[] = []

  if (person.budget.openDueInMonth > EPSILON && !dueIsRedundant(person)) {
    parts.push(`${formatCurrency(person.budget.openDueInMonth)} em dívidas deste mês`)
  }

  if (person.budget.paidInMonth > EPSILON) {
    parts.push(
      `${formatCurrency(person.budget.paidInMonth)} de pendências anteriores pagas neste mês`,
    )
  }

  /*
    `currentOpenPrior` não ganha texto próprio: ele SEMPRE aparece como
    "A pagar" no lado em aberto, porque a dívida está viva. Descrevê-lo aqui
    duplicaria o mesmo número na mesma linha (item 16).
  */

  return parts
}

/** As partes acima numa frase só. `null` quando não há o que dizer. */
export function budgetContextLabel(
  person: PersonSettlement,
  formatCurrency: (value: number) => string,
): string | null {
  const parts = budgetContextParts(person, formatCurrency)
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * A linha da pessoa deve ser renderizada?
 *
 * Uma pessoa sem nada em aberto E sem contribuição ao orçamento não tem o que
 * dizer nesta competência — renderizá-la produzia a linha vazia com "Nada em
 * aberto" espalhada por meses onde nada aconteceu.
 *
 * O backend já filtra por movimentação; isto é a defesa do frontend, para a
 * tela nunca depender de o servidor ter filtrado certo.
 */
export function shouldRenderPeopleSettlement(
  person: PersonSettlement,
): boolean {
  return (
    budgetDebtContribution(person) > EPSILON ||
    person.open.itemCount > 0 ||
    person.budget.receivableDueInMonth > EPSILON
  )
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
): string {
  const parts = [person.personName]

  const context = budgetContextLabel(person, formatCurrency)
  if (context) parts.push(context)

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

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Resumo da seção "Acertos com pessoas"
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O cabeçalho precisa FECHAR com as linhas exibidas logo abaixo. Por isso ele
 * agrega `peopleSettlements[].open` — o mesmo universo que alimenta cada
 * linha — e nunca `receivables.dueInMonth`, que tem outro recorte (inclui
 * cobrança sem pessoa) e divergiria da lista.
 *
 * Três cuidados que a agregação respeita:
 *
 *   · soma `receivableTotal`/`debtTotal`, que JÁ incluem mês + anteriores em
 *     aberto. Somar `priorReceivable`/`priorDebt` de novo contaria em dobro;
 *   · ignora `budget.*` por completo: uma dívida já quitada continua compondo
 *     `totalToPay` e mantém a pessoa na lista, mas não é pendência;
 *   · `itemCount` decide "Nada em aberto", não o saldo — R$ 500 de cada lado
 *     dá net zero com obrigações vivas dos dois lados.
 *
 * Nada aqui altera `totalToPay`: é consolidado informativo (Fase 9B).
 */
export interface PeopleSettlementSummary {
  receivableTotal: number
  debtTotal: number
  /** `receivableTotal - debtTotal`. Informativo, sem compensação. */
  net: number
  /** Itens abertos somados. Zero = nada em aberto. */
  itemCount: number
  /** `true` quando não há nenhuma pendência viva. */
  isEmpty: boolean
}

export function summarizePeopleSettlements(
  people: readonly PersonSettlement[],
): PeopleSettlementSummary {
  let receivableTotal = 0
  let debtTotal = 0
  let itemCount = 0

  for (const person of people) {
    receivableTotal += person.open.receivableTotal
    debtTotal += person.open.debtTotal
    itemCount += person.open.itemCount
  }

  return {
    receivableTotal,
    debtTotal,
    net: receivableTotal - debtTotal,
    itemCount,
    isEmpty: itemCount === 0,
  }
}

/**
 * Composição do cabeçalho — só os lados que existem.
 *
 * Com apenas cobranças abertas, "R$ 0,00 a pagar" seria ruído: a ausência já
 * é dita pela omissão.
 */
export function summaryCompositionParts(
  summary: PeopleSettlementSummary,
): Array<{ side: 'receivable' | 'debt'; amount: number }> {
  const parts: Array<{ side: 'receivable' | 'debt'; amount: number }> = []
  if (summary.receivableTotal > EPSILON) {
    parts.push({ side: 'receivable', amount: summary.receivableTotal })
  }
  if (summary.debtTotal > EPSILON) {
    parts.push({ side: 'debt', amount: summary.debtTotal })
  }
  return parts
}

/**
 * O saldo da seção, à direita do cabeçalho.
 *
 * Reusa a mesma distinção das linhas: saldo zero COM itens é "Saldo zerado",
 * não "Nada em aberto" — a segunda frase afirmaria quitação que não houve.
 */
export function summaryBalanceLabel(
  summary: PeopleSettlementSummary,
  formatCurrency: (value: number) => string,
): string {
  if (summary.isEmpty) return 'Nada em aberto'
  if (summary.net > EPSILON) return `${formatCurrency(summary.net)} a receber`
  if (summary.net < -EPSILON) {
    return `${formatCurrency(Math.abs(summary.net))} a pagar`
  }
  return 'Saldo zerado'
}

/** Direção do saldo da seção, para a cor. */
export function summaryDirection(
  summary: PeopleSettlementSummary,
): OpenDirection {
  if (summary.isEmpty) return 'settled'
  if (summary.net > EPSILON) return 'receive'
  if (summary.net < -EPSILON) return 'pay'
  return 'offset'
}

/**
 * Rótulo acessível do cabeçalho.
 *
 * Cada número sai acompanhado da direção: quem usa leitor de tela não pode
 * depender da cor nem da ordem para saber o que é receber e o que é pagar.
 */
export function summaryAriaLabel(
  summary: PeopleSettlementSummary,
  formatCurrency: (value: number) => string,
): string {
  if (summary.isEmpty) return 'Acertos com pessoas. Nada em aberto.'

  const parts = summaryCompositionParts(summary).map(
    (part) =>
      `${formatCurrency(part.amount)} ${
        part.side === 'receivable' ? 'a receber' : 'a pagar'
      }`,
  )

  return `Acertos com pessoas. ${parts.join('. ')}. Saldo em aberto de ${summaryBalanceLabel(
    summary,
    formatCurrency,
  )}.`
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Estado visual da linha da pessoa
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A linha segue a anatomia das Faturas: ícone, nome, badge de estado e um
 * valor em destaque. O estado é comunicado por badge e cor, não por rótulos
 * repetidos ("Saldo em aberto", "Nada em aberto") em cada linha — o cabeçalho
 * da seção já dá esse contexto.
 */
export type PeopleRowStatus = 'settled' | 'open'

export interface PeopleRowView {
  status: PeopleRowStatus
  /** O número em destaque à direita. */
  amount: number
  /** Direção do valor, para a cor. `neutral` quando não há sinal a dar. */
  direction: 'in' | 'out' | 'neutral'
  /** Linha secundária — só quando acrescenta informação. */
  metadata: string[]
}

/**
 * Resolve o que a linha mostra.
 *
 * `Quitado` exige AUSÊNCIA de itens abertos, nunca saldo zero: R$ 300 de cada
 * lado dá net zero com duas obrigações vivas, e chamar isso de quitado seria
 * a mesma afirmação falsa que a Fase 8B removeu da mensagem de WhatsApp.
 *
 * "Quitado" em vez de "Pago" porque a relação envolve dinheiro nos dois
 * sentidos — o que eu paguei e o que recebi.
 */
export function peopleRowView(
  person: PersonSettlement,
  formatCurrency: (value: number) => string,
): PeopleRowView {
  const temAberto = person.open.itemCount > 0
  const metadata: string[] = []

  if (temAberto) {
    /*
      Composição bilateral só quando os DOIS lados existem: com um lado só, o
      valor em destaque já diz tudo e a segunda linha seria eco.
    */
    if (
      person.open.receivableTotal > EPSILON &&
      person.open.debtTotal > EPSILON
    ) {
      metadata.push(
        `${formatCurrency(person.open.receivableTotal)} a receber · ${formatCurrency(person.open.debtTotal)} a pagar`,
      )
    }

    /*
      Pagamento feito na competência, com algo ainda aberto: sem isto o
      desembolso ficaria invisível justamente na linha que diz "falta pagar".
    */
    if (person.budget.paidInMonth > EPSILON) {
      metadata.push(
        `${formatCurrency(person.budget.paidInMonth)} quitados neste mês`,
      )
    }

    if (person.open.automaticReceivable > EPSILON) {
      metadata.push(
        `${formatCurrency(person.open.automaticReceivable)} vêm de compras no seu cartão`,
      )
    }

    return {
      status: 'open',
      amount: person.open.net,
      direction:
        person.open.net > EPSILON
          ? 'in'
          : person.open.net < -EPSILON
            ? 'out'
            : 'neutral',
      metadata,
    }
  }

  /*
    Nada em aberto: o destaque passa a ser o que foi QUITADO na competência.
    A badge já comunica o estado, então a linha não repete "Nada em aberto".
  */
  return {
    status: 'settled',
    amount: person.budget.debtTotal,
    direction: 'neutral',
    metadata,
  }
}

/** Rótulo da badge, por estado. */
export function peopleRowStatusLabel(status: PeopleRowStatus): string {
  return status === 'settled' ? 'Quitado' : 'Em aberto'
}

/**
 * Rótulo acessível da linha.
 *
 * Nome, estado, valor e direção — sem depender de verde/vermelho.
 */
export function peopleRowAriaLabel(
  person: PersonSettlement,
  formatCurrency: (value: number) => string,
): string {
  const view = peopleRowView(person, formatCurrency)

  if (view.status === 'settled') {
    return `${person.personName}. Quitado. ${formatCurrency(view.amount)} pagos nesta competência.`
  }

  const direcao =
    view.direction === 'in'
      ? 'a receber'
      : view.direction === 'out'
        ? 'a pagar'
        : 'zerado'

  return `${person.personName}. Em aberto. Saldo de ${formatCurrency(Math.abs(view.amount))} ${direcao}.`
}
