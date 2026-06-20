'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, Loader2, Plus, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { createPerson, getPersons } from '@/services/persons.service'
import { cn } from '@/lib/utils'
import type { Debt, InstallmentScope } from '@/types'

const schema = z
  .object({
    creditorName: z.string().optional(),
    personId: z.string().optional(),
    title: z.string().min(1, 'Título obrigatório'),
    amount: z.number({ message: 'Valor inválido' }).positive('Valor deve ser positivo'),
    dueDate: z.string().min(1, 'Data de vencimento obrigatória'),
    description: z.string().optional(),
    isAlertEnabled: z.boolean().optional(),
    installments: z.preprocess(
      (v) => (v === '' || v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v)),
      z.number().int().min(2).max(64).optional(),
    ),
  })
  .refine((d) => d.creditorName?.trim() || d.personId, {
    message: 'Informe o nome do credor ou selecione uma pessoa',
    path: ['creditorName'],
  })

export type DebtFormData = z.infer<typeof schema>

type CreditorMode = 'person' | 'manual'

interface DebtSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTarget: Debt | null
  editScope: InstallmentScope | null
  onSubmit: (data: DebtFormData, scope: InstallmentScope | null) => Promise<void>
}

export function DebtSheet({ open, onOpenChange, editTarget, editScope, onSubmit }: DebtSheetProps) {
  const isEditing = editTarget !== null
  const [creditorMode, setCreditorMode] = useState<CreditorMode>('manual')
  const [showInlineCreate, setShowInlineCreate] = useState(false)
  const [newPersonName, setNewPersonName] = useState('')
  const inlineInputRef = useRef<HTMLInputElement>(null)

  const queryClient = useQueryClient()

  const { data: persons = [], isLoading: personsLoading } = useQuery({
    queryKey: ['persons'],
    queryFn: getPersons,
  })

  const createPersonMutation = useMutation({
    mutationFn: createPerson,
    onSuccess: (person) => {
      queryClient.invalidateQueries({ queryKey: ['persons'] })
      setValue('personId', person.id)
      setShowInlineCreate(false)
      setNewPersonName('')
    },
  })

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DebtFormData>({
    resolver: zodResolver(schema) as unknown as Resolver<DebtFormData>,
    defaultValues: {
      creditorName: '',
      personId: undefined,
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
        const hasPerson = !!editTarget.personId
        setCreditorMode(hasPerson ? 'person' : 'manual')
        reset({
          creditorName: editTarget.creditorName,
          personId: editTarget.personId ?? undefined,
          title: editTarget.title,
          amount: editTarget.amount,
          dueDate: editTarget.dueDate,
          description: editTarget.description ?? '',
          isAlertEnabled: editTarget.isAlertEnabled,
        })
      } else {
        setCreditorMode('manual')
        reset({
          creditorName: '',
          personId: undefined,
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

  function handleModeChange(mode: CreditorMode) {
    setCreditorMode(mode)
    setShowInlineCreate(false)
    setNewPersonName('')
    if (mode === 'person') {
      setValue('creditorName', '')
    } else {
      setValue('personId', undefined)
    }
  }

  function handleOpenInlineCreate() {
    setShowInlineCreate(true)
    setTimeout(() => inlineInputRef.current?.focus(), 0)
  }

  function handleCancelInlineCreate() {
    setShowInlineCreate(false)
    setNewPersonName('')
  }

  function handleConfirmInlineCreate() {
    const name = newPersonName.trim()
    if (!name) return
    createPersonMutation.mutate({ name })
  }

  async function handleFormSubmit(data: DebtFormData) {
    await onSubmit(data, editScope)
  }

  const watchedPersonId = useWatch({ control, name: 'personId' })
  const selectedPerson = persons.find((p) => p.id === watchedPersonId)

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
          {/* Creditor field */}
          <div className="space-y-1.5">
            <Label>Credor</Label>

            {/* Mode toggle */}
            <div className="flex gap-1">
              {(['manual', 'person'] as CreditorMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleModeChange(mode)}
                  className={cn(
                    'rounded-full border px-3 py-0.5 text-xs font-medium transition-colors',
                    creditorMode === mode
                      ? 'border-transparent bg-primary/15 text-primary'
                      : 'border-border bg-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
                  )}
                >
                  {mode === 'manual' ? 'Digitar nome' : 'Pessoa cadastrada'}
                </button>
              ))}
            </div>

            {/* Input based on mode */}
            {creditorMode === 'manual' ? (
              <Input
                id="creditorName"
                placeholder="Ex: João, Banco X..."
                aria-invalid={!!errors.creditorName}
                {...register('creditorName')}
              />
            ) : (
              <div className="space-y-2">
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

                {showInlineCreate ? (
                  <div className="flex gap-1.5">
                    <Input
                      ref={inlineInputRef}
                      value={newPersonName}
                      onChange={(e) => setNewPersonName(e.target.value)}
                      placeholder="Nome da pessoa"
                      className="h-8 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleConfirmInlineCreate() }
                        if (e.key === 'Escape') handleCancelInlineCreate()
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      disabled={!newPersonName.trim() || createPersonMutation.isPending}
                      onClick={handleConfirmInlineCreate}
                      aria-label="Confirmar"
                    >
                      {createPersonMutation.isPending
                        ? <Loader2 className="size-3.5 animate-spin" />
                        : <Check className="size-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={handleCancelInlineCreate}
                      aria-label="Cancelar"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleOpenInlineCreate}
                    className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Plus className="size-3" />
                    Nova pessoa
                  </button>
                )}
              </div>
            )}

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
