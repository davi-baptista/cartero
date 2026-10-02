import { api } from '@/lib/api'

export type ObligationSection = 'OVERDUE' | 'OPEN' | 'HISTORY'
export type ObligationDomain = 'ALL' | 'RECEIVABLE' | 'DEBT'

export interface ObligationRow {
  domain: Exclude<ObligationDomain, 'ALL'>
  id: string
  title: string
  amount: string
  description: string | null
  personId: string | null
  personName: string | null
  counterpartyName: string
  dueDate: string
  isResolved: boolean
  resolvedAt: string | null
  paymentTransactionId: string | null
}

export interface ObligationPage {
  items: ObligationRow[]
  pageInfo: { nextCursor: string | null; hasMore: boolean }
}

export interface ObligationSummary {
  overdue: { receivable: string; debt: string; net: string }
  open: { receivable: string; debt: string; net: string }
}

export interface ObligationFilters {
  section: ObligationSection
  domain: ObligationDomain
  month?: number
  year?: number
  search?: string
  personId?: string
  cursor?: string
  limit?: number
}

export async function getObligations(filters: ObligationFilters): Promise<ObligationPage> {
  const { data } = await api.get<ObligationPage>('/obligations', { params: filters })
  return data
}

export async function getObligationsSummary(filters: {
  month: number
  year: number
  domain: ObligationDomain
  personId?: string
}): Promise<ObligationSummary> {
  const { data } = await api.get<ObligationSummary>('/obligations/summary', { params: filters })
  return data
}
