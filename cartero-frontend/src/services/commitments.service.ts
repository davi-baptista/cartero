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
  /**
   * Assinaturas que realmente cobram neste mês financeiro.
   *
   * Antes era o mesmo valor repetido nos seis meses, ignorando `dayOfMonth`,
   * `startedAt`, pausa e a competência da fatura. Agora vem da projeção real.
   */
  subscriptions: number
  total: number
  /** Ocorrências suprimidas (fatura paga, banco arquivado) — não somam. */
  blocked: number
}

/**
 * Próxima cobrança concreta de uma assinatura.
 *
 * `chargeDate` é a data REAL, com clamp de mês curto aplicado — a tela mostrava
 * só a regra ("todo dia 31"), que fevereiro não tem.
 */
export interface SubscriptionOccurrence {
  subscriptionId: string
  amount: number
  chargeDate: string
  /** Mês em que o valor sai do bolso: a fatura, no crédito. */
  financialPeriod: { year: number; month: number }
  invoiceStatus: 'OPEN' | 'CLOSED' | 'OVERDUE' | 'PAID' | null
  /** Preenchido quando a geração real não vai criar este lançamento. */
  blocked: 'invoice-paid' | 'bank-archived' | null
}

export interface Commitments {
  installments: ActiveInstallment[]
  /** Compras parceladas feitas em nome de outra pessoa. */
  othersInstallments: ActiveInstallment[]
  subscriptions: Subscription[]
  /** Próxima ocorrência de cada assinatura ativa, calculada pelo backend. */
  subscriptionOccurrences: SubscriptionOccurrence[]
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
