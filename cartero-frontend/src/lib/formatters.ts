import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { TransactionType } from '@/types'
import { parseDateOnly } from '@/lib/date'

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

export function formatDate(dateString: string): string {
  return format(parseDateOnly(dateString), 'dd/MM/yyyy', { locale: ptBR })
}

export function formatMonthYear(month: number, year: number): string {
  const date = new Date(year, month - 1, 1)
  return format(date, 'MMMM yyyy', { locale: ptBR })
}

export function formatRelativeDate(dateString: string): string {
  return format(parseDateOnly(dateString), "dd 'de' MMMM", { locale: ptBR })
}

export function isExpense(type: TransactionType): boolean {
  return type !== TransactionType.INCOME
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  [TransactionType.INCOME]: 'Receita',
  [TransactionType.CREDIT_CARD]: 'Crédito',
  [TransactionType.DEBIT_CARD]: 'Débito',
  [TransactionType.PIX]: 'PIX',
  [TransactionType.BOLETO]: 'Boleto',
}
