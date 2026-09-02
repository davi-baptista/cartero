import { api } from '@/lib/api'
import type { NextSettlementItem } from '@/lib/person-next-item'
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

/**
 * Uma pessoa pelo id.
 *
 * Só para resolver o extrato quando ele chega pela URL — link direto ou
 * refresh — e a lista ainda não está em cache. O clique numa linha resolve
 * pela coleção já carregada, sem requisição.
 */
export async function getPerson(id: string): Promise<Person> {
  const { data } = await api.get<Person>(`/persons/${id}`)
  return data
}

/**
 * Saldo de cada contato na competência — em LOTE.
 *
 * Uma requisição para a lista inteira. Chamar o extrato por pessoa seria N+1
 * numa tela que existe justamente para não abrir pessoa por pessoa.
 *
 * O backend aplica os mesmos helpers do extrato (`belongsToCompetence` +
 * `buildPersonSummary`), então lista e drawer não têm como divergir.
 */
export interface PersonMonthlyBalance {
  id: string
  name: string
  /** Positivo: a pessoa te deve. Negativo: você deve a ela. */
  netBalance: number
  receivablePending: number
  debtPending: number
  /**
   * O acerto mais urgente do MESMO lado do saldo, ou `null`.
   *
   * Dado, não texto: `person-next-item` decide o verbo e a distância. Vem do
   * mesmo lote — nenhuma consulta por pessoa.
   */
  nextItem: NextSettlementItem | null
}

export async function getPersonsMonthlySummary(params: {
  month: number
  year: number
}): Promise<PersonMonthlyBalance[]> {
  const { data } = await api.get<PersonMonthlyBalance[]>(
    '/persons/monthly-summary',
    { params },
  )
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
