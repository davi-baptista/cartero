import { TransactionType, type Transaction } from '@/types'

export type TransactionPersonContext = {
  direction: 'in' | 'out'
  personName: string
  label: 'recebido de' | 'pago para'
}

type BudgetPersonContextSource = {
  direction: 'in' | 'out'
  personName: string | null | undefined
}

/** Resolve linked settlement person context and normalize its direction/copy. */
export function transactionPersonContext(
  source: Transaction | BudgetPersonContextSource,
): TransactionPersonContext | null {
  if ('type' in source) {
    const direction = source.type === TransactionType.INCOME ? 'in' : 'out'
    const personName = direction === 'in'
      ? source.paymentReceivable?.person?.name
      : source.paymentDebt?.person?.name
    return personName
      ? { direction, personName, label: direction === 'in' ? 'recebido de' : 'pago para' }
      : null
  }

  return source.personName
    ? {
        direction: source.direction,
        personName: source.personName,
        label: source.direction === 'in' ? 'recebido de' : 'pago para',
      }
    : null
}
