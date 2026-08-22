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

const numberField = (message: string) => z.preprocess(
  (v) => (v === '' || v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v)),
  z.number({ message }).int().min(1, 'Mínimo 1').max(31, 'Máximo 31'),
)

const schema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  invoiceDueDate: numberField('Dia obrigatório'),
  invoiceDueDaysAfterClose: numberField('Informe quantos dias antes a fatura fecha'),
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
          invoiceDueDate: editTarget.invoiceDueDate,
          invoiceDueDaysAfterClose: editTarget.invoiceDueDaysAfterClose ?? 7,
        })
      } else {
        reset({ name: '', invoiceDueDate: undefined, invoiceDueDaysAfterClose: 7 })
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

          <div className="space-y-1.5">
            <Label htmlFor="invoice-due-date">Dia de vencimento da fatura</Label>
            <Input
              id="invoice-due-date"
              type="number"
              min={1}
              max={31}
              placeholder="Ex: 6"
              aria-invalid={!!errors.invoiceDueDate}
              {...register('invoiceDueDate', { valueAsNumber: true })}
            />
            {errors.invoiceDueDate && (
              <p className="text-xs text-destructive">{errors.invoiceDueDate.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invoice-due-days-after-close">A fatura fecha quantos dias antes?</Label>
            <Input
              id="invoice-due-days-after-close"
              type="number"
              min={1}
              max={31}
              placeholder="Ex: 7"
              aria-invalid={!!errors.invoiceDueDaysAfterClose}
              {...register('invoiceDueDaysAfterClose', { valueAsNumber: true })}
            />
            <p className="text-xs text-muted-foreground">
              Normalmente são alguns dias antes do vencimento. O Cartero calcula a data exata de cada fatura.
            </p>
            {errors.invoiceDueDaysAfterClose && (
              <p className="text-xs text-destructive">{errors.invoiceDueDaysAfterClose.message}</p>
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
