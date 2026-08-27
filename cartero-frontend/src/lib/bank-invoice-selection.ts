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
