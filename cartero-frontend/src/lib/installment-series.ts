import type { Transaction } from '@/types'
import { InstallmentScope } from '@/types'

/**
 * Seleção de parcelas no cliente, espelhando o seletor do backend.
 *
 * A identidade da série é estrutural — `parentId ?? id` —, a mesma que
 * `getTransactionsByScope` usa no servidor. Isso importa porque a raiz tem
 * `parentId = null`: filtrar por `parentId` a deixaria de fora, que era
 * exatamente o defeito de `ALL` (afetava 2 de 3 e preservava a primeira
 * parcela).
 *
 * O cliente só projeta o que vai acontecer; a decisão continua sendo do
 * backend. Quando a lista carregada não contém a série inteira — filtro de mês
 * cortando parcelas futuras, por exemplo — isto é sinalizado em vez de
 * apresentar um número menor como se fosse o total.
 */

/** Id que identifica a série à qual a transação pertence. */
export function seriesRootId(tx: Transaction): string {
  return tx.parentId ?? tx.id
}

/** Quantas parcelas o título declara (`2/10` → 10), se declarar. */
export function declaredInstallmentCount(tx: Transaction): number | null {
  const match = tx.title.match(/\s\d+\/(\d+)$/)
  return match ? Number(match[1]) : null
}

/** Posição da parcela no título (`2/10` → 2), se houver. */
export function installmentPosition(tx: Transaction): number | null {
  const match = tx.title.match(/\s(\d+)\/\d+$/)
  return match ? Number(match[1]) : null
}

/** A transação pertence a um parcelamento, em qualquer posição. */
export function belongsToSeries(tx: Transaction): boolean {
  const declared = declaredInstallmentCount(tx)
  if (declared !== null) return declared > 1
  return Boolean(tx.parentId)
}

export interface SeriesSelection {
  /** Parcelas alcançadas pelo escopo, entre as que estão carregadas. */
  affected: Transaction[]
  /** Soma das parcelas alcançadas. */
  affectedTotal: number
  /** Total da série inteira, só quando ela está completa na lista. */
  seriesTotal: number | null
  /** Quantas parcelas a série tem, pelo título — a verdade preferida. */
  declaredCount: number | null
  /**
   * `true` quando a lista carregada não tem a série completa. Nesse caso os
   * números são um piso, não o total, e a interface precisa dizer isso.
   */
  partial: boolean
}

/**
 * Projeta o alcance de um escopo sobre a série carregada.
 *
 * `ONE` é a própria transação. `NEXT` é ela e as posteriores. `ALL` é a série
 * inteira, incluindo a primeira parcela — independente de onde a ação começou.
 */
export function selectSeries(
  transaction: Transaction,
  all: Transaction[],
  scope: InstallmentScope,
): SeriesSelection {
  const rootId = seriesRootId(transaction)
  const declaredCount = declaredInstallmentCount(transaction)

  const series = all
    .filter((tx) => seriesRootId(tx) === rootId)
    .sort((a, b) => {
      const posA = installmentPosition(a)
      const posB = installmentPosition(b)
      if (posA !== null && posB !== null) return posA - posB
      // Sem numeração, a raiz vem primeiro e o resto segue a data.
      if (a.id === rootId) return -1
      if (b.id === rootId) return 1
      return a.date.localeCompare(b.date)
    })

  // A transação em foco pode não estar em `all` (veio de outra tela); nesse
  // caso ela mesma é a única base confiável.
  const known = series.length > 0 ? series : [transaction]
  const partial = declaredCount !== null && known.length < declaredCount

  let affected: Transaction[]
  if (scope === InstallmentScope.ONE) {
    affected = [transaction]
  } else if (scope === InstallmentScope.ALL) {
    affected = known
  } else {
    const index = known.findIndex((tx) => tx.id === transaction.id)
    affected = index >= 0 ? known.slice(index) : [transaction]
  }

  const sum = (items: Transaction[]) =>
    items.reduce((total, tx) => total + tx.amount, 0)

  return {
    affected,
    affectedTotal: sum(affected),
    seriesTotal: partial ? null : sum(known),
    declaredCount,
    partial,
  }
}
