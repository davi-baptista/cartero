'use client'

import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Palette, Tag, X, ChevronDown } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { CATEGORY_ICON_GROUPS, CATEGORY_ICON_MAP, DEFAULT_CATEGORY_ICON } from '@/lib/category-icons'
import type { Category } from '@/types'

// ─── Icon Picker ──────────────────────────────────────────────────────────────

function IconPicker({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)

  const allIcons = CATEGORY_ICON_GROUPS.flatMap((g) => g.icons)
  const selectedDef = value ? allIcons.find((i) => i.name === value) : undefined
  const SelectedIcon = selectedDef ? CATEGORY_ICON_MAP[selectedDef.name] : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'w-full justify-start gap-2 font-normal',
          !value && 'text-muted-foreground',
        )}
      >
        {SelectedIcon ? (
          <SelectedIcon className="size-4 shrink-0" />
        ) : (
          <Tag className="size-4 shrink-0" />
        )}
        <span className="flex-1 text-left">
          {selectedDef?.label ?? 'Selecionar ícone'}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onChange(undefined)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                onChange(undefined)
              }
            }}
            className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
            aria-label="Remover ícone"
          >
            <X className="size-3" />
          </span>
        )}
        {!value && <ChevronDown className="size-3.5 opacity-50" />}
      </PopoverTrigger>

      <PopoverContent align="start" side="bottom" sideOffset={4} className="w-64 p-2.5">
        <div className="flex max-h-64 flex-col gap-2.5 overflow-y-auto pr-0.5">
          {CATEGORY_ICON_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-0.5">
                {group.icons.map(({ name, Icon, label }) => (
                  <button
                    key={name}
                    type="button"
                    title={label}
                    onClick={() => {
                      onChange(name)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-md transition-colors',
                      value === name
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Schema & types ───────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  color: z.string().optional(),
  icon: z.string().optional(),
})

export type CategoryFormData = z.infer<typeof schema>

interface CategorySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTarget: Category | null
  onSubmit: (data: CategoryFormData) => Promise<void>
}

// ─── Sheet ────────────────────────────────────────────────────────────────────

export function CategorySheet({ open, onOpenChange, editTarget, onSubmit }: CategorySheetProps) {
  const isEditing = editTarget !== null

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CategoryFormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (open) {
      if (editTarget) {
        reset({
          name: editTarget.name,
          color: editTarget.color ?? '',
          icon: editTarget.icon ?? DEFAULT_CATEGORY_ICON,
        })
      } else {
        reset({ name: '', color: '', icon: DEFAULT_CATEGORY_ICON })
      }
    }
  }, [open, editTarget, reset])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{isEditing ? 'Editar categoria' : 'Nova categoria'}</SheetTitle>
          <SheetDescription>
            {isEditing
              ? 'Atualize os dados da categoria.'
              : 'Preencha os dados para criar uma nova categoria.'}
          </SheetDescription>
        </SheetHeader>

        <form
          id="category-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="category-name">Nome</Label>
            <Input
              id="category-name"
              placeholder="Ex: Alimentação, Transporte..."
              aria-invalid={!!errors.name}
              {...register('name')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          {/* Icon */}
          <div className="space-y-1.5">
            <Label>Ícone (opcional)</Label>
            <Controller
              control={control}
              name="icon"
              render={({ field }) => (
                <IconPicker value={field.value} onChange={field.onChange} />
              )}
            />
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label>Cor (opcional)</Label>
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <div className="flex items-center gap-2">
                  <label
                    className="relative flex size-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-input"
                    style={{ backgroundColor: field.value || undefined }}
                  >
                    {!field.value && <Palette className="size-4 text-muted-foreground" />}
                    <input
                      type="color"
                      value={field.value || '#818cf8'}
                      onChange={(e) => field.onChange(e.target.value)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                  <Input
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || '')}
                    placeholder="#818cf8"
                    className="font-mono"
                  />
                </div>
              )}
            />
          </div>
        </form>

        <SheetFooter className="px-6 pb-6 pt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="category-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isEditing ? 'Salvar alterações' : 'Criar categoria'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
