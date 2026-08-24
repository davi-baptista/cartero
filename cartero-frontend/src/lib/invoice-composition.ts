import { expenseSignedAmount, isIncomeTransaction } from '@/lib/money-semantics'
import type { Transaction } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Composição de uma fatura
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A fatura tem duas dimensões que não se reduzem uma à outra:
 *
 *   • **Categoria** — o que foi comprado (Lazer, Alimentação…)
 *   • **Responsabilidade** — quem assume o valor (`personId`)
 *
 * Um jantar dividido é ao mesmo tempo Lazer e responsabilidade da Mariana.
 * Trocar a Category persistida para "Outra pessoa" apagaria a primeira
 * dimensão — e quebraria a categoria assim que a pessoa fosse desvinculada.
 *
 * A solução é um bucket VIRTUAL: `personId != null` agrupa em
 * "De outras pessoas" **apenas na visualização**. Nada é persistido, e a
 * Transaction continua com sua Category real.
 */

/** Chave do bucket virtual. Nunca vai ao banco. */
export const THIRD_PARTY_BUCKET = '__third_party__'

export interface CompositionRow {
  /** `categoryId` real, ou `THIRD_PARTY_BUCKET`. */
  key: string
  name: string
  amount: number
  color: string | null
  icon: string | null
  /** `true` no bucket virtual — a UI o marca de forma distinta. */
  isThirdParty: boolean
}

export interface InvoiceBreakdown {
  /** O que o banco cobra: `Invoice.totalAmount`. */
  gross: number
  /** Parcela economicamente de terceiros. */
  others: number
  /** `gross - others`. Uma subtração, não uma segunda soma. */
  own: number
}

/**
 * Decompõe a fatura em bruto / sua parte / de outras pessoas.
 *
 * `own` é **derivado** de `gross - others`, não somado independentemente. Com
 * duas somas paralelas, `own + others` podia deixar de fechar com o total da
 * fatura — e o cabeçalho passaria a contradizer o próprio número acima dele.
 *
 * `Number(...)` na entrada porque a API serializa `Decimal` como string: sem
 * isso a soma concatena texto e o resultado chega como `NaN`.
 */
export function invoiceBreakdown(
  totalAmount: number | string,
  transactions: readonly Transaction[] = [],
): InvoiceBreakdown {
  const gross = Number(totalAmount) || 0

  let others = 0
  for (const tx of transactions) {
    if (isIncomeTransaction(tx)) continue
    if (!tx.personId) continue
    // `expenseSignedAmount` trata estorno como negativo — inclusive o legado
    // de terceiro, que abate em vez de aumentar.
    others += expenseSignedAmount({ ...tx, amount: Number(tx.amount) || 0 })
  }

  return { gross, others, own: gross - others }
}

/**
 * Linhas da composição, ordenadas por valor decrescente.
 *
 * Uma transação de terceiro entra **exclusivamente** no bucket virtual, nunca
 * também na sua categoria: contá-la nos dois lugares faria a soma das linhas
 * ultrapassar o total da fatura, e sugeriria que os R$ 240 do jantar são gasto
 * pessoal de Lazer.
 *
 * A soma das linhas fecha com `gross`.
 */
export function invoiceComposition(
  transactions: readonly Transaction[] = [],
): CompositionRow[] {
  const rows = new Map<string, CompositionRow>()

  for (const tx of transactions) {
    if (isIncomeTransaction(tx)) continue

    const signed = expenseSignedAmount({ ...tx, amount: Number(tx.amount) || 0 })
    if (signed === 0) continue

    const isThirdParty = Boolean(tx.personId)
    const key = isThirdParty ? THIRD_PARTY_BUCKET : (tx.categoryId ?? 'sem-categoria')

    const existing = rows.get(key)
    if (existing) {
      existing.amount += signed
      continue
    }

    rows.set(key, {
      key,
      name: isThirdParty
        ? 'De outras pessoas'
        : (tx.category?.name ?? 'Sem categoria'),
      amount: signed,
      // O bucket virtual não tem cor/ícone de Category — a UI decide.
      color: isThirdParty ? null : (tx.category?.color ?? null),
      icon: isThirdParty ? null : (tx.category?.icon ?? null),
      isThirdParty,
    })
  }

  /*
    Linhas zeradas ou negativas saem: uma categoria totalmente estornada não é
    "gasto" da fatura. O bucket de terceiros segue a mesma regra.
  */
  return [...rows.values()]
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount)
}

/**
 * Filtra as transações da fatura pela linha selecionada da composição.
 *
 * O filtro é só navegação: não altera total, sua parte, status nem a fatura.
 */
export function filterByCompositionKey(
  transactions: readonly Transaction[],
  key: string | null,
): Transaction[] {
  if (!key) return [...transactions]

  if (key === THIRD_PARTY_BUCKET) {
    return transactions.filter((tx) => Boolean(tx.personId))
  }

  // Categoria real: só as PRÓPRIAS. As de terceiro pertencem ao outro bucket,
  // e mostrá-las aqui contradiria a composição exibida acima.
  return transactions.filter(
    (tx) => !tx.personId && (tx.categoryId ?? 'sem-categoria') === key,
  )
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Resumo da seção "Faturas" no Orçamento
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Espelha `summarizePeopleSettlements`: as duas seções são irmãs e mostram
 * título + composição à esquerda, agregado neutro à direita.
 *
 * O BRUTO vem de `totalInvoices`, o agregado que o backend já consolida — e
 * do qual `netAmount` é derivado (`totalInvoices - totalReimbursable`). Somar
 * `own + thirdParty` daria o mesmo número, mas usar a fonte consolidada
 * garante que o cabeçalho feche com as faturas listadas mesmo se a relação
 * entre os três mudar no backend.
 */
export interface InvoiceSectionSummary {
  /** Bruto cobrado pelos bancos. NÃO é `totalToPay`. */
  gross: number
  /** Parcela econômica do usuário. */
  own: number
  /** Parcela de terceiros dentro das faturas. */
  thirdParty: number
}

export function summarizeInvoiceSection(input: {
  totalInvoices: number
  netAmount: number
  totalReimbursable: number
}): InvoiceSectionSummary {
  return {
    gross: input.totalInvoices,
    own: input.netAmount,
    thirdParty: input.totalReimbursable,
  }
}

/**
 * Composição exibida ao lado do título — só os lados que existem.
 *
 * Sem terceiros, "R$ 0,00 de outras pessoas" seria ruído: a ausência já é
 * dita pela omissão, como no cabeçalho de Acertos.
 */
export function invoiceSectionParts(
  summary: InvoiceSectionSummary,
): Array<{ kind: 'own' | 'thirdParty'; amount: number }> {
  const parts: Array<{ kind: 'own' | 'thirdParty'; amount: number }> = []
  if (summary.own > 0.005) parts.push({ kind: 'own', amount: summary.own })
  if (summary.thirdParty > 0.005) {
    parts.push({ kind: 'thirdParty', amount: summary.thirdParty })
  }
  return parts
}
