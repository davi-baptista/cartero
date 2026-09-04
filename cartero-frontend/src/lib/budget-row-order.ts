import { InvoiceStatus } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A ordem do Orçamento muda de pergunta quando o item é resolvido
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A lista era ordenada só por valor, e a fatura de R$ 2.000 já paga ficava
 * acima de uma de R$ 180 que vence amanhã. O maior número da tela era o que
 * menos pedia ação.
 *
 * Ordenar tudo por urgência tem o defeito simétrico: num mês inteiramente
 * quitado, "urgência" não distingue nada, e a ordem cairia no alfabeto ou na
 * resposta da API — perdendo a única leitura que ainda interessa ali, que é
 * quanto cada coisa pesou.
 *
 * Então a chave primária não é nem uma nem outra: é o ESTADO.
 *
 *   ainda exige ação  →  "o que atendo primeiro?"      urgência
 *   já resolvido      →  "o que pesou mais no mês?"    valor
 *
 * ── Por que o estado vem antes do valor ──
 *
 * São perguntas de tempos diferentes. Enquanto há o que fazer, valor é
 * secundário: pagar a conta de amanhã importa mais que a de R$ 2.000 que
 * vence em três semanas. Depois que nada mais exige ação, prazo não existe
 * mais — e o valor volta a ser a informação.
 *
 * ── O valor é o EXIBIDO ──
 *
 * Nunca o bruto quando a row mostra o líquido. Fabricio deve R$ 11 e tem
 * R$ 10 a receber: a contribuição ao orçamento é R$ 1, é isso que a row
 * exibe, e é por R$ 1 que ele ordena. Ordenar por R$ 11 colocaria acima de
 * uma dívida de R$ 5 alguém que pesa cinco vezes menos.
 *
 * ── Cada domínio traz a própria urgência ──
 *
 * Não há um comparador universal aqui: fatura tem status e fechamento, acerto
 * tem próximo evento, dívida tem vencimento. Este módulo decide a FRONTEIRA
 * (aberto antes de resolvido) e cada `*BudgetOrder` traduz o seu domínio.
 *
 * A escala de status de fatura espelha `MONTH_ROW_RANK` de Bancos, e o
 * "próximo evento" de pessoa espelha `nextSettlementItem` — a mesma fatura e a
 * mesma pessoa não podem sair em posições relativas diferentes entre telas.
 */

/** Aberto antes de resolvido. A chave primária de toda seção do Orçamento. */
export const OPEN_RANK = 0
export const SETTLED_RANK = 1

/**
 * Compara duas rows já classificadas.
 *
 * `open` decide o grupo; dentro do grupo aberto, `urgency` e depois `dueOrder`
 * (menor primeiro); dentro do resolvido, `amount` DESC.
 *
 * `label` é o desempate final, e existe em todos os caminhos: sem ele a ordem
 * viria da resposta da API, e duas rows equivalentes trocariam de lugar entre
 * dois carregamentos da mesma tela.
 */
export interface OrderableBudgetRow {
  /** Ainda exige ação? Decide QUAL pergunta a ordem responde. */
  open: boolean
  /**
   * Posição na fila de atenção — menor primeiro.
   *
   * Rank inteiro do domínio (status de fatura, por exemplo) ou `0` quando o
   * domínio não tem estágios. Só é lido no grupo aberto: um item resolvido
   * não tem prazo a cumprir.
   */
  urgency: number
  /**
   * Dia do próximo marco, como ordinal comparável — desempata DENTRO do rank.
   *
   * Separado de `urgency` de propósito: combinar os dois num número só
   * exigiria multiplicar por uma constante e clampar a data, e a ordem
   * passaria a depender da escala escolhida. Duas chaves não têm esse risco.
   */
  dueOrder: number
  /**
   * O valor que a ROW EXIBE — líquido quando a row mostra líquido.
   *
   * Só é lido no grupo resolvido.
   */
  amount: number
  /** Desempate determinístico. */
  label: string
}

export function compareBudgetRows(
  a: OrderableBudgetRow,
  b: OrderableBudgetRow,
): number {
  const rankA = a.open ? OPEN_RANK : SETTLED_RANK
  const rankB = b.open ? OPEN_RANK : SETTLED_RANK
  if (rankA !== rankB) return rankA - rankB

  if (a.open) {
    /*
      Aberto: a fila de atenção. Valor NÃO participa — é o ponto da fase.
    */
    if (a.urgency !== b.urgency) return a.urgency - b.urgency
    if (a.dueOrder !== b.dueOrder) return a.dueOrder - b.dueOrder
  } else {
    /*
      Resolvido: relevância histórica. Maior primeiro.

      A tolerância de centavo evita que ruído de ponto flutuante (0.01 vindo
      de somas de reais) decida a ordem em vez do desempate estável.
    */
    if (Math.abs(a.amount - b.amount) > 0.005) return b.amount - a.amount
  }

  return a.label.localeCompare(b.label, 'pt-BR')
}

/** Ordena sem mutar: a lista vem do cache do React Query. */
export function sortBudgetRows<T>(
  rows: readonly T[],
  toOrderable: (row: T) => OrderableBudgetRow,
): T[] {
  /*
    As chaves são derivadas UMA vez, antes do sort — dentro do comparador
    rodariam O(n log n) vezes sobre os mesmos valores, e `toOrderable` pode
    fazer parsing de data.
  */
  return rows
    .map((row) => ({ row, key: toOrderable(row) }))
    .sort((x, y) => compareBudgetRows(x.key, y.key))
    .map((entry) => entry.row)
}

// ─── Faturas ─────────────────────────────────────────────────────────────

/**
 * A fila de atenção de uma fatura, na MESMA ordem de Bancos.
 *
 * `OVERDUE → CLOSED → OPEN` não é uma escala de gravidade inventada aqui: é
 * `MONTH_ROW_RANK`, e a mesma fatura precisa aparecer na mesma posição
 * relativa nas duas telas.
 */
const INVOICE_URGENCY: Record<InvoiceStatus, number> = {
  [InvoiceStatus.OVERDUE]: 0,
  [InvoiceStatus.CLOSED]: 1,
  [InvoiceStatus.OPEN]: 2,
  /* Nunca lido: PAID cai no grupo resolvido, que ordena por valor. */
  [InvoiceStatus.PAID]: 3,
}

/**
 * A row de uma fatura do Orçamento.
 *
 * O `amount` é o que a row EXIBE — a decomposição bruto/sua-parte fica na
 * apresentação, e a ordem tem de explicar o número visível.
 */
export function invoiceBudgetOrder(invoice: {
  status: InvoiceStatus
  closeDate?: string | null
  dueDate?: string | null
  bankName: string
  displayedAmount: number
}): OrderableBudgetRow {
  const aberta = invoice.status !== InvoiceStatus.PAID

  /*
    Aberta se aproxima do FECHAMENTO; fechada e vencida, do vencimento. O
    mesmo critério de `nextEventTime` em Bancos.
  */
  const marco =
    invoice.status === InvoiceStatus.OPEN ? invoice.closeDate : invoice.dueDate

  return {
    open: aberta,
    /* O status domina; a data desempata dentro dele. */
    urgency: INVOICE_URGENCY[invoice.status],
    dueOrder: marco ? diaOrdinal(marco) : Number.MAX_SAFE_INTEGER,
    amount: invoice.displayedAmount,
    label: invoice.bankName,
  }
}

/**
 * `YYYY-MM-DD` como número de dias comparável.
 *
 * Por string, nunca `new Date(iso)`: um dia civil sem hora é interpretado
 * como UTC e, em fuso negativo, volta o dia anterior. O valor absoluto não
 * importa — só a ordem.
 */
function diaOrdinal(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return Number.MAX_SAFE_INTEGER
  return y * 372 + m * 31 + d
}

// ─── Acertos com pessoas ─────────────────────────────────────────────────

/**
 * A row de um acerto com pessoa.
 *
 * ── "Resolvido" aqui é COBERTURA, não fim da relação ──
 *
 * `contribution.isSettled` responde "ainda vai sair dinheiro daqui?", e é a
 * mesma autoridade que `peopleRowView` usa para escolher o trailing. Usar
 * `open.itemCount` faria uma row exibindo `PAGO` ser ordenada como aberta:
 * com R$ 11 pagos e R$ 10 a receber, a saída de R$ 1 está coberta e a relação
 * bilateral continua viva.
 */
export function personBudgetOrder(person: {
  contribution: { isSettled: boolean }
  nextItem?: { dueDate: string } | null
  personName: string
  displayedAmount: number
}): OrderableBudgetRow {
  const aberto = !person.contribution.isSettled

  return {
    open: aberto,
    /* Sem estágios de status: o prazo é a única fila. */
    urgency: 0,
    /*
      O menor vencimento do lado que decide o líquido — vencido tem data
      menor, então lidera sem precisar de um `if` de urgência.
    */
    dueOrder: person.nextItem
      ? diaOrdinal(person.nextItem.dueDate)
      : Number.MAX_SAFE_INTEGER,
    amount: person.displayedAmount,
    label: person.personName,
  }
}

// ─── Dívidas ─────────────────────────────────────────────────────────────

/**
 * A row de uma dívida do Orçamento.
 *
 * O vencimento é a fila de atenção — a mesma régua de `timingUrgency`, que a
 * metadata da row já usa para escolher o tom. Aqui só a ORDEM interessa, e o
 * dia ordinal a resolve sem consultar a janela de urgência.
 */
export function debtBudgetOrder(debt: {
  isPaid: boolean
  dueDate?: string | null
  title: string
  displayedAmount: number
}): OrderableBudgetRow {
  return {
    open: !debt.isPaid,
    urgency: 0,
    dueOrder: debt.dueDate ? diaOrdinal(debt.dueDate) : Number.MAX_SAFE_INTEGER,
    amount: debt.displayedAmount,
    label: debt.title,
  }
}
