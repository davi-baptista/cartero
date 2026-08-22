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
