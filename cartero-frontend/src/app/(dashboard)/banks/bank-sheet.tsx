'use client'

import { useEffect } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
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
import type { Bank } from '@/types'

const schema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  invoiceCloseDate: z.preprocess(
    (v) => (v === '' || v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v)),
    z.number({ message: 'Dia obrigatório' }).int().min(1, 'Mínimo 1').max(31, 'Máximo 31'),
  ),
  invoiceDueDate: z.preprocess(
    (v) => (v === '' || v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v)),
    z.number({ message: 'Dia obrigatório' }).int().min(1, 'Mínimo 1').max(31, 'Máximo 31'),
  ),
})

export type BankFormData = z.infer<typeof schema>

interface BankSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTarget: Bank | null
  onSubmit: (data: BankFormData) => Promise<void>
}

export function BankSheet({ open, onOpenChange, editTarget, onSubmit }: BankSheetProps) {
  const isEditing = editTarget !== null

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BankFormData>({
    resolver: zodResolver(schema) as unknown as Resolver<BankFormData>,
  })

  useEffect(() => {
    if (open) {
      if (editTarget) {
        reset({
          name: editTarget.name,
          invoiceCloseDate: editTarget.invoiceCloseDate,
          invoiceDueDate: editTarget.invoiceDueDate,
        })
      } else {
        reset({ name: '', invoiceCloseDate: undefined, invoiceDueDate: undefined })
      }
    }
  }, [open, editTarget, reset])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{isEditing ? 'Editar banco' : 'Novo banco'}</SheetTitle>
          <SheetDescription>
            {isEditing ? 'Atualize os dados do banco.' : 'Preencha os dados para registrar um novo banco.'}
          </SheetDescription>
        </SheetHeader>

        <form
          id="bank-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="bank-name">Nome</Label>
            <Input
              id="bank-name"
              placeholder="Ex: Nubank, Itaú, Bradesco..."
              aria-invalid={!!errors.name}
              {...register('name')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          {/* Invoice close date */}
          <div className="space-y-1.5">
            <Label htmlFor="invoice-close-date">Dia de fechamento da fatura</Label>
            <Input
              id="invoice-close-date"
              type="number"
              min={1}
              max={31}
              placeholder="Ex: 15"
              aria-invalid={!!errors.invoiceCloseDate}
              {...register('invoiceCloseDate', { valueAsNumber: true })}
            />
            {errors.invoiceCloseDate && (
              <p className="text-xs text-destructive">{errors.invoiceCloseDate.message}</p>
            )}
          </div>

          {/* Invoice due date */}
          <div className="space-y-1.5">
            <Label htmlFor="invoice-due-date">Dia de vencimento da fatura</Label>
            <Input
              id="invoice-due-date"
              type="number"
              min={1}
              max={31}
              placeholder="Ex: 20"
              aria-invalid={!!errors.invoiceDueDate}
              {...register('invoiceDueDate', { valueAsNumber: true })}
            />
            {errors.invoiceDueDate && (
              <p className="text-xs text-destructive">{errors.invoiceDueDate.message}</p>
            )}
          </div>
        </form>

        <SheetFooter className="px-6 pb-6 pt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="bank-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isEditing ? 'Salvar alterações' : 'Criar banco'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
