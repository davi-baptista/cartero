import type { Invoice } from '@/types'

/** Return cached/detail data only when it belongs to the invoice being shown. */
export function invoiceForDetailId(
  invoice: Invoice | undefined,
  invoiceId: string | null,
): Invoice | undefined {
  return invoice?.id === invoiceId ? invoice : undefined
}
