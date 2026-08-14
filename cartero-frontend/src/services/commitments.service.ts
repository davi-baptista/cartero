import { api } from '@/lib/api'
import type { Subscription } from '@/types'

export interface ActiveInstallment {
  id: string
  title: string
  installmentAmount: number
  paidCount: number
  totalCount: number
  remaining: number
  endsAt: { month: number; year: number } | null
  bankName: string | null
  categoryName: string | null
  /** Preenchido quando a compra foi feita em nome de outra pessoa. */
  personName: string | null
}

export interface ForecastMonth {
  month: number
  year: number
  installments: number
  subscriptions: number
  total: number
}

export interface Commitments {
  installments: ActiveInstallment[]
  /** Compras parceladas feitas em nome de outra pessoa. */
  othersInstallments: ActiveInstallment[]
  subscriptions: Subscription[]
  totals: {
    installmentsRemaining: number
    othersRemaining: number
    monthlySubscriptions: number
  }
  forecast: ForecastMonth[]
}

export async function getCommitments(): Promise<Commitments> {
  const { data } = await api.get<Commitments>('/commitments')
  return data
}
