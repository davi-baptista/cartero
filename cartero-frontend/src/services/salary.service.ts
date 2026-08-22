import { api } from '@/lib/api'

/**
 * Renda mensal com histórico.
 *
 * `known: false` significa que não existe entrada aplicável ao mês — não que
 * a renda seja zero. Zero é um valor legítimo e vem com `known: true`.
 */
export interface ResolvedSalary {
  known: boolean
  amount: number | null
  effectiveFrom: { year: number; month: number } | null
}

export async function getSalary(
  year: number,
  month: number,
): Promise<ResolvedSalary> {
  const { data } = await api.get<ResolvedSalary>('/salary', {
    params: { year, month },
  })
  return data
}

/**
 * Define a renda a partir de uma competência.
 *
 * Idempotente: definir o mesmo mês duas vezes atualiza a entrada. Não afeta
 * competências posteriores já cadastradas.
 */
export async function upsertSalary(payload: {
  amount: number
  year: number
  month: number
}): Promise<{
  amount: number
  effectiveFrom: { year: number; month: number }
  currentSalary: ResolvedSalary
}> {
  const { data } = await api.put('/salary', payload)
  return data
}

/** Uma alteração salarial registrada. */
export interface SalaryHistoryEntry {
  id: string
  year: number
  month: number
  amount: number
}

/**
 * Histórico real, do mais recente para o mais antigo.
 *
 * Só entradas cadastradas. Meses herdados não aparecem — eles não existem
 * como registro, e listá-los sugeriria que cada mês tem valor próprio.
 */
export async function getSalaryHistory(): Promise<SalaryHistoryEntry[]> {
  const { data } = await api.get<SalaryHistoryEntry[]>('/salary/history')
  return data
}

/**
 * Corrige o valor de uma competência JÁ cadastrada.
 *
 * Distinto de `upsertSalary`: aqui a competência não existe é erro (404), não
 * convite a criar. Corrigir um mês errado não pode inventar outro.
 */
export async function updateSalaryAmount(payload: {
  year: number
  month: number
  amount: number
}): Promise<{
  year: number
  month: number
  amount: number
  currentSalary: ResolvedSalary
}> {
  const { data } = await api.patch(
    `/salary/${payload.year}/${payload.month}`,
    { amount: payload.amount },
  )
  return data
}
