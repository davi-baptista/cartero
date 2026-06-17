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
import type { Receivable, InstallmentScope } from '@/types'

const schema = z.object({
  debtorName: z.string().min(1, 'Nome do devedor obrigatório'),
  title: z.string().min(1, 'Título obrigatório'),
  amount: z.number({ message: 'Valor inválido' }).positive('Valor deve ser positivo'),
  dueDate: z.string().min(1, 'Data de vencimento obrigatória'),
  description: z.string().optional(),
  installments: z.preprocess(
    (v) => (v === '' || v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v)),
    z.number().int().min(2).max(36).optional(),
  ),
})

export type ReceivableFormData = z.infer<typeof schema>

interface ReceivableSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTarget: Receivable | null
  editScope: InstallmentScope | null
  onSubmit: (data: ReceivableFormData, scope: InstallmentScope | null) => Promise<void>
}

export function ReceivableSheet({
  open,
  onOpenChange,
  editTarget,
  editScope,
  onSubmit,
}: ReceivableSheetProps) {
  const isEditing = editTarget !== null

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ReceivableFormData>({
    resolver: zodResolver(schema) as unknown as Resolver<ReceivableFormData>,
    defaultValues: {
      debtorName: '',
      title: '',
      amount: 0,
      dueDate: '',
      description: '',
      installments: undefined,
    },
  })

  useEffect(() => {
    if (open) {
      if (editTarget) {
        reset({
          debtorName: editTarget.debtorName,
          title: editTarget.title,
          amount: editTarget.amount,
          dueDate: editTarget.dueDate,
          description: editTarget.description ?? '',
        })
      } else {
        reset({
          debtorName: '',
          title: '',
          amount: 0,
          dueDate: '',
          description: '',
          installments: undefined,
        })
      }
    }
  }, [open, editTarget, reset])

  async function handleFormSubmit(data: ReceivableFormData) {
    await onSubmit(data, editScope)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{isEditing ? 'Editar cobrança' : 'Nova cobrança'}</SheetTitle>
          <SheetDescription>
            {isEditing
              ? 'Atualize os dados da cobrança.'
              : 'Registre um valor que você tem a receber.'}
          </SheetDescription>
        </SheetHeader>

        <form
          id="receivable-form"
          onSubmit={handleSubmit(handleFormSubmit)}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          {/* Debtor name */}
          <div className="space-y-1.5">
            <Label htmlFor="debtorName">Nome do devedor</Label>
            <Input
              id="debtorName"
              placeholder="Ex: Maria, Empresa Y..."
              aria-invalid={!!errors.debtorName}
              {...register('debtorName')}
            />
            {errors.debtorName && (
              <p className="text-xs text-destructive">{errors.debtorName.message}</p>
            )}
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              placeholder="Ex: Venda parcelada..."
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
        </form>

        <SheetFooter className="px-6 pb-6 pt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="receivable-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isEditing ? 'Salvar alterações' : 'Criar cobrança'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
