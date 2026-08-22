import { api } from '@/lib/api'
import type {
  Person,
  PersonStatement,
  PersonSummary,
  TransactionType,
} from '@/types'

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

/**
 * Quita todas as pendências abertas da pessoa.
 *
 * Sem `startDate`/`endDate`: o conjunto é definido pelo backend a partir do
 * que está aberto no momento da confirmação, não pelo mês visível na tela.
 */
export async function settlePerson(
  id: string,
  payload: {
    /*
      Competência do acerto. O backend RECONSULTA quais itens pertencem a ela —
      não enviamos lista de ids, para o escopo de uma operação financeira não
      ficar nas mãos do cliente.

      Sem competência o backend mantém o comportamento all-time.
    */
    year?: number
    month?: number
    paymentDate?: string
    paymentBankId?: string
    paymentType?: TransactionType
  } = {},
): Promise<{
  summary: PersonSummary
  settledDebts: number
  settledReceivables: number
  /** Quantos lançamentos foram de fato criados (respeita as preferências). */
  createdExpenses: number
  createdIncomes: number
}> {
  const { data } = await api.post(`/persons/${id}/settle`, payload)
  return data
}
