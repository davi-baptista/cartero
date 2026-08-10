import { api } from '@/lib/api'
import type { Person, PersonStatement, TransactionType } from '@/types'

export async function getPersons(): Promise<Person[]> {
  const { data } = await api.get<Person[]>('/persons')
  return data
}

export async function createPerson(payload: { name: string; phone?: string }): Promise<Person> {
  const { data } = await api.post<Person>('/persons', payload)
  return data
}

export async function updatePerson(id: string, payload: { name: string; phone?: string | null }): Promise<Person> {
  const { data } = await api.patch<Person>(`/persons/${id}`, payload)
  return data
}

export async function deletePerson(id: string): Promise<void> {
  await api.delete(`/persons/${id}`)
}

export async function getPersonStatement(
  id: string,
  filters?: { startDate?: string; endDate?: string },
): Promise<PersonStatement> {
  const { data } = await api.get<PersonStatement>(`/persons/${id}/statement`, {
    params: filters,
  })
  return data
}

export async function settlePerson(
  id: string,
  payload: {
    startDate?: string
    endDate?: string
    paymentDate?: string
    paymentBankId?: string
    paymentType?: TransactionType
  } = {},
): Promise<{ netBalance: number; settledDebts: number; settledReceivables: number }> {
  const { data } = await api.post(`/persons/${id}/settle`, payload)
  return data
}
