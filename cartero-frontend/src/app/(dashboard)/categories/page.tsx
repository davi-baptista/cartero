'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Tags, MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { MotionRow } from '@/components/ui/motion-row'
import { CategorySheet, type CategoryFormData } from './category-sheet'
import { getCategories, createCategory, updateCategory, deleteCategory } from '@/services/categories.service'
import { resolveCategoryIcon } from '@/lib/category-icons'
import { cn } from '@/lib/utils'
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
      <div className="flex min-w-0 flex-1 items-center">
        <span className="min-w-0 truncate text-sm font-medium">
          {category.name}
        </span>
      </div>

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

  const { data: categories, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  })

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
    },
    onError: () => toast.error('Erro ao excluir categoria'),
  })

  async function handleSheetSubmit(data: CategoryFormData) {
    if (editCategory) {
      updateMut.mutate({ id: editCategory.id, data })
    } else {
      createMut.mutate(data)
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
        {isLoading ? (
          <div>
            {Array.from({ length: 6 }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : !categories || categories.length === 0 ? (
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
            {categories.map((category, i) => (
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
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir categoria</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir{' '}
              <strong className="text-foreground">{deleteTarget?.name}</strong>? Esta ação não pode
              ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteMut.mutate(deleteTarget.id)
                  setDeleteTarget(null)
                }
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
