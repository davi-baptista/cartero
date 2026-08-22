'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, ArrowUpRight, Check, Loader2, Plus, X } from 'lucide-react'
import Link from 'next/link'
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
import { CurrencyInput } from '@/components/ui/currency-input'
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
import { formatDateValue } from '@/lib/date'
import type { Receivable, InstallmentScope } from '@/types'

const schema = z
  .object({
    debtorName: z.string().optional(),
    personId: z.string().optional(),
    title: z.string().min(1, 'Título obrigatório'),
    amount: z.number({ message: 'Valor inválido' }).positive('Valor deve ser positivo'),
    occurredAt: z.string().min(1, 'Data da transação obrigatória'),
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
  initialPersonId?: string
  onSubmit: (data: ReceivableFormData, scope: InstallmentScope | null) => Promise<void>
}

export function ReceivableSheet({
  open,
  onOpenChange,
  editTarget,
  editScope,
  initialPersonId,
  onSubmit,
}: ReceivableSheetProps) {
  const isEditing = editTarget !== null

  /**
   * Cobrança derivada de uma compra: os fatos financeiros vêm dela.
   *
   * O backend recusa alterá-los aqui (`AUTOMATIC_RECEIVABLE_MANAGED_BY_
   * TRANSACTION`); desabilitar os campos evita que o usuário digite algo que
   * será recusado no save.
   */
  const isAutomatic = Boolean(editTarget?.transactionId)

  /** Já recebida: os fatos financeiros estão comprovados por uma transação. */
  const isSettled = Boolean(editTarget?.isPaid)

  /** Bloqueia valor, contraparte e datas — não o texto. */
  const financialLocked = isAutomatic || isSettled

  /**
   * Link para a compra que originou a cobrança.
   *
   * `occurredAt` é a data do lançamento; filtrar o dia inteiro chega na
   * transação sem precisar de um parâmetro de deep-link que a página de
   * transações ainda não tem.
   */
  const purchaseHref = (() => {
    if (!isAutomatic) return null
    const day = editTarget?.occurredAt?.slice(0, 10)
    const transactionId = editTarget?.transactionId
    if (!day || !transactionId) return null

    /*
      A data posiciona o extrato no mês certo; o `highlight` encontra a linha.

      Só a data abria a página filtrada e deixava o usuário procurando — pior
      quando a compra é parcelada e a parcela está dentro de um grupo fechado.
    */
    return `/transactions?startDate=${day}&endDate=${day}&highlight=${transactionId}`
  })()
  const [debtorMode, setDebtorMode] = useState<DebtorMode>('manual')
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
  } = useForm<ReceivableFormData>({
    resolver: zodResolver(schema) as unknown as Resolver<ReceivableFormData>,
    defaultValues: {
      debtorName: '',
      personId: undefined,
      title: '',
      amount: 0,
      occurredAt: formatDateValue(),
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
          amount: Number(editTarget.amount),
          occurredAt: editTarget.occurredAt,
          dueDate: editTarget.dueDate,
          description: editTarget.description ?? '',
        })
      } else {
        setDebtorMode(initialPersonId ? 'person' : 'manual')
        reset({
          debtorName: '',
          personId: initialPersonId,
          title: '',
          amount: 0,
          occurredAt: formatDateValue(),
          dueDate: '',
          description: '',
          installments: undefined,
        })
      }
    }
  }, [open, editTarget, initialPersonId, reset])

  function handleModeChange(mode: DebtorMode) {
    setDebtorMode(mode)
    setShowInlineCreate(false)
    setNewPersonName('')
    if (mode === 'person') {
      setValue('debtorName', '')
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

        {/*
          Origem automática: a compra é a fonte de verdade.

          O texto anterior dizia que as alterações "não afetam a transação
          original" — verdade, mas omitia o essencial: elas eram DESCARTADAS
          na próxima edição da compra, sem aviso. Agora os campos financeiros
          são desabilitados e o texto aponta o caminho certo.
        */}
        {isAutomatic && (
          <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-pending/25 bg-pending/5 px-3 py-2.5">
            <AlertCircle
              className="mt-0.5 size-3.5 shrink-0 text-pending"
              aria-hidden
            />
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Gerada automaticamente por uma compra. Valor, pessoa e
                vencimento vêm dela — para corrigi-los, edite a compra de
                origem.
              </p>
              {/*
                Atalho para a compra.

                Dizer "edite a compra de origem" sem dar o caminho obrigava o
                usuário a procurar a transação à mão no extrato. O link filtra
                o dia do lançamento, que é o que a página de transações
                aceita por URL.
              */}
              {purchaseHref && (
                <Link
                  href={purchaseHref}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  Ver a compra
                  <ArrowUpRight className="size-3" aria-hidden />
                </Link>
              )}
            </div>
          </div>
        )}

        {/*
          Já recebida: fato concluído.
          Existe uma transação de recebimento com este valor; alterá-lo aqui
          deixaria as duas coisas divergentes para sempre.
        */}
        {isSettled && !isAutomatic && (
          <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-paid/25 bg-paid/5 px-3 py-2.5">
            <AlertCircle
              className="mt-0.5 size-3.5 shrink-0 text-paid"
              aria-hidden
            />
            <p className="text-xs text-muted-foreground">
              Cobrança já recebida. Para alterar valor, pessoa ou vencimento,
              desfaça o recebimento primeiro.
            </p>
          </div>
        )}

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
                  disabled={financialLocked}
                  aria-pressed={debtorMode === mode}
                  className={cn(
                    'rounded-full border px-3 py-0.5 text-xs font-medium transition-colors',
                    debtorMode === mode
                      ? 'border-transparent bg-primary/15 text-primary'
                      : 'border-border bg-transparent text-muted-foreground',
                    financialLocked
                      ? 'cursor-not-allowed opacity-50'
                      : debtorMode !== mode &&
                          'hover:border-muted-foreground/30 hover:text-foreground',
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
                disabled={financialLocked}
                {...register('debtorName')}
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
                      disabled={personsLoading || financialLocked}
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
              disabled={!!editTarget?.parentId}
              {...register('title')}
            />
            {editTarget?.parentId
              ? <p className="text-xs text-muted-foreground">O título não pode ser alterado em parcelas.</p>
              : errors.title && (
              <p className="text-xs text-destructive">{errors.title.message}</p>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="amount">Valor (R$)</Label>
            <Controller
              control={control}
              name="amount"
              render={({ field }) => (
                <CurrencyInput
                  id="amount"
                  value={field.value}
                  onChange={field.onChange}
                  aria-invalid={!!errors.amount}
                  disabled={financialLocked}
                />
              )}
            />
            {errors.amount && (
              <p className="text-xs text-destructive">{errors.amount.message}</p>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Data da transação</Label>
              <Controller
                control={control}
                name="occurredAt"
                render={({ field }) => (
                  <DatePicker
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Selecionar data"
                    disabled={financialLocked}
                  />
                )}
              />
              {errors.occurredAt && (
                <p className="text-xs text-destructive">{errors.occurredAt.message}</p>
              )}
            </div>

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
                    disabled={financialLocked || !!editTarget?.parentId}
                  />
                )}
              />
              {errors.dueDate && (
                <p className="text-xs text-destructive">{errors.dueDate.message}</p>
              )}
            </div>
          </div>
          {editTarget?.parentId ? (
            <p className="-mt-2 text-xs text-muted-foreground">
              A data da transação altera todas as parcelas; o vencimento não pode ser alterado em parcelas.
            </p>
          ) : (
            <p className="-mt-2 text-xs text-muted-foreground">
              Data da transação é quando ela aconteceu de fato, diferente do vencimento.
            </p>
          )}

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
