import { TransactionType } from '@/types'

/**
 * Vocabulário central para os três conceitos financeiros do Cartero.
 *
 * O Cartero distingue números que respondem a perguntas diferentes. Uma compra
 * de R$ 300 feita para a Eva no cartão do usuário é, ao mesmo tempo:
 *
 *   • MOVIMENTADO      R$ 300 — passou pelo cartão e entra na fatura
 *   • SUA PARTE        R$ 0   — economicamente não é gasto do usuário
 *   • DE OUTRAS PESSOAS R$ 300 — vira A Receber da Eva
 *
 * Nenhum desses números está errado. O erro é apresentá-los como equivalentes.
 *
 * Este módulo existe para que cada tela declare qual pergunta está respondendo,
 * em vez de reinventar a classificação — que foi como Extrato e Visão Geral
 * passaram a somar dinheiro de terceiros como gasto pessoal.
 *
 * `isExpense` (em `formatters.ts`) continua existindo e correto para decisões
 * VISUAIS: cor, ícone e sinal de um lançamento isolado. Para AGREGAR valores,
 * use as funções deste módulo.
 */

/** Campos mínimos para classificar um lançamento. */
export interface ClassifiableTransaction {
  type: TransactionType
  isRefund?: boolean
  personId?: string
}

/**
 * Entrada de dinheiro: uma receita de fato.
 *
 * Estorno NÃO é receita. Ele é uma devolução que abate a saída correspondente
 * — tratá-lo como entrada infla receitas e gastos ao mesmo tempo.
 */
export function isIncomeTransaction(tx: ClassifiableTransaction): boolean {
  return tx.type === TransactionType.INCOME
}

/**
 * Movimentação de saída: "isto é uma saída de dinheiro?"
 *
 * Inclui compras feitas para terceiros — elas passaram pelo meio de pagamento
 * do usuário de verdade. É o conceito de MOVIMENTADO, usado pelo Extrato, que
 * responde "o que aconteceu".
 *
 * Estorno fica de fora: é o contrário de uma saída.
 */
export function isExpenseTransaction(tx: ClassifiableTransaction): boolean {
  return tx.type !== TransactionType.INCOME && !tx.isRefund
}

/**
 * Movimentação de saída cuja responsabilidade é de outra pessoa.
 *
 * O backend só permite `personId` em CREDIT_CARD (e nunca junto de estorno),
 * mas a checagem de tipo fica explícita aqui para que a classificação não
 * dependa de uma invariante distante.
 */
export function isThirdPartyExpense(tx: ClassifiableTransaction): boolean {
  return isExpenseTransaction(tx) && Boolean(tx.personId)
}

/**
 * Saída que é economicamente do próprio usuário — SUA PARTE.
 *
 * É o conceito certo para "quanto eu gastei": alimenta os gastos por categoria
 * da Visão Geral e a parte própria das faturas.
 */
export function isOwnExpense(tx: ClassifiableTransaction): boolean {
  return isExpenseTransaction(tx) && !tx.personId
}

/** Um estorno, que devolve dinheiro de uma compra anterior. */
export function isRefundTransaction(tx: ClassifiableTransaction): boolean {
  return Boolean(tx.isRefund)
}

/**
 * Efeito de um lançamento sobre um total de gastos, com sinal.
 *
 * Estorno entra negativo: ele reduz o gasto em vez de virar receita. É a mesma
 * regra que o detalhe da fatura já aplicava por categoria, agora disponível
 * para qualquer superfície que precise somar.
 */
export function expenseSignedAmount(
  tx: ClassifiableTransaction & { amount: number },
): number {
  if (isIncomeTransaction(tx)) return 0
  return tx.isRefund ? -tx.amount : tx.amount
}

/** As três leituras de um conjunto de lançamentos. */
export interface ExpenseBreakdown {
  /** Tudo que saiu pelo meio de pagamento, incluindo o de terceiros. */
  movimentado: number
  /** A parcela economicamente do usuário. */
  suaParte: number
  /** A parcela que pertence a outras pessoas e volta como A Receber. */
  deOutrasPessoas: number
}

/**
 * Decompõe uma lista de lançamentos nas três leituras, numa só passagem.
 *
 * Estornos são abatidos da leitura correspondente — o de uma compra própria
 * reduz `suaParte`; o de uma compra de terceiro reduz `deOutrasPessoas`. Por
 * construção, `movimentado === suaParte + deOutrasPessoas` sempre.
 */
export function breakdownExpenses(
  transactions: readonly (ClassifiableTransaction & { amount: number })[],
): ExpenseBreakdown {
  let suaParte = 0
  let deOutrasPessoas = 0

  for (const tx of transactions) {
    const signed = expenseSignedAmount(tx)
    if (signed === 0) continue
    if (tx.personId) deOutrasPessoas += signed
    else suaParte += signed
  }

  return { movimentado: suaParte + deOutrasPessoas, suaParte, deOutrasPessoas }
}

/** Soma das receitas de um conjunto de lançamentos. */
export function sumIncome(
  transactions: readonly (ClassifiableTransaction & { amount: number })[],
): number {
  return transactions.reduce(
    (sum, tx) => (isIncomeTransaction(tx) ? sum + tx.amount : sum),
    0,
  )
}
