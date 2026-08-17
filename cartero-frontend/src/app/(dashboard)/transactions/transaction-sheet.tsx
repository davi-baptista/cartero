'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, Loader2, Plus, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { formatDateValue } from '@/lib/date'
import { resolveCategoryIcon } from '@/lib/category-icons'
import { getBanks, createBank } from '@/services/banks.service'
import { getCategories, createCategory } from '@/services/categories.service'
import { getPersons, createPerson } from '@/services/persons.service'
import type { Transaction, InstallmentScope, Bank, Category, Person } from '@/types'
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
    isRefund: z.boolean().optional(),
    date: z.string().min(1, 'Data obrigatória'),
    description: z.string().optional(),
    installments: z.preprocess(
      (v) => (v === '' || v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v)),
      z.number().int().min(2).max(64).optional(),
    ),
    personId: z.string().optional(),
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
  onSubmit: (data: TransactionFormData, scope: InstallmentScope | null) => Promise<void>
  /**
   * Valores iniciais ao criar. Usado quando o contexto já determina parte do
   * lançamento — dentro de uma fatura, o banco e o tipo são conhecidos.
   */
  createDefaults?: {
    bankId?: string
    type?: TransactionType
    date?: string
  }
}

export function TransactionSheet({
  open,
  onOpenChange,
  editTarget,
  editScope,
  onSubmit,
  createDefaults,
}: TransactionSheetProps) {
  const isEditing = editTarget !== null
  const isInstallment = Boolean(editTarget?.parentId) || /\s\d+\/\d+$/.test(editTarget?.title ?? '')
  /** Gerado por assinatura: a categoria é da regra, não deste lançamento. */
  const isFromSubscription = Boolean(editTarget?.subscriptionId)
  const submittingRef = useRef(false)
  const qc = useQueryClient()

  // ── Queries ──
  const { data: banks = [] } = useQuery({ queryKey: ['banks'], queryFn: getBanks })
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const { data: persons = [] } = useQuery({ queryKey: ['persons'], queryFn: getPersons })

  // ── Inline bank create ──
  const [showBankCreate, setShowBankCreate] = useState(false)
  const [newBank, setNewBank] = useState({ name: '', dueDate: '', daysAfterClose: '7' })
  const bankNameRef = useRef<HTMLInputElement>(null)

  const createBankMut = useMutation({
    mutationFn: createBank,
    onSuccess: (bank) => {
      qc.setQueryData<Bank[]>(['banks'], (old) => [...(old ?? []), bank])
      qc.invalidateQueries({ queryKey: ['banks'] })
      setValue('bankId', bank.id)
      setShowBankCreate(false)
      setNewBank({ name: '', dueDate: '', daysAfterClose: '7' })
    },
    onError: () => toast.error('Não foi possível criar o banco.'),
  })

  function handleOpenBankCreate() {
    setShowBankCreate(true)
    setTimeout(() => bankNameRef.current?.focus(), 0)
  }

  function handleConfirmBankCreate() {
    const name = newBank.name.trim()
    const due = Number(newBank.dueDate)
    const daysAfterClose = Number(newBank.daysAfterClose)
    if (!name || !due || !daysAfterClose) return
    createBankMut.mutate({ name, invoiceDueDate: due, invoiceDueDaysAfterClose: daysAfterClose })
  }

  // ── Inline category create ──
  const [showCategoryCreate, setShowCategoryCreate] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const categoryNameRef = useRef<HTMLInputElement>(null)

  const createCategoryMut = useMutation({
    mutationFn: createCategory,
    onSuccess: (category) => {
      qc.setQueryData<Category[]>(['categories'], (old) => [...(old ?? []), category])
      qc.invalidateQueries({ queryKey: ['categories'] })
      setValue('categoryId', category.id)
      setShowCategoryCreate(false)
      setNewCategoryName('')
    },
    onError: () => toast.error('Não foi possível criar a categoria.'),
  })

  function handleOpenCategoryCreate() {
    setShowCategoryCreate(true)
    setTimeout(() => categoryNameRef.current?.focus(), 0)
  }

  function handleConfirmCategoryCreate() {
    const name = newCategoryName.trim()
    if (!name) return
    createCategoryMut.mutate({ name })
  }

  // ── Inline person create ──
  const [showPersonCreate, setShowPersonCreate] = useState(false)
  const [newPersonName, setNewPersonName] = useState('')
  const personNameRef = useRef<HTMLInputElement>(null)

  const createPersonMut = useMutation({
    mutationFn: createPerson,
    onSuccess: (person) => {
      qc.setQueryData<Person[]>(['persons'], (old) => [...(old ?? []), person])
      qc.invalidateQueries({ queryKey: ['persons'] })
      setValue('personId', person.id)
      setShowPersonCreate(false)
      setNewPersonName('')
    },
    onError: () => toast.error('Não foi possível criar a pessoa.'),
  })

  function handleOpenPersonCreate() {
    setShowPersonCreate(true)
    setTimeout(() => personNameRef.current?.focus(), 0)
  }

  function handleConfirmPersonCreate() {
    const name = newPersonName.trim()
    if (!name) return
    createPersonMut.mutate({ name })
  }

  // ── Form ──
  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TransactionFormData>({
    resolver: zodResolver(schema) as unknown as Resolver<TransactionFormData>,
    defaultValues: {
      bankId: '',
      categoryId: '',
      type: TransactionType.PIX,
      title: '',
      amount: 0,
      isRefund: false,
      date: '',
      description: '',
      installments: undefined,
      personId: undefined,
    },
  })

  const selectedType = useWatch({ control, name: 'type' })
  const selectedBankId = useWatch({ control, name: 'bankId' })
  const selectedCategoryId = useWatch({ control, name: 'categoryId' })
  const selectedPersonId = useWatch({ control, name: 'personId' })
  const selectedIsRefund = useWatch({ control, name: 'isRefund' })

  useEffect(() => {
    if (selectedType !== TransactionType.CREDIT_CARD && selectedIsRefund) {
      setValue('isRefund', false)
    }
  }, [selectedIsRefund, selectedType, setValue])

  useEffect(() => {
    if (open) {
      submittingRef.current = false
      setShowBankCreate(false)
      setShowCategoryCreate(false)
      setShowPersonCreate(false)
      setNewBank({ name: '', dueDate: '', daysAfterClose: '7' })
      setNewCategoryName('')
      setNewPersonName('')
      if (editTarget) {
        reset({
          bankId: editTarget.bankId,
          categoryId: editTarget.categoryId,
          type: editTarget.type,
          title: editTarget.title,
          amount: Number(editTarget.amount),
          isRefund: editTarget.isRefund ?? false,
          date: editTarget.date,
          description: editTarget.description ?? '',
          personId: editTarget.personId ?? undefined,
        })
      } else {
        reset({
          bankId: createDefaults?.bankId ?? '',
          categoryId: '',
          type: createDefaults?.type ?? TransactionType.PIX,
          title: '',
          amount: 0,
          isRefund: false,
          date: createDefaults?.date ?? formatDateValue(),
          description: '',
          installments: undefined,
          personId: undefined,
        })
      }
    }
    // `createDefaults` é recriado a cada render de quem chama; comparar pelos
    // campos evita reabrir o formulário em looping.
  }, [
    open,
    editTarget,
    reset,
    createDefaults?.bankId,
    createDefaults?.type,
    createDefaults?.date,
  ])

  async function handleFormSubmit(data: TransactionFormData) {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      await onSubmit(data, editScope)
      // On success: keep ref=true — sheet will close, ref resets on next open
    } catch (err) {
      submittingRef.current = false // On error: allow retry
      throw err
    }
  }

  const selectedBank = banks.find((b) => b.id === selectedBankId)
  const selectedCategory = categories.find((c) => c.id === selectedCategoryId)
  const selectedPerson = persons.find((p) => p.id === selectedPersonId)
  const selectableCategories = categories.filter((c) => !c.isSystem)

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
            {selectedType === TransactionType.CREDIT_CARD && (
              <Controller
                control={control}
                name="isRefund"
                render={({ field }) => (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(field.value)}
                    onClick={() => field.onChange(!field.value)}
                    className="flex w-fit items-center gap-2 rounded-md py-0.5 text-left text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className={cn('flex size-4 items-center justify-center rounded border transition-colors', field.value ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 bg-transparent')}>
                      {field.value && <Check className="size-3" />}
                    </span>
                    <span className="text-xs font-medium">Transformar em reembolso</span>
                  </button>
                )}
              />
            )}
          </div>

          {false && selectedType === TransactionType.CREDIT_CARD && (
            <Controller
              control={control}
              name="isRefund"
              render={({ field }) => (
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(field.value)}
                  onClick={() => field.onChange(!field.value)}
                  className="flex w-fit items-center gap-2 rounded-md py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span>
                    <span className="block text-xs font-medium">Reembolso na fatura</span>
                    <span className="sr-only">
                      Abate este valor do total do cartão de crédito
                    </span>
                  </span>
                  <span className={cn('flex size-4 items-center justify-center rounded border transition-colors', field.value ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 bg-transparent')}>
                    {field.value && <Check className="size-3" />}
                  </span>
                </button>
              )}
            />
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              placeholder="Ex: Mercado, Netflix..."
              aria-invalid={!!errors.title}
              disabled={isInstallment}
              {...register('title')}
            />
            {isInstallment
              ? <p className="text-xs text-muted-foreground">Título não pode ser alterado em compras parceladas.</p>
              : errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
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
                />
              )}
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
            {errors.date ? (
              <p className="text-xs text-destructive">{errors.date.message}</p>
            ) : isInstallment ? (
              <p className="text-xs text-muted-foreground">Altera a data em todas as parcelas desta compra e recalcula as faturas.</p>
            ) : null}
          </div>

          {/* Bank */}
          <div className="space-y-1.5">
            <Label>Banco</Label>
            <div className="space-y-2">
              <Controller
                control={control}
                name="bankId"
                render={({ field }) => (
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full" aria-invalid={!!errors.bankId}>
                      <span data-slot="select-value" className="flex flex-1 items-center text-left text-sm">
                        {selectedBank
                          ? selectedBank.name
                          : <span className="text-muted-foreground">Selecione o banco</span>}
                      </span>
                    </SelectTrigger>
                    <SelectContent side="bottom" alignItemWithTrigger={false}>
                      {banks.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />

              {showBankCreate ? (
                <div className="space-y-1.5">
                  <Input
                    ref={bankNameRef}
                    value={newBank.name}
                    onChange={(e) => setNewBank((b) => ({ ...b, name: e.target.value }))}
                    placeholder="Nome do banco"
                    className="h-8 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleConfirmBankCreate() }
                      if (e.key === 'Escape') { setShowBankCreate(false); setNewBank({ name: '', dueDate: '', daysAfterClose: '7' }) }
                    }}
                  />
                  <div className="flex gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={newBank.daysAfterClose}
                      onChange={(e) => setNewBank((b) => ({ ...b, daysAfterClose: e.target.value }))}
                      placeholder="Dias entre datas"
                      className="h-8 text-sm"
                    />
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={newBank.dueDate}
                      onChange={(e) => setNewBank((b) => ({ ...b, dueDate: e.target.value }))}
                      placeholder="Dia vencimento"
                      className="h-8 text-sm"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      disabled={!newBank.name.trim() || !newBank.dueDate || !newBank.daysAfterClose || createBankMut.isPending}
                      onClick={handleConfirmBankCreate}
                      aria-label="Confirmar"
                    >
                      {createBankMut.isPending
                        ? <Loader2 className="size-3.5 animate-spin" />
                        : <Check className="size-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={() => { setShowBankCreate(false); setNewBank({ name: '', dueDate: '', daysAfterClose: '7' }) }}
                      aria-label="Cancelar"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleOpenBankCreate}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Plus className="size-3" />
                  Novo banco
                </button>
              )}
            </div>
            {errors.bankId && <p className="text-xs text-destructive">{errors.bankId.message}</p>}
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <div className="space-y-2">
              <Controller
                control={control}
                name="categoryId"
                render={({ field }) => (
                  <Select
                    value={field.value ?? ''}
                    onValueChange={field.onChange}
                    disabled={isFromSubscription}
                  >
                    <SelectTrigger className="w-full" aria-invalid={!!errors.categoryId}>
                      <span data-slot="select-value" className="flex flex-1 items-center gap-1.5 text-left text-sm">
                        {selectedCategory ? (() => {
                          const { Icon: CatIcon } = resolveCategoryIcon(selectedCategory.icon)
                          return (
                            <>
                              <CatIcon
                                className="size-3.5 shrink-0"
                                style={selectedCategory.color ? { color: selectedCategory.color } : undefined}
                              />
                              {selectedCategory.name}
                            </>
                          )
                        })() : <span className="text-muted-foreground">Selecione a categoria</span>}
                      </span>
                    </SelectTrigger>
                    <SelectContent side="bottom" alignItemWithTrigger={false}>
                      {selectableCategories.map((c) => {
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

              {isFromSubscription ? (
                <p className="text-[11px] text-muted-foreground">
                  Categoria definida pela assinatura.
                </p>
              ) : showCategoryCreate ? (
                <div className="flex gap-1.5">
                  <Input
                    ref={categoryNameRef}
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Nome da categoria"
                    className="h-8 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleConfirmCategoryCreate() }
                      if (e.key === 'Escape') { setShowCategoryCreate(false); setNewCategoryName('') }
                    }}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    disabled={!newCategoryName.trim() || createCategoryMut.isPending}
                    onClick={handleConfirmCategoryCreate}
                    aria-label="Confirmar"
                  >
                    {createCategoryMut.isPending
                      ? <Loader2 className="size-3.5 animate-spin" />
                      : <Check className="size-3.5" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    onClick={() => { setShowCategoryCreate(false); setNewCategoryName('') }}
                    aria-label="Cancelar"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleOpenCategoryCreate}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Plus className="size-3" />
                  Nova categoria
                </button>
              )}
            </div>
            {errors.categoryId && <p className="text-xs text-destructive">{errors.categoryId.message}</p>}
          </div>

          {/* Installments — only for CREDIT_CARD + create */}
          {selectedType === TransactionType.CREDIT_CARD && !isEditing && !selectedIsRefund && (
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

          {/* Person — only for CREDIT_CARD */}
          {selectedType === TransactionType.CREDIT_CARD && (
            <div className="space-y-1.5">
              <Label>Pessoa (opcional)</Label>
              <div className="space-y-2">
                <Controller
                  control={control}
                  name="personId"
                  render={({ field }) => (
                    <Select
                      value={field.value ?? ''}
                      onValueChange={(v) => field.onChange(v || undefined)}
                    >
                      <SelectTrigger className="w-full" aria-label="Selecionar pessoa">
                        <span data-slot="select-value" className="flex flex-1 items-center text-left text-sm">
                          {selectedPerson
                            ? selectedPerson.name
                            : <span className="text-muted-foreground">Nenhuma pessoa vinculada</span>}
                        </span>
                      </SelectTrigger>
                      <SelectContent side="bottom" alignItemWithTrigger={false}>
                        {persons.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />

                {showPersonCreate ? (
                  <div className="flex gap-1.5">
                    <Input
                      ref={personNameRef}
                      value={newPersonName}
                      onChange={(e) => setNewPersonName(e.target.value)}
                      placeholder="Nome da pessoa"
                      className="h-8 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleConfirmPersonCreate() }
                        if (e.key === 'Escape') { setShowPersonCreate(false); setNewPersonName('') }
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      disabled={!newPersonName.trim() || createPersonMut.isPending}
                      onClick={handleConfirmPersonCreate}
                      aria-label="Confirmar"
                    >
                      {createPersonMut.isPending
                        ? <Loader2 className="size-3.5 animate-spin" />
                        : <Check className="size-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={() => { setShowPersonCreate(false); setNewPersonName('') }}
                      aria-label="Cancelar"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleOpenPersonCreate}
                    className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Plus className="size-3" />
                    Nova pessoa
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Vincule esta transação a uma pessoa para gerar automaticamente uma cobrança de &quot;A Receber&quot;.
              </p>
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
          <Button
            type="submit"
            form="transaction-form"
            disabled={isSubmitting}
            onClick={(e) => { if (submittingRef.current) e.preventDefault() }}
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isEditing ? 'Salvar alterações' : 'Criar transação'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
