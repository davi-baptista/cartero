'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Tags, MoreVertical, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { MotionRow } from '@/components/ui/motion-row'
import { CategorySheet, type CategoryFormData } from './category-sheet'
import { getCategories, createCategory, updateCategory, deleteCategory } from '@/services/categories.service'
import { apiErrorMessage } from '@/lib/api-error'
import { resolveCategoryIcon } from '@/lib/category-icons'
import type { Category } from '@/types'

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryRow({
  category,
  onEdit,
  onDelete,
}: {
  category: Category
  onEdit: (c: Category) => void
  onDelete: (c: Category) => void
}) {
  const { Icon } = resolveCategoryIcon(category.icon)

  return (
    <div className="group flex items-center gap-3 px-1 py-3">
      {/* Icon container */}
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-lg"
        style={
          category.color
            ? { backgroundColor: `${category.color}28` }
            : { backgroundColor: 'var(--muted)' }
        }
      >
        <Icon
          aria-hidden="true"
          className="size-4"
          style={category.color ? { color: category.color } : { color: 'var(--muted-foreground)' }}
        />
      </div>

      {/* Name */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {category.name}
        </span>
        {category.isSystem && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Sistema
          </span>
        )}
      </div>

      {category.isSystem ? null : (
        <>
          {/* Desktop hover actions */}
          <div className="hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(category)}
              aria-label="Editar categoria"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(category)}
              aria-label="Excluir categoria"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>

          {/* Mobile dropdown */}
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Mais opções"
              >
                <MoreVertical className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(category)}>
                  <Pencil className="size-3.5" />
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDelete(category)} className="text-destructive focus:text-destructive">
                  <Trash2 className="size-3.5" />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      )}
    </div>
  )
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-1 py-3 last:border-b-0">
      <Skeleton className="size-8 rounded-lg" />
      <div className="flex flex-1 items-center gap-3">
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CategoriesPage() {
  const qc = useQueryClient()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editCategory, setEditCategory] = useState<Category | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [showSystem, setShowSystem] = useState(false)

  const {
    data: categories,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  })

  const ownCategories = (categories ?? []).filter((c) => !c.isSystem)
  const systemCategories = (categories ?? []).filter((c) => c.isSystem)

  const createMut = useMutation({
    mutationFn: (data: CategoryFormData) =>
      createCategory({
        name: data.name,
        color: data.color || undefined,
        icon: data.icon || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      setSheetOpen(false)
      toast.success('Categoria criada')
    },
    onError: () => toast.error('Erro ao criar categoria'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CategoryFormData }) =>
      updateCategory(id, {
        name: data.name,
        color: data.color || undefined,
        icon: data.icon || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      setSheetOpen(false)
      setEditCategory(null)
      toast.success('Categoria atualizada')
    },
    onError: () => toast.error('Erro ao atualizar categoria'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      toast.success('Categoria excluída')
      setDeleteTarget(null)
    },
    // Categoria em uso volta com CATEGORY_IN_USE e uma mensagem que já diz
    // quantas transações a impedem — repassá-la é mais útil que "Erro ao
    // excluir". O diálogo continua aberto para o usuário ler o motivo.
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao excluir categoria')),
  })

  async function handleSheetSubmit(data: CategoryFormData) {
    if (editCategory) {
      await updateMut.mutateAsync({ id: editCategory.id, data })
    } else {
      await createMut.mutateAsync(data)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categorias</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Organize seus gastos por categoria
          </p>
        </div>
        <Button
          onClick={() => {
            setEditCategory(null)
            setSheetOpen(true)
          }}
        >
          <Plus className="size-4" />
          Nova categoria
        </Button>
      </div>

      {/* Category list */}
      <div className="border-t border-border">
        {/*
          Erro é estado próprio: sem isso a falha de API caía no ramo vazio e
          dizia "Nenhuma categoria cadastrada".
        */}
        {isError ? (
          <QueryError
            message="Não foi possível carregar as categorias"
            isFetching={isFetching}
            onRetry={() => void refetch()}
          />
        ) : isLoading ? (
          <div>
            {Array.from({ length: 6 }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : ownCategories.length === 0 && systemCategories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-muted/50">
              <Tags className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Nenhuma categoria cadastrada</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Crie a primeira categoria usando o botão &quot;Nova categoria&quot; acima.
            </p>
          </div>
        ) : (
          <div>
            {ownCategories.map((category, i) => (
              <MotionRow key={category.id} index={i}>
                <CategoryRow
                  category={category}
                  onEdit={(c) => { setEditCategory(c); setSheetOpen(true) }}
                  onDelete={setDeleteTarget}
                />
              </MotionRow>
            ))}

            {/* Categorias de sistema — criadas e mantidas pelo app, sem
                edição possível. Ficam recolhidas para não competir com as
                suas na leitura. */}
            {systemCategories.length > 0 && (
              <div className="mt-2 border-t border-border/60 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSystem((v) => !v)}
                  aria-expanded={showSystem}
                  className="flex items-center gap-1.5 py-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronDown
                    className={cn(
                      'size-3.5 shrink-0 transition-transform duration-200',
                      showSystem && 'rotate-180',
                    )}
                    aria-hidden
                  />
                  {systemCategories.length} categoria
                  {systemCategories.length > 1 ? 's' : ''} do sistema
                </button>

                {showSystem &&
                  systemCategories.map((category, i) => (
                    <MotionRow key={category.id} index={i}>
                      <CategoryRow
                        category={category}
                        onEdit={(c) => { setEditCategory(c); setSheetOpen(true) }}
                        onDelete={setDeleteTarget}
                      />
                    </MotionRow>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sheet */}
      <CategorySheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setEditCategory(null)
        }}
        editTarget={editCategory}
        onSubmit={handleSheetSubmit}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Excluir categoria"
        description={
          <>
            Tem certeza que deseja excluir{' '}
            <strong className="text-foreground">{deleteTarget?.name}</strong>? Esta
            ação não pode ser desfeita.
          </>
        }
        isPending={deleteMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          // O diálogo fica aberto até a resposta: uma categoria em uso é
          // recusada, e o motivo precisa aparecer aqui, não numa tela vazia.
          if (deleteTarget) deleteMut.mutate(deleteTarget.id)
        }}
      />
    </div>
  )
}
