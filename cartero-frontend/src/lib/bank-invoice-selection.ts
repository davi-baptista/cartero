import { InvoiceStatus, type Invoice } from '@/types'
import { parseInvoiceDate } from './invoice-dates'

/**
 * Qual fatura representa um banco na listagem — fonte única.
 *
 * Antes havia duas heurísticas concorrentes: a ordenação lia `['invoices']` e
 * agrupava OVERDUE+CLOSED juntas, enquanto o valor exibido vinha de uma query
 * por banco (`['bank-invoices','mini',id]`) que as separava. Um card podia ser
 * ordenado por uma fatura e mostrar os dados de outra — e as duas fontes
 * podiam estar dessincronizadas.
 *
 * Agora a seleção acontece uma vez por banco e alimenta tudo: posição na
 * lista, valor, status, prazo e rateio. Sem consulta por banco, e sem
 * recalcular dentro do comparador do `.sort()`.
 *
 * ─── Regra de produto (preservada) ────────────────────────────────────────
 *
 * Urgência primeiro, data depois: `OVERDUE` → `CLOSED` → `OPEN`. Faturas
 * pagas nunca são escolhidas, e faturas zeradas são ignoradas — não há o que
 * cobrar. Uma fatura vencida de três meses atrás ganha da que vence amanhã,
 * porque é a que exige ação.
 *
 * As datas vêm PERSISTIDAS da fatura. Derivá-las da configuração do banco
 * fazia o prazo exibido mudar quando o cartão era reconfigurado.
 */

/** Fatura escolhida para representar o banco, com os números já derivados. */
export interface BankInvoiceSelection {
  invoice: Invoice
  /** Bruto: o que o banco vai cobrar. */
  amount: number
  /** Parte que pertence a outras pessoas. */
  reimbursable: number
  /** `amount − reimbursable`. */
  ownAmount: number
  status: InvoiceStatus
  /** Data que define a urgência: vencimento, ou fechamento se ainda aberta. */
  referenceDate: Date
}

/** Ordem de urgência. Menor é mais urgente; PAID nunca é candidata. */
const STATUS_PRIORITY: Partial<Record<InvoiceStatus, number>> = {
  [InvoiceStatus.OVERDUE]: 0,
  [InvoiceStatus.CLOSED]: 1,
  [InvoiceStatus.OPEN]: 2,
}

/**
 * A fatura mais urgente do banco, ou `null` se não houver nenhuma pendente.
 *
 * `invoices` é a lista completa do usuário; o filtro por banco acontece aqui
 * para que o chamador possa agrupar tudo numa passada.
 */
export function selectBankInvoice(
  bankId: string,
  invoices: Invoice[],
): BankInvoiceSelection | null {
  let best: BankInvoiceSelection | null = null
  let bestPriority = Number.POSITIVE_INFINITY

  for (const invoice of invoices) {
    if (invoice.bankId !== bankId) continue
    // Fatura zerada não representa cobrança alguma.
    if (Number(invoice.totalAmount) <= 0) continue

    const priority = STATUS_PRIORITY[invoice.status]
    if (priority === undefined) continue // PAID

    // Aberta ainda não tem vencimento relevante: o que importa é quando fecha.
    const referenceDate = parseInvoiceDate(
      invoice.status === InvoiceStatus.OPEN ? invoice.closeDate : invoice.dueDate,
    )

    const isBetter =
      priority < bestPriority ||
      (priority === bestPriority &&
        best !== null &&
        referenceDate < best.referenceDate)

    if (best === null || isBetter) {
      const amount = Number(invoice.totalAmount)
      const reimbursable = invoice.reimbursable ?? 0
      best = {
        invoice,
        amount,
        reimbursable,
        ownAmount: amount - reimbursable,
        status: invoice.status,
        referenceDate,
      }
      bestPriority = priority
    }
  }

  return best
}

/**
 * Bancos ordenados por urgência, cada um já com a sua fatura.
 *
 * A seleção é feita UMA VEZ por banco, antes do `.sort()`. A versão anterior
 * recalculava a prioridade dentro do comparador, refiltrando a lista de
 * faturas a cada comparação — O(n² · m) em algo que cabe numa passada.
 */
export function orderBanksByUrgency<T extends { id: string; name: string }>(
  banks: T[],
  invoices: Invoice[],
): Array<{ bank: T; selection: BankInvoiceSelection | null }> {
  /*
    `map` já cria um array novo, então o `sort` abaixo não alcança a entrada.
    O `[...]` explicita a intenção: nada que venha do cache do React Query
    pode ser reordenado no lugar — dois consumidores veriam ordens diferentes.
  */
  const rows = [
    ...banks.map((bank) => ({
      bank,
      selection: selectBankInvoice(bank.id, invoices),
    })),
  ]

  return rows.sort((a, b) => {
    const aPriority = a.selection
      ? (STATUS_PRIORITY[a.selection.status] ?? 3)
      : 3
    const bPriority = b.selection
      ? (STATUS_PRIORITY[b.selection.status] ?? 3)
      : 3
    if (aPriority !== bPriority) return aPriority - bPriority

    const aDate = a.selection?.referenceDate.getTime() ?? Number.POSITIVE_INFINITY
    const bDate = b.selection?.referenceDate.getTime() ?? Number.POSITIVE_INFINITY
    if (aDate !== bDate) return aDate - bDate

    return a.bank.name.localeCompare(b.bank.name)
  })
}

// ─── Visão mensal ─────────────────────────────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A fatura de um banco NUMA competência
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `selectBankInvoice` responde "o que exige ação agora?" — urgência, ignorando
 * pagas e zeradas. Serve à ordenação, não a uma consulta histórica: com ela a
 * lista mostrava sempre a mesma fatura, rotulada "FATURA ATUAL", e ver agosto
 * exigia entrar no banco.
 *
 * Esta responde outra pergunta: **"qual é a fatura DESTE mês?"**. Uma só pode
 * existir — `@@unique([userId, bankId, month, year])` no schema —, então não há
 * escolha a fazer: ou a competência tem fatura, ou não tem.
 *
 * ── A competência é `month`/`year`, nunca uma data ──
 *
 * Os dois são inteiros PERSISTIDOS na criação, pelo mês de FECHAMENTO. Derivar
 * de `dueDate` erraria: uma fatura que fecha em 28/09 e vence em 10/10
 * pertence a setembro, e por `dueDate` cairia em outubro — todo cartão com
 * vencimento no mês seguinte apareceria deslocado.
 *
 * ── Fatura zerada NÃO é omitida aqui ──
 *
 * A seleção por urgência as ignora, e com razão: não há o que cobrar. Mas numa
 * visão mensal a ausência é informação — "R$ 0,00" diz que o mês não teve
 * gasto, enquanto sumir com a row sugeriria que o cartão não existe.
 */
export function invoiceForPeriod(
  bankId: string,
  invoices: Invoice[],
  period: { month: number; year: number },
): Invoice | null {
  return (
    invoices.find(
      (invoice) =>
        invoice.bankId === bankId &&
        invoice.month === period.month &&
        invoice.year === period.year,
    ) ?? null
  )
}

/** Um banco e a sua fatura na competência exibida. */
export interface BankMonthRow<T> {
  bank: T
  invoice: Invoice | null
  /** Bruto da fatura; `0` quando o mês não tem fatura. */
  amount: number
  /** Parte que pertence a outras pessoas. */
  reimbursable: number
  /** `amount − reimbursable`. */
  ownAmount: number
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Importância de uma row na visão mensal
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Duas dimensões, nesta ordem: a CLASSE de urgência decide primeiro, e a
 * proximidade do próximo evento desempata dentro dela. Ordenar só por status
 * deixaria uma fechada que vence em 20 dias na frente de outra que vence
 * amanhã; ordenar só por data misturaria uma aberta que fecha hoje com uma
 * vencida há três meses.
 *
 * O ranking de OVERDUE → CLOSED → OPEN é o mesmo de `orderBanksByUrgency`,
 * que ordenava a lista antes de ela virar mensal. A versão mensal a
 * substituiu por ordem alfabética — o que faz sentido para um mês encerrado,
 * mas apaga a urgência do mês corrente, que é quando ela importa.
 *
 * ── Onde PAID e "sem fatura" entram ──
 *
 * Na policy antiga os dois compartilhavam o rank 3, e isso nunca foi decidido:
 * `selectBankInvoice` jamais devolvia uma fatura paga, então o 3 valia só para
 * "banco sem pendência". A visão mensal mudou o cenário — consultar agosto
 * mostra faturas pagas o tempo todo —, e os dois precisam se separar:
 *
 *   PAID        → o ciclo aconteceu e está resolvido: depois de tudo que
 *                 ainda exige ação, mas ANTES de quem não tem fatura;
 *   sem fatura  → sempre por último. Não há obrigação, valor ou data — a row
 *                 existe para dizer que o cartão continua ali.
 *
 * A invariante "qualquer fatura precede a ausência dela" vale mesmo quando o
 * banco sem fatura viria primeiro no alfabeto, e mesmo quando a única fatura
 * do mês já está paga.
 */
const MONTH_ROW_RANK: Record<InvoiceStatus, number> = {
  [InvoiceStatus.OVERDUE]: 0,
  [InvoiceStatus.CLOSED]: 1,
  [InvoiceStatus.OPEN]: 2,
  [InvoiceStatus.PAID]: 3,
}

/**
 * Último grupo. Nenhum status divide este rank.
 *
 * A invariante "qualquer fatura precede a ausência dela" tem DUAS barreiras
 * independentes: este rank, e o `Infinity` de `nextEventTime`. Empatar o rank
 * de PAID com este ainda produziria a ordem certa — o que é proposital: a
 * regra mais importante da lista não devia depender de um único número estar
 * correto.
 */
const NO_INVOICE_RANK = 4

function monthRowRank(invoice: Invoice | null): number {
  return invoice === null ? NO_INVOICE_RANK : MONTH_ROW_RANK[invoice.status]
}

/**
 * Quando o próximo fato relevante da fatura acontece.
 *
 * Aberta ainda não tem vencimento a cumprir: o que se aproxima é o
 * FECHAMENTO. Nos demais estados o vencimento é o marco — inclusive em PAID,
 * onde ordena o histórico por data em vez de deixá-lo à mercê do alfabeto.
 *
 * Sem fatura não há evento: `Infinity` mantém essas rows no fim sem precisar
 * de um caso especial no comparador.
 */
function nextEventTime(invoice: Invoice | null): number {
  if (invoice === null) return Number.POSITIVE_INFINITY
  const iso =
    invoice.status === InvoiceStatus.OPEN ? invoice.closeDate : invoice.dueDate
  return parseInvoiceDate(iso).getTime()
}

/**
 * Todos os bancos com a fatura da competência, por importância.
 *
 * A ordem muda entre meses porque os fatos mudam: a mesma fatura que estava
 * aberta em setembro aparece paga em agosto, e a posição acompanha. Isso é
 * diferente de instabilidade — dentro de um mês a ordem é determinística, e o
 * que a move é o estado real de cada fatura.
 *
 * Nenhum banco é escondido por não ter fatura: a lista é de BANCOS, e sumir
 * com um cartão só porque o mês não teve gasto esconderia o próprio cartão.
 * Ele vai para o fim, não para fora.
 */
export function banksForPeriod<T extends { id: string; name: string }>(
  banks: T[],
  invoices: Invoice[],
  period: { month: number; year: number },
): Array<BankMonthRow<T>> {
  const rows = banks.map((bank) => {
    const invoice = invoiceForPeriod(bank.id, invoices, period)
    const amount = invoice ? Number(invoice.totalAmount) : 0
    const reimbursable = invoice?.reimbursable ?? 0
    return { bank, invoice, amount, reimbursable, ownAmount: amount - reimbursable }
  })

  /*
    As datas são convertidas UMA vez, antes do sort: `parseInvoiceDate` dentro
    do comparador rodaria O(n log n) vezes sobre os mesmos valores.
  */
  const ranked = rows.map((row) => ({
    row,
    rank: monthRowRank(row.invoice),
    nextEvent: nextEventTime(row.invoice),
  }))

  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    if (a.nextEvent !== b.nextEvent) return a.nextEvent - b.nextEvent
    /* Tie-break determinístico: sem ele a ordem viria da resposta da API. */
    return a.row.bank.name.localeCompare(b.row.bank.name)
  })

  return ranked.map((entry) => entry.row)
}

/** Resumo do mês exibido no topo da lista. */
export interface BankMonthSummary {
  /** Soma bruta de TODAS as faturas da competência, pagas inclusive. */
  total: number
  invoiceCount: number
  openCount: number
  closedCount: number
  overdueCount: number
  paidCount: number
  /** O que ainda não foi quitado — `total` menos as pagas. */
  unpaid: number
  /**
   * Sua parte e a de terceiros, somadas sobre as faturas do mês.
   *
   * Mesma decomposição que o Orçamento e o detalhe da fatura já mostram; aqui
   * é só a agregação mensal dela.
   */
  own: number
  thirdParty: number
}

/**
 * O resumo responde "quanto somam as faturas deste mês?".
 *
 * A fatura PAGA entra no total: ela pertence ao ciclo, e tirá-la faria o número
 * encolher sozinho quando o usuário pagasse — como se o gasto não tivesse
 * existido. "Quanto ainda falta pagar" é outra pergunta, e tem campo próprio
 * (`unpaid`), em vez de os dois disputarem o mesmo número.
 */
export function summarizeBankMonth<T>(
  rows: Array<BankMonthRow<T>>,
): BankMonthSummary {
  const summary: BankMonthSummary = {
    total: 0,
    invoiceCount: 0,
    openCount: 0,
    closedCount: 0,
    overdueCount: 0,
    paidCount: 0,
    unpaid: 0,
    own: 0,
    thirdParty: 0,
  }

  for (const row of rows) {
    if (!row.invoice) continue
    summary.total += row.amount
    summary.own += row.ownAmount
    summary.thirdParty += row.reimbursable
    summary.invoiceCount += 1

    switch (row.invoice.status) {
      case InvoiceStatus.OPEN:
        summary.openCount += 1
        break
      case InvoiceStatus.CLOSED:
        summary.closedCount += 1
        break
      case InvoiceStatus.OVERDUE:
        summary.overdueCount += 1
        break
      case InvoiceStatus.PAID:
        summary.paidCount += 1
        break
    }

    if (row.invoice.status !== InvoiceStatus.PAID) summary.unpaid += row.amount
  }

  return summary
}

// ─── Rótulo do trailing ───────────────────────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O que o trailing diz sobre a fatura
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O ESTADO OPERACIONAL, espelhando o status persistido. É o que se lê de
 * relance para saber o que fazer com a linha.
 *
 *   Fatura aberta    ainda acumula lançamentos
 *   Fatura fechada   valor definido, aguardando o vencimento
 *   Fatura vencida   passou do prazo e não foi paga
 *   Paga             resolvida
 *   Sem fatura       o mês não teve fatura neste banco
 *
 * ── Por que não o ciclo ──
 *
 * Uma versão anterior mostrava "Fatura atual" / "Fatura aberta" aqui, para
 * dizer se a competência exibida era a corrente. A intenção era boa — evitar
 * duas cores concorrentes na row —, mas custou a leitura rápida: "Fatura
 * atual" não distingue uma fatura que ainda acumula de uma que já fechou e
 * vence em três dias, e essas duas pedem ações diferentes.
 *
 * A noção de ciclo não se perdeu: subiu para o resumo do topo
 * (`bankMonthSummaryLines`), onde vale uma vez para o mês inteiro em vez de
 * se repetir em cada linha.
 *
 * ── Cor ──
 *
 * Só `paid` (verde) e `overdue` (vermelho) ganham tom: são os dois estados
 * que mudam o que o usuário faz. `open` e `closed` ficam muted — o prazo no
 * subtexto já carrega a urgência, e colorir os dois lados faria a row
 * competir consigo mesma.
 */
export type BankTrailingState =
  | 'noInvoice'
  | 'paid'
  | 'overdue'
  | 'closed'
  | 'open'

/** Copy oficial. Texto, nunca só cor — o status não pode depender de tom. */
export const BANK_TRAILING_LABEL: Record<BankTrailingState, string> = {
  noInvoice: 'Sem fatura',
  paid: 'Paga',
  overdue: 'Fatura vencida',
  closed: 'Fatura fechada',
  open: 'Fatura aberta',
}

/**
 * Tom de cada estado.
 *
 * Só `paid` e `overdue` ganham cor: são os dois fatos que mudam o que o
 * usuário faz. Os rótulos de ciclo ficam muted de propósito — eles dão
 * contexto, e contexto não deve competir com a urgência do subtexto.
 */
export const BANK_TRAILING_TONE: Record<BankTrailingState, string> = {
  noInvoice: 'text-muted-foreground/70',
  paid: 'text-paid',
  overdue: 'text-destructive',
  closed: 'text-muted-foreground',
  open: 'text-muted-foreground',
}

export function bankTrailingState(invoice: Invoice | null): BankTrailingState {
  if (invoice === null) return 'noInvoice'

  switch (invoice.status) {
    case InvoiceStatus.PAID:
      return 'paid'
    case InvoiceStatus.OVERDUE:
      return 'overdue'
    case InvoiceStatus.CLOSED:
      return 'closed'
    case InvoiceStatus.OPEN:
      return 'open'
  }
}
