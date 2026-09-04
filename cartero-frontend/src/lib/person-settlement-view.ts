import { civilDayOf, formatDateValue } from '@/lib/date'
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
 * A competência canônica é UMA: `dueMonth`. A ponte por origem foi removida —
 * ela fazia a compra de agosto que vence em 10/09 aparecer nos dois meses,
 * como se fossem duas obrigações.
 *
 * `referenceMonth` continua no contrato como METADADO de origem (o rótulo
 * "No cartão"), sem decidir em que mês o item aparece. Este módulo só decide
 * o que mostrar e como rotular, para o settle e a tela usarem o mesmo
 * universo.
 */

/** O mínimo para posicionar um item no tempo. */
interface Timed {
  dueDate: string
  isPaid: boolean
  /**
   * Origem do item — metadado, não competência.
   *
   * Preservado porque o contrato o entrega e outras leituras (auditoria,
   * "No cartão") podem usá-lo. Nenhuma decisão temporal daqui o consulta.
   */
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
 * DUAS condições, sobre uma competência canônica só (`dueMonth`): vence aqui,
 * ou venceu antes e JÁ está vencido hoje.
 *
 * A ponte por origem foi removida — ela fazia a compra de agosto que vence em
 * 10/09 aparecer nos dois meses, como se fossem duas obrigações.
 *
 * O carry compara com HOJE, não com o início da competência: navegar para
 * setembro em 24/08 não pode transformar uma dívida que vence em 30/08 num
 * atraso que ainda não aconteceu.
 */
export function belongsToCompetence(
  item: Timed,
  selected: SettlementCompetence,
  today = formatDateValue(),
): boolean {
  if (item.isPaid) return false

  const posicao = compareCompetence(item.dueMonth, selected)

  // A. Vence nesta competência — mesmo com a data ainda no futuro.
  if (posicao === 0) return true

  // B. Carry: de competência anterior e JÁ vencido hoje.
  if (posicao < 0) return dueDay(item) < today

  return false
}

export type DueState = 'overdue' | 'dueToday' | 'pending'

/**
 * Estado temporal do item.
 *
 * Depende só do vencimento contra hoje — `selected` permanece na assinatura
 * para não quebrar chamadores, mas não participa mais. `upcoming` foi
 * removido junto com a ponte por origem: com a competência única, todo item
 * exibido vence nela ou já venceu.
 *
 * No PRÓPRIO dia do vencimento o item ainda não está atrasado. O ano faz
 * parte da comparação — out/2025 e out/2026 nunca colidem.
 */
export function dueStateOf(
  item: Timed,
  selected: SettlementCompetence,
  today = formatDateValue(),
): DueState {
  void selected

  const due = dueDay(item)

  if (due < today) return 'overdue'
  if (due === today) return 'dueToday'
  return 'pending'
}

/** `10/09` — sem construir `Date`, para não deslocar o dia por fuso. */
function shortDate(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split('-')
  return `${day}/${month}`
}

/** `10/09/2025` — forma completa, para datas fora do ano da competência. */
function fullDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

/**
 * Data de vencimento como o drawer deve exibi-la.
 *
 * `14/10` é ambíguo entre 2025 e 2026, e o drawer mostra as duas coisas na
 * mesma lista: um parcelamento que atravessa a virada do ano aparece com
 * `14/09 · 14/10 · … · 14/03`, sem nada indicando que os quatro primeiros são
 * do ano passado.
 *
 * A lógica temporal SEMPRE considerou o ano — `dueStateOf` compara
 * `YYYY-MM-DD` inteiro e `compareCompetence` compara ano antes de mês. O que
 * faltava era o ano chegar aos olhos de quem lê.
 *
 * Regra: o ano aparece quando difere do ano da competência selecionada. No
 * mesmo ano a forma compacta é preservada, porque ali não há ambiguidade.
 */
function dueDisplay(iso: string, selected: SettlementCompetence): string {
  const year = Number(iso.slice(0, 4))
  return year === selected.year ? shortDate(iso) : fullDate(iso)
}

/** Microcopy temporal de um item em aberto: atrasado, vence hoje, pendente. */
export function dueLabel(
  item: Timed,
  selected: SettlementCompetence,
  today = formatDateValue(),
): string {
  const state = dueStateOf(item, selected, today)
  const dueText = dueDisplay(dueDay(item), selected)

  /*
    Sem "· referente a <mês de origem>": com o vencimento como competência
    única, o item já está no mês certo, e a origem virou metadado ("No
    cartão") em vez de justificativa temporal.
  */
  switch (state) {
    case 'overdue':
      return `Em atraso · venceu em ${dueText}`
    case 'dueToday':
      return 'Pendente · vence hoje'
    case 'pending':
      return `Pendente · vence em ${dueText}`
  }
}

/**
 * Contexto de vencimento para a linha do PDF.
 *
 * ── Por que existe, separado de `dueLabel` ──
 *
 * A linha do PDF já carrega a data de ORIGEM (`occurredAt` — quando a cobrança
 * aconteceu), e o documento não pode perdê-la: ela e o vencimento são fatos
 * diferentes. Uma cobrança criada em 10/08 que vence em 28/08 tem as duas
 * datas, e trocar uma pela outra apagaria informação.
 *
 * `dueLabel` monta a linha inteira do drawer ("Em atraso · venceu em 28/08"),
 * onde a origem aparece em outro lugar. Aqui devolvemos só o TRECHO do
 * vencimento, para o PDF compor `Cobrança em 10/08/2026 · Venceu em 28/08`.
 *
 * O estado vem de `dueStateOf` e a data de `dueDisplay` — as mesmas funções do
 * drawer, então o PDF não pode divergir da tela. Em particular: `pending` NÃO
 * é sinônimo de vencido, e a comparação é por dia civil de Fortaleza.
 *
 * `tone` separa semântica de apresentação: quem desenha decide a cor, este
 * módulo só diz que aquele trecho é uma situação de atraso.
 */
export interface DueContext {
  text: string
  tone: 'overdue' | 'neutral'
}

export function dueContext(
  item: Timed,
  selected: SettlementCompetence,
  today = formatDateValue(),
): DueContext {
  const state = dueStateOf(item, selected, today)
  const dueText = dueDisplay(dueDay(item), selected)

  switch (state) {
    case 'overdue':
      return { text: `Venceu em ${dueText}`, tone: 'overdue' }
    case 'dueToday':
      /* "Vence hoje" é o vocabulário que o drawer já usa — não inventado aqui. */
      return { text: 'Vence hoje', tone: 'neutral' }
    case 'pending':
      return { text: `Vence em ${dueText}`, tone: 'neutral' }
  }
}

/** Urgência temporal manda na ordem — não a data da compra de origem. */
const STATE_ORDER: Record<DueState, number> = {
  overdue: 0,
  dueToday: 1,
  pending: 2,
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

  /*
    Carry: venceu em competência ANTERIOR e continua aberto. Antes o critério
    era a origem, que com a competência única deixou de fazer sentido — um
    item de origem antiga que vence aqui não é pendência trazida de antes.
  */
  const carried = (items: readonly Monetary[]) =>
    items
      .filter((item) => compareCompetence(item.dueMonth, selected) < 0)
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
/**
 * Rótulo do saldo da competência.
 *
 * Fonte única do drawer e do PDF. O documento é conferido pela outra pessoa, e
 * ele dizendo "Saldo a receber" onde a tela diz "Nada a acertar" seria uma
 * divergência impossível de explicar.
 *
 * Vocabulário do acerto MENSAL — deliberadamente diferente de `balanceLabel`,
 * que fala do consolidado all-time ("Tudo acertado"). Um mês vazio não afirma
 * que a relação está quitada: pode haver pendência em outra competência.
 */
export function competenceBalanceLabel(summary: CompetenceSummary): string {
  if (summary.isEmpty) return 'Nada a acertar'
  if (summary.net > 0.005) return 'Saldo a receber'
  if (summary.net < -0.005) return 'Saldo a pagar'
  return 'Saldo líquido zerado'
}

/** Sinal do saldo: `+`, `-` ou nada. A tolerância evita `-R$ 0,00`. */
export function competenceBalanceSign(summary: CompetenceSummary): '+' | '-' | '' {
  if (summary.net > 0.005) return '+'
  if (summary.net < -0.005) return '-'
  return ''
}

export function openItemsFor<T extends Timed>(
  items: readonly T[],
  selected: SettlementCompetence,
  today = formatDateValue(),
): T[] {
  /*
    `today` precisa chegar ao filtro: o carry compara o vencimento com HOJE,
    e omiti-lo faria a lista usar o relógio real em vez da data informada —
    quebrando justamente a regra de não projetar atraso futuro.
  */
  const eligible = items.filter((item) =>
    belongsToCompetence(item, selected, today),
  )
  return sortOpenItems(eligible, selected, today)
}

/**
 * Microcopy de um item RESOLVIDO no Histórico.
 *
 * O histórico é arquivado por `dueMonth` — a mesma competência canônica dos
 * itens abertos —, e não pelo mês em que o dinheiro se moveu. Por isso a data
 * real da resolução precisa aparecer na linha: sem ela, uma dívida de julho
 * paga em setembro ficaria no mês certo mas sem dizer quando foi quitada.
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
    dueMonth: SettlementCompetence
  },
  kind: 'debt' | 'receivable',
): string {
  const verb = kind === 'receivable' ? 'Recebido' : 'Pago'

  /*
    A data de resolução SEMPRE sai completa: o histórico é arquivado por
    `dueMonth`, então um item que vence em agosto/2025 e é recebido em
    outubro/2025
    aparece na prateleira de agosto — e "recebido em 17/10" sem o ano deixaria
    dúvida sobre qual outubro.
  */
  if (!item.paidAt) {
    return `Venceu em ${dueDisplay(item.dueDate, item.dueMonth)}`
  }

  /*
    `paidAt` e um INSTANTE, e o `slice(0, 10)` que `fullDate` faz devolveria o
    dia em UTC: um recebimento em 04/09 as 00h30 UTC ocorreu em 03/09 as 21h30
    aqui. A lista de Pessoas usa o dia civil, e a linha do historico dizia o
    dia seguinte para o MESMO registro.

    A conversao acontece UMA vez: a comparacao de ano abaixo le a mesma string
    que a exibicao, senao 31/12 as 23h UTC compararia com um ano e imprimiria
    o outro.
  */
  const settledDay = civilDayOf(item.paidAt)

  const due = item.dueDate.slice(0, 10)
  const [dueYear, dueMonth] = due.split('-').map(Number)
  const venceuEmOutraCompetencia =
    dueYear !== item.dueMonth.year || dueMonth !== item.dueMonth.month

  if (venceuEmOutraCompetencia) {
    /*
      As duas datas saem completas quando os anos divergem entre si.

      "Venceu em 10/12 · pago em 15/03/2026" faria o leitor supor que dezembro
      é de 2026 — o mesmo ano do pagamento —, quando o vencimento é de 2025 e
      a distância entre os dois fatos é justamente o que a linha explica.
    */
    const anosDivergem = due.slice(0, 4) !== settledDay.slice(0, 4)
    const vencimento = anosDivergem
      ? fullDate(due)
      : dueDisplay(due, item.dueMonth)

    return `Venceu em ${vencimento} · ${verb.toLowerCase()} em ${fullDate(settledDay)}`
  }

  return `${verb} em ${fullDate(settledDay)}`
}
