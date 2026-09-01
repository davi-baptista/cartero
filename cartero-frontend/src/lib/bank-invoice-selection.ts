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
 * Todos os bancos com a fatura da competência.
 *
 * Ordem ESTÁVEL por nome, diferente da lista por urgência: num mês fechado não
 * há urgência a comunicar, e reordenar por status faria as rows saltarem de
 * posição a cada troca de mês — o usuário perderia a referência de onde cada
 * cartão está.
 *
 * Nenhum banco é escondido por não ter fatura: a lista é de BANCOS, e some com
 * um cartão só porque o mês não teve gasto esconderia o próprio cartão.
 */
export function banksForPeriod<T extends { id: string; name: string }>(
  banks: T[],
  invoices: Invoice[],
  period: { month: number; year: number },
): Array<BankMonthRow<T>> {
  return banks
    .map((bank) => {
      const invoice = invoiceForPeriod(bank.id, invoices, period)
      const amount = invoice ? Number(invoice.totalAmount) : 0
      const reimbursable = invoice?.reimbursable ?? 0
      return { bank, invoice, amount, reimbursable, ownAmount: amount - reimbursable }
    })
    .sort((a, b) => a.bank.name.localeCompare(b.bank.name))
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
  }

  for (const row of rows) {
    if (!row.invoice) continue
    summary.total += row.amount
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
