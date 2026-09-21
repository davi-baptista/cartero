import { api } from '@/lib/api'

export interface ActiveInstallment {
  id: string
  title: string
  totalCount: number
  futureCount: number
  remaining: number
  outstandingCount: number
  outstandingAmount: number
  endsAt: { month: number; year: number } | null
  nextInstallment: {
    id: string
    month: number
    year: number
    amount: number
    index: number
    status?: 'OPEN' | 'CLOSED' | 'PAID' | 'OVERDUE'
  } | null
  nextOutstanding: {
    id: string
    month: number
    year: number
    amount: number
    index: number
    status?: 'OPEN' | 'CLOSED' | 'PAID' | 'OVERDUE'
  } | null
  bankName: string | null
  categoryName: string | null
  personId: string | null
  personName: string | null
}

export interface ForecastMonth {
  month: number
  year: number
  installments: number
}

export interface Commitments {
  installments: ActiveInstallment[]
  othersInstallments: ActiveInstallment[]
  totals: {
    installmentsOutstanding: number
    othersRemaining: number
  }
  forecast: ForecastMonth[]
}

export async function getCommitments(): Promise<Commitments> {
  const { data } = await api.get<Commitments>('/commitments')
  return data
}
