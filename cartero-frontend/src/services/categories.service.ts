import { api } from '@/lib/api'
import type { Category } from '@/types'

export async function getCategories(): Promise<Category[]> {
  const { data } = await api.get<Category[]>('/categories')
  return data
}

export async function getCategory(id: string): Promise<Category> {
  const { data } = await api.get<Category>(`/categories/${id}`)
  return data
}

export async function createCategory(payload: {
  name: string
  color?: string
  icon?: string
}): Promise<Category> {
  const { data } = await api.post<Category>('/categories', payload)
  return data
}

export async function updateCategory(
  id: string,
  payload: Partial<{ name: string; color: string; icon: string }>,
): Promise<Category> {
  const { data } = await api.patch<Category>(`/categories/${id}`, payload)
  return data
}

export async function deleteCategory(id: string): Promise<void> {
  await api.delete(`/categories/${id}`)
}
