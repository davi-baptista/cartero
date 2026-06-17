'use client'

import { useEffect } from 'react'
import { useForm, Controller, type Resolver } from 'react-hook-form'
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
import { DatePicker } from '@/components/ui/date-picker'
import type { Debt, InstallmentScope } from '@/types'

const schema = z.object({
  creditorName: z.string().min(1, 'Nome do credor obrigatório'),
  title: z.string().min(1, 'Título obrigatório'),
  amount: z.number({ message: 'Valor inválido' }).positive('Valor deve ser positivo'),
  dueDate: z.string().min(1, 'Data de vencimento obrigatória'),
  description: z.string().optional(),
  isAlertEnabled: z.boolean().optional(),
  installments: z.preprocess(
    (v) => (v === '' || v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v)),
    z.number().int().min(2).max(36).optional(),
  ),
})

export type DebtFormData = z.infer<typeof schema>

interface DebtSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTarget: Debt | null
  editScope: InstallmentScope | null
  onSubmit: (data: DebtFormData, scope: InstallmentScope | null) => Promise<void>
}

export function DebtSheet({ open, onOpenChange, editTarget, editScope, onSubmit }: DebtSheetProps) {
  const isEditing = editTarget !== null

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DebtFormData>({
    resolver: zodResolver(schema) as unknown as Resolver<DebtFormData>,
    defaultValues: {
      creditorName: '',
      title: '',
      amount: 0,
      dueDate: '',
      description: '',
      isAlertEnabled: true,
      installments: undefined,
    },
  })

  useEffect(() => {
    if (open) {
      if (editTarget) {
        reset({
          creditorName: editTarget.creditorName,
          title: editTarget.title,
          amount: editTarget.amount,
          dueDate: editTarget.dueDate,
          description: editTarget.description ?? '',
          isAlertEnabled: editTarget.isAlertEnabled,
        })
      } else {
        reset({
          creditorName: '',
          title: '',
          amount: 0,
          dueDate: '',
          description: '',
          isAlertEnabled: true,
          installments: undefined,
        })
      }
    }
  }, [open, editTarget, reset])

  async function handleFormSubmit(data: DebtFormData) {
    await onSubmit(data, editScope)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{isEditing ? 'Editar dívida' : 'Nova dívida'}</SheetTitle>
          <SheetDescription>
            {isEditing
              ? 'Atualize os dados da dívida.'
              : 'Preencha os dados para registrar uma nova dívida externa.'}
          </SheetDescription>
        </SheetHeader>

        <form
          id="debt-form"
          onSubmit={handleSubmit(handleFormSubmit)}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          {/* Creditor name */}
          <div className="space-y-1.5">
            <Label htmlFor="creditorName">Nome do credor</Label>
            <Input
              id="creditorName"
              placeholder="Ex: João, Banco X..."
              aria-invalid={!!errors.creditorName}
              {...register('creditorName')}
            />
            {errors.creditorName && (
              <p className="text-xs text-destructive">{errors.creditorName.message}</p>
            )}
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              placeholder="Ex: Empréstimo notebook..."
              aria-invalid={!!errors.title}
              {...register('title')}
            />
            {errors.title && (
              <p className="text-xs text-destructive">{errors.title.message}</p>
            )}
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
            {errors.amount && (
              <p className="text-xs text-destructive">{errors.amount.message}</p>
            )}
          </div>

          {/* Due date */}
          <div className="space-y-1.5">
            <Label>Vencimento</Label>
            <Controller
              control={control}
              name="dueDate"
              render={({ field }) => (
                <DatePicker
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Selecionar data"
                />
              )}
            />
            {errors.dueDate && (
              <p className="text-xs text-destructive">{errors.dueDate.message}</p>
            )}
          </div>

          {/* Installments — create only */}
          {!isEditing && (
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

          {/* Alert enabled */}
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Alerta de vencimento</Label>
              <p className="text-xs text-muted-foreground">
                Exibir alerta no dia do vencimento
              </p>
            </div>
            <Controller
              control={control}
              name="isAlertEnabled"
              render={({ field }) => (
                <button
                  type="button"
                  role="switch"
                  aria-checked={field.value}
                  onClick={() => field.onChange(!field.value)}
                  className={[
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
                    field.value ? 'bg-primary' : 'bg-muted',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'pointer-events-none inline-block size-4 rounded-full bg-white shadow-lg transition-transform',
                      field.value ? 'translate-x-4' : 'translate-x-0',
                    ].join(' ')}
                  />
                </button>
              )}
            />
          </div>
        </form>

        <SheetFooter className="px-6 pb-6 pt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="debt-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isEditing ? 'Salvar alterações' : 'Criar dívida'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
