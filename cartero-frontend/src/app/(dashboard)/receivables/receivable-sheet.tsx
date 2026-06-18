'use client'

import { useEffect, useState } from 'react'
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getPersons } from '@/services/persons.service'
import { cn } from '@/lib/utils'
import type { Receivable, InstallmentScope } from '@/types'

const schema = z
  .object({
    debtorName: z.string().optional(),
    personId: z.string().optional(),
    title: z.string().min(1, 'Título obrigatório'),
    amount: z.number({ message: 'Valor inválido' }).positive('Valor deve ser positivo'),
    dueDate: z.string().min(1, 'Data de vencimento obrigatória'),
    description: z.string().optional(),
    installments: z.preprocess(
      (v) => (v === '' || v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v)),
      z.number().int().min(2).max(64).optional(),
    ),
  })
  .refine((d) => d.debtorName?.trim() || d.personId, {
    message: 'Informe o nome do devedor ou selecione uma pessoa',
    path: ['debtorName'],
  })

export type ReceivableFormData = z.infer<typeof schema>

type DebtorMode = 'person' | 'manual'

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
  const [debtorMode, setDebtorMode] = useState<DebtorMode>('manual')

  const { data: persons = [], isLoading: personsLoading } = useQuery({
    queryKey: ['persons'],
    queryFn: getPersons,
  })

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReceivableFormData>({
    resolver: zodResolver(schema) as unknown as Resolver<ReceivableFormData>,
    defaultValues: {
      debtorName: '',
      personId: undefined,
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
        const hasPerson = !!editTarget.personId
        setDebtorMode(hasPerson ? 'person' : 'manual')
        reset({
          debtorName: editTarget.debtorName,
          personId: editTarget.personId ?? undefined,
          title: editTarget.title,
          amount: editTarget.amount,
          dueDate: editTarget.dueDate,
          description: editTarget.description ?? '',
        })
      } else {
        setDebtorMode('manual')
        reset({
          debtorName: '',
          personId: undefined,
          title: '',
          amount: 0,
          dueDate: '',
          description: '',
          installments: undefined,
        })
      }
    }
  }, [open, editTarget, reset])

  function handleModeChange(mode: DebtorMode) {
    setDebtorMode(mode)
    if (mode === 'person') {
      setValue('debtorName', '')
    } else {
      setValue('personId', undefined)
    }
  }

  async function handleFormSubmit(data: ReceivableFormData) {
    await onSubmit(data, editScope)
  }

  const watchedPersonId = useWatch({ control, name: 'personId' })
  const selectedPerson = persons.find((p) => p.id === watchedPersonId)

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
          {/* Debtor field */}
          <div className="space-y-1.5">
            <Label>Devedor</Label>

            {/* Mode toggle */}
            <div className="flex gap-1">
              {(['manual', 'person'] as DebtorMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleModeChange(mode)}
                  className={cn(
                    'rounded-full border px-3 py-0.5 text-xs font-medium transition-colors',
                    debtorMode === mode
                      ? 'border-transparent bg-primary/15 text-primary'
                      : 'border-border bg-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
                  )}
                >
                  {mode === 'manual' ? 'Digitar nome' : 'Pessoa cadastrada'}
                </button>
              ))}
            </div>

            {/* Input based on mode */}
            {debtorMode === 'manual' ? (
              <Input
                id="debtorName"
                placeholder="Ex: Maria, Empresa Y..."
                aria-invalid={!!errors.debtorName}
                {...register('debtorName')}
              />
            ) : (
              <Controller
                control={control}
                name="personId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? ''}
                    onValueChange={(v) => field.onChange(v || undefined)}
                    disabled={personsLoading}
                  >
                    <SelectTrigger className="w-full" aria-label="Selecionar pessoa">
                      <SelectValue placeholder={personsLoading ? 'Carregando...' : 'Selecionar pessoa'}>
                        {selectedPerson?.name ?? (personsLoading ? 'Carregando...' : undefined)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {persons.length === 0 ? (
                        <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                          Nenhuma pessoa cadastrada
                        </div>
                      ) : (
                        persons.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                )}
              />
            )}

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
                max={64}
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
