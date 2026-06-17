'use client'

import { useEffect } from 'react'
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { resolveCategoryIcon } from '@/lib/category-icons'
import type { Transaction, Bank, Category, InstallmentScope } from '@/types'
import { TransactionType } from '@/types'

const transactionTypeValues = [
  TransactionType.INCOME,
  TransactionType.CREDIT_CARD,
  TransactionType.DEBIT_CARD,
  TransactionType.PIX,
  TransactionType.BOLETO,
] as const

const schema = z
  .object({
    bankId: z.string().min(1, 'Selecione um banco'),
    categoryId: z.string().min(1, 'Selecione uma categoria'),
    type: z.enum(transactionTypeValues),
    title: z.string().min(1, 'Título obrigatório'),
    amount: z.number({ message: 'Valor inválido' }).positive('Valor deve ser positivo'),
    date: z.string().min(1, 'Data obrigatória'),
    description: z.string().optional(),
    installments: z.preprocess(
      (v) => (v === '' || v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v)),
      z.number().int().min(2).max(36).optional(),
    ),
  })
  .refine(
    (d) => d.type !== TransactionType.CREDIT_CARD || !d.installments || d.installments >= 2,
    { message: 'Mínimo 2 parcelas', path: ['installments'] },
  )

export type TransactionFormData = z.infer<typeof schema>

interface TransactionSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTarget: Transaction | null
  editScope: InstallmentScope | null
  banks: Bank[]
  categories: Category[]
  onSubmit: (data: TransactionFormData, scope: InstallmentScope | null) => Promise<void>
}

export function TransactionSheet({
  open,
  onOpenChange,
  editTarget,
  editScope,
  banks,
  categories,
  onSubmit,
}: TransactionSheetProps) {
  const isEditing = editTarget !== null

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TransactionFormData>({
    resolver: zodResolver(schema) as unknown as Resolver<TransactionFormData>,
    defaultValues: { bankId: '', categoryId: '', type: TransactionType.PIX, title: '', amount: 0, date: '', description: '', installments: undefined },
  })

  const selectedType = useWatch({ control, name: 'type' })

  useEffect(() => {
    if (open) {
      if (editTarget) {
        reset({
          bankId: editTarget.bankId,
          categoryId: editTarget.categoryId,
          type: editTarget.type,
          title: editTarget.title,
          amount: editTarget.amount,
          date: editTarget.date,
          description: editTarget.description ?? '',
        })
      } else {
        reset({
          bankId: '',
          categoryId: '',
          type: TransactionType.PIX,
          title: '',
          amount: 0,
          date: new Date().toISOString().slice(0, 10),
          description: '',
          installments: undefined,
        })
      }
    }
  }, [open, editTarget, reset])

  async function handleFormSubmit(data: TransactionFormData) {
    await onSubmit(data, editScope)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{isEditing ? 'Editar transação' : 'Nova transação'}</SheetTitle>
          <SheetDescription>
            {isEditing ? 'Atualize os dados da transação.' : 'Preencha os dados para registrar uma nova transação.'}
          </SheetDescription>
        </SheetHeader>

        <form
          id="transaction-form"
          onSubmit={handleSubmit(handleFormSubmit)}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          {/* Type */}
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full" aria-invalid={!!errors.type}>
                    <span data-slot="select-value" className="flex flex-1 items-center text-left text-sm">
                      {field.value
                        ? TRANSACTION_TYPE_LABELS[field.value as TransactionType]
                        : <span className="text-muted-foreground">Selecione o tipo</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent side="bottom" alignItemWithTrigger={false}>
                    {Object.values(TransactionType).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TRANSACTION_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.type && <p className="text-xs text-destructive">{errors.type.message}</p>}
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              placeholder="Ex: Mercado, Netflix..."
              aria-invalid={!!errors.title}
              {...register('title')}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="amount">Valor (R$)</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0,00"
              aria-invalid={!!errors.amount}
              {...register('amount', { valueAsNumber: true })}
            />
            {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <Label>Data</Label>
            <Controller
              control={control}
              name="date"
              render={({ field }) => (
                <DatePicker
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Selecionar data"
                />
              )}
            />
            {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
          </div>

          {/* Bank */}
          <div className="space-y-1.5">
            <Label>Banco</Label>
            <Controller
              control={control}
              name="bankId"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full" aria-invalid={!!errors.bankId}>
                    <span data-slot="select-value" className="flex flex-1 items-center text-left text-sm">
                      {field.value
                        ? (banks.find((b) => b.id === field.value)?.name ?? field.value)
                        : <span className="text-muted-foreground">Selecione o banco</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent side="bottom" alignItemWithTrigger={false}>
                    {banks.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.bankId && <p className="text-xs text-destructive">{errors.bankId.message}</p>}
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full" aria-invalid={!!errors.categoryId}>
                    <span data-slot="select-value" className="flex flex-1 items-center gap-1.5 text-left text-sm">
                      {field.value ? (() => {
                        const cat = categories.find((c) => c.id === field.value)
                        if (!cat) return <span className="text-muted-foreground">Selecione a categoria</span>
                        const { Icon: CatIcon } = resolveCategoryIcon(cat.icon)
                        return (
                          <>
                            <CatIcon
                              className="size-3.5 shrink-0"
                              style={cat.color ? { color: cat.color } : undefined}
                            />
                            {cat.name}
                          </>
                        )
                      })() : <span className="text-muted-foreground">Selecione a categoria</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent side="bottom" alignItemWithTrigger={false}>
                    {categories.map((c) => {
                      const { Icon: CatIcon } = resolveCategoryIcon(c.icon)
                      return (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            <CatIcon
                              className="size-3.5 shrink-0"
                              style={c.color ? { color: c.color } : undefined}
                            />
                            {c.name}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.categoryId && <p className="text-xs text-destructive">{errors.categoryId.message}</p>}
          </div>

          {/* Installments — only for CREDIT_CARD + create */}
          {selectedType === TransactionType.CREDIT_CARD && !isEditing && (
            <div className="space-y-1.5">
              <Label htmlFor="installments">Parcelas (opcional)</Label>
              <Input
                id="installments"
                type="number"
                min={2}
                max={36}
                placeholder="Deixe em branco para à vista"
                aria-invalid={!!errors.installments}
                {...register('installments')}
              />
              {errors.installments && (
                <p className="text-xs text-destructive">{errors.installments.message}</p>
              )}
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description">Descrição (opcional)</Label>
            <Input
              id="description"
              placeholder="Anotação livre..."
              {...register('description')}
            />
          </div>
        </form>

        <SheetFooter className="px-6 pb-6 pt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="transaction-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isEditing ? 'Salvar alterações' : 'Criar transação'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
