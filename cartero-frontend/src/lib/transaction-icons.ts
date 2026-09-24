import type { LucideIcon } from 'lucide-react'
import { CreditCard, FileText, Receipt, TrendingUp, Wallet } from 'lucide-react'
import { TransactionType } from '@/types'

/** The canonical transaction icon mapping used by the Extrato. */
export const TRANSACTION_TYPE_ICONS: Record<TransactionType, LucideIcon> = {
  [TransactionType.INCOME]: TrendingUp,
  [TransactionType.INVOICE_PAYMENT]: Receipt,
  [TransactionType.CREDIT_CARD]: CreditCard,
  [TransactionType.DEBIT_CARD]: Wallet,
  [TransactionType.PIX]: Receipt,
  [TransactionType.BOLETO]: FileText,
}

export const TRANSACTION_INCOME_ICON_BG = 'var(--color-income-bg)'
export const TRANSACTION_EXPENSE_ICON_BG = 'var(--color-expense-bg)'
export const TRANSACTION_INCOME_ICON_COLOR = 'var(--color-income)'
export const TRANSACTION_EXPENSE_ICON_COLOR = 'var(--color-expense-icon)'

/** Keeps unknown or absent display-only types on the Extrato's receipt fallback. */
export function transactionIconForType(type: string | null | undefined): LucideIcon {
  return TRANSACTION_TYPE_ICONS[type as TransactionType] ?? Receipt
}
