export enum TransactionType {
  INCOME = 'INCOME',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  PIX = 'PIX',
  BOLETO = 'BOLETO',
}

export enum InvoiceStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
}

export enum InstallmentScope {
  ONE = 'ONE',
  NEXT = 'NEXT',
  ALL = 'ALL',
}

export interface User {
  id: string
  email: string
  name: string
  salary?: number
  createIncomeOnReceivablePaid: boolean
  createExpenseOnDebtPaid: boolean
  notifyDaysBefore: number
  createdAt: string
  updatedAt: string
}

export interface Bank {
  id: string
  userId: string
  name: string
  invoiceCloseDate: number
  invoiceDueDate: number
  invoiceDueDaysAfterClose: number
  isSystem?: boolean
  /** Conta encerrada: fora dos lançamentos novos, histórico preservado. */
  isArchived?: boolean
  /**
   * Se o banco pode ser EXCLUÍDO — calculado pelo backend a partir dos
   * vínculos. Com histórico a ação apropriada é arquivar, não excluir; deixar
   * o frontend recontar isso criaria uma segunda regra, que divergiria da que
   * o servidor aplica.
   */
  canDelete?: boolean
  _count?: {
    transactions: number
    invoices: number
    subscriptions?: number
  }
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  userId: string
  name: string
  color?: string
  icon?: string
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

export interface Transaction {
  id: string
  userId: string
  bankId: string
  categoryId: string
  invoiceId?: string
  parentId?: string
  personId?: string
  person?: Person
  /** Preenchido quando o lançamento foi gerado por uma assinatura. */
  subscriptionId?: string
  type: TransactionType
  title: string
  amount: number
  isRefund?: boolean
  description?: string
  date: string
  bank?: Bank
  category?: Category
  invoice?: Invoice
  createdAt: string
  updatedAt: string
}

export interface Subscription {
  id: string
  userId: string
  bankId: string
  /**
   * Categoria dos lançamentos gerados. Escolhida pelo usuário; sem escolha,
   * cai na categoria de sistema "Assinatura".
   */
  categoryId: string
  title: string
  type: TransactionType
  amount: number
  description?: string
  /** Dia da cobrança (1-31). Meses curtos são ajustados na geração. */
  dayOfMonth: number
  /**
   * Primeiro ciclo coberto, "YYYY-MM". Imutável após a criação.
   *
   * Significa "assinando desde" — não é o marco de geração. Uma assinatura
   * pausada e reativada mantém o `startedAt` original.
   */
  startedAt: string
  isActive: boolean
  lastGeneratedFor?: string | null
  /**
   * Primeiro ciclo que a ativação atual pode gerar, "YYYY-MM".
   *
   * Gravado ao reativar; é o que impede a reativação de cobrar os meses da
   * pausa retroativamente.
   */
  activeSince?: string | null
  /**
   * Data da próxima cobrança, calculada pelo BACKEND. `null` quando pausada.
   *
   * Vem do servidor porque a regra é a mesma que decide a geração; derivá-la
   * no cliente criaria um segundo algoritmo, que divergiria.
   */
  nextCharge?: string | null
  bank?: Bank
  category?: Category
  createdAt: string
  updatedAt: string
}

/**
 * Por que um ciclo não gerou lançamento.
 *
 * Todos são decisões deliberadas do backend — nada a corrigir. Falha de
 * verdade vem em `SubscriptionRunResult.failure`.
 */
export type GenerationSkipReason =
  | 'invoice-paid'
  | 'bank-archived'
  | 'bank-missing'

/** Um ciclo que a geração produziu (ou pulou). */
export interface GenerationPlanItem {
  cycle: string
  date: string
  skipped: boolean
  skipReason?: GenerationSkipReason
}

/**
 * Resultado da geração de uma assinatura.
 *
 * `failure` distingue "nada a fazer" de "não consegui fazer" — a ausência
 * dessa distinção era o que deixava a falha invisível.
 */
export interface SubscriptionRunResult {
  subscriptionId: string
  title: string
  generated: GenerationPlanItem[]
  failure?: { reason: string }
}

/** Resumo de uma execução em lote de geração. */
export interface GenerationSummary {
  subscriptions: number
  generated: number
  skipped: number
  failed: number
  failures: Array<{ subscriptionId: string; title: string; reason: string }>
}

/**
 * Resultado da criação: o cadastro E o que a geração produziu, separados.
 *
 * A separação existe porque os dois podem divergir — a assinatura é criada e a
 * geração falha. Antes isso virava um erro genérico, o usuário concluía que
 * nada foi criado e reenviava, ganhando uma segunda assinatura.
 */
export interface SubscriptionCreateResult {
  subscription: Subscription
  generation: GenerationSummary
  /** `true` quando a chave de criação recuperou uma assinatura existente. */
  alreadyExisted: boolean
}

export interface Invoice {
  id: string
  userId: string
  bankId: string
  month: number
  year: number
  status: InvoiceStatus
  /**
   * Fechamento e vencimento CONGELADOS desta fatura.
   *
   * São a fonte de verdade. O frontend não deve mais derivá-los de
   * `bank.invoiceDueDate` + `bank.invoiceDueDaysAfterClose`: recalcular fazia
   * as datas de uma fatura paga mudarem quando o cartão era reconfigurado.
   */
  closeDate: string
  dueDate: string
  /** Bruto: o valor que o banco vai cobrar, incluindo gasto de terceiros. */
  totalAmount: number
  /**
   * Parte da fatura que pertence a outras pessoas. Vem das listagens de
   * fatura; ausente onde o backend não agrega (ex.: fatura isolada).
   */
  reimbursable?: number
  /** `totalAmount − reimbursable`: o que sai do bolso do usuário. */
  ownAmount?: number
  bank?: Bank
  transactions?: Transaction[]
  createdAt: string
  updatedAt: string
}

export interface Person {
  id: string
  userId: string
  name: string
  phone?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Resumo consolidado da relação financeira com uma pessoa.
 *
 * ALL-TIME: nenhum destes números é recortado pelo mês do seletor. Uma dívida
 * vencida em junho e ainda aberta continua contando em agosto — antes ela
 * desaparecia, e o card ainda dizia "no total".
 */
export interface PersonSummary {
  /** Soma de todas as cobranças pendentes. */
  receivablePending: number
  /** Soma de todas as dívidas pendentes. */
  debtPending: number
  /**
   * `receivablePending - debtPending`. Informativo.
   *
   * A quitação não usa este valor: cada item é liquidado pelo próprio.
   */
  netBalance: number
  pendingReceivablesCount: number
  pendingDebtsCount: number
  /**
   * `true` só quando não há NENHUMA pendência.
   *
   * Não confundir com `netBalance === 0`: R$ 500 dos dois lados dá saldo zero
   * com duas obrigações abertas.
   */
  isFullySettled: boolean
}

/**
 * Itens quitados dentro de um intervalo, com o recorte explicitado.
 *
 * O critério é `paidAt`, não `dueDate`: uma dívida vencida em junho e paga em
 * agosto pertence ao histórico de agosto, que é quando o dinheiro se moveu.
 */
export interface PersonPeriod {
  /** O recorte que de fato valeu; `null` quando nenhum filtro foi enviado. */
  appliedRange: { startDate: string | null; endDate: string | null }
  scopedBy: 'paidAt'
  settledDebts: Debt[]
  settledReceivables: Receivable[]
  settledDebtTotal: number
  settledReceivableTotal: number
}

/**
 * Extrato de uma pessoa — dois universos, nomes distintos.
 *
 * Os espelhos (`totalDebts`, `totalReceivables`, `netBalance`, `debts`,
 * `receivables`) foram REMOVIDOS na Fase 8C. Significavam "do mês" antes da
 * Fase 8B e "all-time" depois: o mesmo nome para dois universos, o que fazia
 * qualquer consumidor calcular certo por acidente ou errado sem aviso.
 *
 * A remoção é deliberadamente uma quebra de tipo. Quem tentar ler um espelho
 * falha no typecheck em vez de receber silenciosamente o número do outro
 * universo.
 */
/** Competência mensal de um acerto. */
export interface SettlementCompetence {
  year: number
  month: number
}

/**
 * Item em aberto com as duas competências resolvidas pelo backend.
 *
 * `referenceMonth` é o mês a que o acerto PERTENCE; `dueMonth`, o mês em que
 * VENCE. Para o recebível automático elas divergem: um jantar de 16/08 que
 * vence com a fatura em 10/09 pertence a agosto e vence em setembro.
 */
export type SettlementItem<T> = T & {
  referenceMonth: SettlementCompetence
  dueMonth: SettlementCompetence
}

export interface PersonStatement {
  person: Person
  /** Situação ATUAL: todas as pendências, sem corte temporal. */
  summary: PersonSummary
  /** As pendências que `summary` soma — também all-time. */
  pending: { debts: Debt[]; receivables: Receivable[] }
  /**
   * Universo MENSAL do acerto.
   *
   * O drawer é mensal: um único seletor governa resumo, lista e histórico.
   * `defaultCompetence` é o mês que ele abre — o anterior enquanto o acerto
   * dele ainda estiver em andamento, senão o corrente.
   */
  settlement: {
    defaultCompetence: SettlementCompetence
    receivables: SettlementItem<Receivable>[]
    debts: SettlementItem<Debt>[]
  }
  /** Universo temporal: o único lugar onde o seletor de mês atua. */
  period: PersonPeriod
}

export interface Debt {
  id: string
  userId: string
  personId?: string
  person?: Person
  creditorName: string
  title: string
  amount: number
  description?: string
  occurredAt: string
  dueDate: string
  isAlertEnabled: boolean
  isPaid: boolean
  paidAt?: string
  paymentTransactionId?: string
  parentId?: string
  createdAt: string
  updatedAt: string
}

export interface Receivable {
  id: string
  userId: string
  personId?: string
  person?: Person
  transactionId?: string
  paymentTransactionId?: string
  debtorName: string
  title: string
  amount: number
  description?: string
  occurredAt: string
  dueDate: string
  isPaid: boolean
  paidAt?: string
  parentId?: string
  createdAt: string
  updatedAt: string
}

export interface AuthResponse {
  accessToken: string
  user: User
}

export interface TransactionFilters {
  startDate?: string
  endDate?: string
  bankId?: string
  categoryId?: string
  type?: TransactionType
  invoicePeriod?: boolean
  installmentsOnly?: boolean
}

export interface ApiError {
  message: string
  statusCode: number
}
