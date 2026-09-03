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
/*
  ── Helpers de metadata sem consumidor de produto ──

  `openPriorLabel`, `budgetContextLabel`, `budgetContextParts` e
  `openCompositionParts` descreviam a linha secundária das linhas de pessoa,
  que saiu do Orçamento: a lista mostra entidade, status e valor, e a
  composição vive no cabeçalho e no drawer.

  Ficaram aqui, com os testes, em vez de serem apagados: eles codificam
  decisões custosas de vocabulário — "sem netting", "saldo zero não é
  quitação", "não repetir a competência" — e a próxima superfície que
  precisar dessa metadata vai querer as mesmas regras, não reinventá-las.

  Se em algumas semanas nenhuma superfície os tiver adotado, o certo é
  removê-los junto com os testes, e não deixá-los apodrecer.
*/
export function openPriorLabel(
  person: PersonSettlement,
  formatCurrency: (value: number) => string,
): string | null {
  return priorOverdueLabel(
    person.open.priorOverdueReceivable,
    person.open.priorOverdueDebt,
    formatCurrency,
  )
}

/**
 * Microcopy das pendências anteriores — os DOIS lados, sem netting.
 *
 * Com R$ 277,63 a receber e R$ 50 a pagar trazidos de antes, o líquido diria
 * "+R$ 227,63" e esconderia que existem duas obrigações vivas. A composição é
 * a informação; o líquido já está no valor em destaque da linha.
 *
 * `null` quando nada veio de antes — a linha simplesmente não aparece, em vez
 * de exibir "R$ 0,00".
 */
export function priorOverdueLabel(
  receivable: number,
  debt: number,
  formatCurrency: (value: number) => string,
): string | null {
  const partes: string[] = []

  if (receivable > EPSILON) {
    partes.push(`${formatCurrency(receivable)} a receber`)
  }
  if (debt > EPSILON) {
    partes.push(`${formatCurrency(debt)} a pagar`)
  }

  if (partes.length === 0) return null
  return `Pendências anteriores: ${partes.join(' · ')}`
}

/**
 * Soma das pendências anteriores de TODAS as pessoas, para o cabeçalho.
 *
 * Agrega os buckets já entregues por pessoa — nenhuma data é reinterpretada
 * aqui. Quem decide o que é anterior-e-vencido é o backend, com a mesma regra
 * que alimenta as linhas.
 */
export function summarizePriorOverdue(people: readonly PersonSettlement[]): {
  receivable: number
  debt: number
} {
  return people.reduce(
    (total, person) => ({
      receivable: total.receivable + person.open.priorOverdueReceivable,
      debt: total.debt + person.open.priorOverdueDebt,
    }),
    { receivable: 0, debt: 0 },
  )
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
  /*
    A seção passou a ser uma DECOMPOSIÇÃO das saídas do Orçamento, não um
    consolidado de todos os saldos com pessoas.

    Quem me deve mais do que eu devo não representa saída líquida e não
    aparece aqui — continua visível em Pessoas, A Receber e no drawer, que
    são as superfícies dessa pergunta.
  */
  return person.budget.payable > EPSILON
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
  /**
   * Direção financeira do saldo.
   *
   * NÃO governa mais a cor do valor — ver `amountTone`. Continua exposta
   * porque o rótulo acessível a usa para dizer "a receber" ou "a pagar".
   */
  direction: 'in' | 'out' | 'neutral'
  /**
   * Cor do valor em destaque, pelo mesmo princípio das Faturas.
   *
   * Antes vinha da DIREÇÃO do saldo (verde a receber, vermelho a pagar), o
   * que fazia a mesma coluna significar coisas diferentes em duas tabelas
   * vizinhas: em Faturas a cor conta o ESTADO (aberta neutra, paga verde),
   * aqui contava o sinal.
   *
   * Nesta tabela o número é o impacto da pessoa no Orçamento, e o estado é o
   * que o qualifica:
   *
   *   em aberto → neutro   (ainda vai sair)
   *   quitado   → verde    (resolvido, como fatura paga)
   *
   * Atraso continua no ÍCONE, uma camada de urgência à parte: o valor não
   * fica vermelho por causa dele.
   */
  amountTone: 'neutral' | 'positive'
  /**
   * Estado do ÍCONE — urgência, não direção.
   *
   * Os dois eixos são independentes e as cores não se contradizem: o valor
   * diz para onde o dinheiro vai, o ícone diz se algo já passou do prazo.
   * Fabrício com −R$ 1,00 dentro do prazo tem valor vermelho e ícone neutro.
   */
  iconState: 'neutral' | 'overdue' | 'settled'
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
/**
 * ══════════════════════════════════════════════════════════════════════════
 * O amount da row de Acerto: a contribuição da pessoa ao Orçamento
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `budget.payable` é `max(dívidas − recebíveis, 0)`, decidido no backend, e é
 * o valor que o total da seção soma — "R$ X no orçamento" no cabeçalho.
 *
 * ── O bug que isto fecha ──
 *
 * A row usava TRÊS bases diferentes, e nenhuma delas era esta:
 *
 *   aberta          `open.net`           outstanding líquido
 *   resolvida       `budget.debtTotal`   dívida BRUTA
 *   total da seção  `budget.payable`     contribuição
 *
 * Com R$ 10 a receber e R$ 11 a pagar, a row dizia R$ 1 aberta e R$ 11 depois
 * de quitar, enquanto o total continuava R$ 1. Settlement trocava a matemática
 * da linha — e a linha nunca reconciliou com o próprio total.
 *
 * ── Por que não alternar como Pessoas faz ──
 *
 * Em Pessoas a troca outstanding → histórico é deliberada e sinalizada por
 * `SALDO FINAL`: a pergunta muda de "quanto falta" para "quanto houve".
 *
 * Aqui a pergunta é uma só — "quanto esta pessoa acrescenta ao orçamento
 * DESTA competência?" — e a resposta é um fato do mês, não do estado de
 * pagamento. Quitar não altera o custo do mês; altera quem já pagou.
 *
 * ── Sinal ──
 *
 * `payable` é magnitude (nunca negativa: quem me deve mais contribui com
 * ZERO, jamais com crédito). O sinal exibido continua vindo de `direction`,
 * que a row já resolve pelo lado do saldo.
 */
function budgetContribution(person: PersonSettlement): number {
  return person.budget.payable
}

/**
 * A contribuição desta pessoa ao orçamento já foi coberta?
 *
 * ── Por que NÃO é `open.itemCount === 0` ──
 *
 * Aquilo responde "a relação bilateral terminou?". Com R$ 11 devidos e R$ 10 a
 * receber, pagar a dívida cobre a saída de R$ 1 — mas o recebível segue aberto,
 * e a row do Orçamento dizia `A RECEBER` depois de o dinheiro já ter saído.
 *
 * O Orçamento pergunta outra coisa: "ainda vai sair dinheiro daqui neste mês?".
 * A resposta vem de `contribution.isSettled`, decidido no backend sobre os
 * pagamentos de DÍVIDA — recebimentos não cobrem saída de caixa.
 */
function contribuicaoCoberta(person: PersonSettlement): boolean {
  return person.contribution.isSettled
}

export function peopleRowView(
  person: PersonSettlement,
  formatCurrency: (value: number) => string,
): PeopleRowView {
  /*
    O estado da row segue a CONTRIBUIÇÃO, não a relação bilateral.

    Era `open.itemCount > 0`: com a dívida paga e o recebível aberto, a row
    voltava a "A RECEBER" — depois de o desembolso já ter acontecido.
  */
  const temAberto = !contribuicaoCoberta(person)
  const metadata: string[] = []

  if (temAberto) {
    /*
      ── UMA faixa secundária, por prioridade ──

      Uma pessoa pode ter composição bilateral, pendência anterior, origem no
      cartão e valor quitado no mês. Mostrar tudo empilhava três linhas e
      fazia cada registro ter uma altura, quebrando a comparabilidade da
      tabela — e a lista é resumo: o resto está no drawer.

      A ordem responde "o que explica melhor o valor em destaque?":

        1. composição bilateral — o líquido sozinho esconde os dois lados
        2. pendência anterior   — explica de onde veio o que está aberto
        3. origem no cartão     — contexto de um lado só

      O rótulo acessível continua completo, independente do que é exibido.
    */
    const bilateral =
      person.open.receivableTotal > EPSILON &&
      person.open.debtTotal > EPSILON
        ? `${formatCurrency(person.open.receivableTotal)} a receber · ${formatCurrency(person.open.debtTotal)} a pagar`
        : null

    const anterior = priorOverdueLabel(
      person.open.priorOverdueReceivable,
      person.open.priorOverdueDebt,
      formatCurrency,
    )

    const noCartao =
      person.open.automaticReceivable > EPSILON
        ? `${formatCurrency(person.open.automaticReceivable)} vêm de compras no seu cartão`
        : null

    const escolhida = bilateral ?? anterior ?? noCartao
    if (escolhida) metadata.push(escolhida)

    /*
      Exceção deliberada: quitação na competência com algo AINDA aberto.

      Não é detalhe de terceiro nível — sem ela, a linha diz "falta pagar" e
      omite que já houve desembolso no mês. As duas juntas são o único caso
      de duas faixas, e só ocorre quando ambas existem.
    */
    if (person.budget.paidInMonth > EPSILON) {
      metadata.push(
        `${formatCurrency(person.budget.paidInMonth)} quitados neste mês`,
      )
    }

    return {
      status: 'open',
      amount: budgetContribution(person),
      direction:
        person.open.net > EPSILON
          ? 'in'
          : person.open.net < -EPSILON
            ? 'out'
            : 'neutral',
      /*
        Vermelho SÓ por atraso. Derivar do saldo pintaria de urgente toda
        relação em que se deve mais do que se tem a receber, mesmo com tudo
        dentro do prazo.
      */
      iconState: person.open.hasOverdue ? 'overdue' : 'neutral',
      amountTone: 'neutral',
      metadata,
    }
  }

  /*
    Nada em aberto: o destaque passa a ser o que foi QUITADO na competência.
    A badge já comunica o estado, então a linha não repete "Nada em aberto".
  */
  return {
    status: 'settled',
    /*
      A MESMA base do estado aberto.

      Era `budget.debtTotal` — a dívida BRUTA. Com R$ 10 a receber e R$ 11 a
      pagar, a row mostrava R$ 1 aberta e saltava para R$ 11 depois de quitar,
      enquanto o total da seção seguia somando R$ 1. Settlement mudava a
      MATEMÁTICA da linha, não só o estado dela.
    */
    amount: budgetContribution(person),
    /*
      Valor NEUTRO, não verde: o dinheiro de uma dívida quitada saiu do bolso.
      Pintá-lo de verde sugeriria recebimento. O verde do estado concluído
      fica no ícone e na badge, onde significa "resolvido".
    */
    direction: 'neutral',
    iconState: 'settled',
    amountTone: 'positive',
    metadata,
  }
}

/** Rótulo da badge, por estado. */
export function peopleRowStatusLabel(
  status: PeopleRowStatus,
  direction: PeopleRowView['direction'] = 'out',
): string {
  /*
    O vocabulário de PESSOAS, não um terceiro.

    Era "Quitado" / "Em aberto" — correto, mas um par só desta tela. A mesma
    relação com a mesma pessoa aparece em /persons como `VOCÊ DEVE` / `PAGO`,
    e duas palavras para o mesmo estado fazem procurar uma diferença que não
    existe.

    A direção decide o verbo: o Orçamento lista o que SAI, então o caso comum
    é `VOCÊ DEVE`; um saldo a receber (a pessoa te deve mais do que você deve
    a ela) contribui com zero para o total, mas a linha continua existindo e
    precisa dizer a verdade sobre o sentido.
  */
  if (status === 'settled') return direction === 'in' ? 'RECEBIDO' : 'PAGO'
  return direction === 'in' ? 'A RECEBER' : 'VOCÊ DEVE'
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

  /*
    A composição bilateral entra AQUI porque saiu da linha.

    A lista visual mostra só o líquido; quem usa leitor de tela não deve
    precisar abrir o drawer para saber que R$ 331,42 vêm de R$ 661,42 a
    receber contra R$ 330,00 a pagar.
  */
  const composicao =
    person.open.receivableTotal > EPSILON && person.open.debtTotal > EPSILON
      ? ` ${formatCurrency(person.open.receivableTotal)} a receber, ${formatCurrency(person.open.debtTotal)} a pagar.`
      : ''

  return `${person.personName}. Em aberto.${composicao} Saldo de ${formatCurrency(Math.abs(view.amount))} ${direcao}.`
}
