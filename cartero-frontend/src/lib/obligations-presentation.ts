import { formatCurrency } from '@/lib/formatters'

export function formatObligationSectionNet(value: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 'Indisponível'
  if (amount === 0) return formatCurrency(0)
  if (amount > 0) return `+${formatCurrency(amount)} a receber`
  return `−${formatCurrency(Math.abs(amount))} a pagar`
}

export function isZeroObligationAmount(value: string) {
  return /^[-+]?0+(?:\.0+)?$/.test(value.trim())
}
