import { api } from '@/lib/api'
import type { User } from '@/types'

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>('/users/me')
  return data
}

export async function updateMe(payload: {
  name?: string
  salary?: number
  password?: string
  createIncomeOnReceivablePaid?: boolean
  createExpenseOnDebtPaid?: boolean
}): Promise<User> {
  const { data } = await api.patch<User>('/users/me', payload)
  return data
}
