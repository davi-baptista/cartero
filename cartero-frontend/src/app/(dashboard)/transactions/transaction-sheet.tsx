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
import {
  KIND_LABELS,
  PAYMENT_METHODS,
  clearIncompatibleFields,
  kindOf,
  methodOf,
  type PaymentMethod,
  type TransactionKind,
} from '@/lib/transaction-kind'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { TransactionPreviewPanel } from './transaction-preview-panel'
import { cn } from '@/lib/utils'
import { bankDisplayName, isSelectableBank } from '@/lib/bank-display'
import { formatDateValue } from '@/lib/date'
import { resolveCategoryIcon } from '@/lib/category-icons'
import { getBanks, createBank } from '@/services/banks.service'
import { getCategories, createCategory } from '@/services/categories.service'
import { getPersons, createPerson } from '@/services/persons.service'
import { previewTransaction } from '@/services/transactions.service'
import type { Transaction, Bank, Category, Person } from '@/types'
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
  /**
   * O escopo saiu daqui: em parcelamento ele é escolhido depois do submit, no
   * diálogo que projeta o impacto de cada opção. O formulário só entrega as
   * alterações.
   */
  onSubmit: (data: TransactionFormData) => Promise<void>
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
  const { data: banks = [] } = useQuery({ queryKey: ['banks'], queryFn: () => getBanks() })
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
  /**
   * Se a compra é para outra pessoa. Fica em estado local, não no formulário:
   * é uma decisão de interface, e o que vai ao backend é só `personId`.
   * Ao editar, começa ligado quando a transação já tem pessoa.
   */
  const [forOtherPerson, setForOtherPerson] = useState(false)
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
  const selectedAmount = useWatch({ control, name: 'amount' })
  const selectedInstallments = useWatch({ control, name: 'installments' })

  // Quantas parcelas o backend vai gerar. Abaixo de 2 a compra é à vista.
  const installmentCount =
    selectedType === TransactionType.CREDIT_CARD && !selectedIsRefund
      ? Number(selectedInstallments) || 1
      : 1

  const selectedKind = kindOf(selectedType ?? TransactionType.PIX)
  const selectedDate = useWatch({ control, name: 'date' })

  /**
   * Prévia vinda do servidor: rateio, competência e vencimentos.
   *
   * Só é pedida quando há dados suficientes e a operação tem consequência
   * automática — uma compra no crédito. PIX, débito, boleto e receita não
   * geram fatura nem cobrança, então a prévia só repetiria o formulário.
   *
   * O debounce evita uma requisição por tecla; a `queryKey` carrega todos os
   * campos que afetam o resultado, então o React Query descarta respostas de
   * entradas antigas e não há race condition.
   */
  const previewInput = useDebouncedValue(
    {
      bankId: selectedBankId ?? '',
      title: 'Lançamento',
      type: selectedType,
      amount: Number(selectedAmount) || 0,
      date: selectedDate ?? '',
      installments: installmentCount > 1 ? installmentCount : undefined,
      isRefund: selectedIsRefund || undefined,
      personId: selectedPersonId || undefined,
    },
    350,
  )

  const previewEnabled =
    open &&
    !isEditing &&
    previewInput.type === TransactionType.CREDIT_CARD &&
    Boolean(previewInput.bankId) &&
    Boolean(previewInput.date) &&
    previewInput.amount > 0

  const {
    data: preview,
    isFetching: previewLoading,
    isError: previewFailed,
  } = useQuery({
    queryKey: ['transaction-preview', previewInput],
    queryFn: () => previewTransaction(previewInput),
    enabled: previewEnabled,
    // Mantém a prévia anterior visível durante o recálculo, evitando flicker.
    placeholderData: (previous) => previous,
    retry: false,
  })

  /**
   * Trocar natureza ou forma descarta o que o novo tipo não aceita.
   *
   * A política é descartar, nunca guardar para restaurar: valor financeiro
   * escondido que reaparece depois é imprevisível, e o backend recusaria o
   * payload de qualquer forma.
   */
  function applyType(type: TransactionType) {
    setValue('type', type, { shouldValidate: true })
    const cleaned = clearIncompatibleFields(
      {
        installments: selectedInstallments as number | undefined,
        personId: selectedPersonId,
        isRefund: selectedIsRefund,
      },
      type,
    )
    setValue('installments', cleaned.installments)
    setValue('personId', cleaned.personId)
    setValue('isRefund', cleaned.isRefund ?? false)
    if (cleaned.personId === undefined) setShowPersonCreate(false)
  }

  function handleKindChange(kind: TransactionKind) {
    // Voltando para gasto, retoma a última forma escolhida; a primeira vez
    // cai em crédito, que é o caminho mais comum no Cartero.
    applyType(
      kind === 'income'
        ? TransactionType.INCOME
        : (methodOf(selectedType) ?? TransactionType.CREDIT_CARD),
    )
  }

  function handleMethodChange(method: PaymentMethod) {
    applyType(method)
  }

  /** Estorno não parcela e não tem pessoa — o serviço ignora ambos. */
  function handleRefundToggle(next: boolean) {
    setValue('isRefund', next)
    if (next) {
      setValue('installments', undefined)
      setValue('personId', undefined)
      setForOtherPerson(false)
      setShowPersonCreate(false)
    }
  }

  function handleForOtherPersonToggle(next: boolean) {
    setForOtherPerson(next)
    if (!next) {
      setValue('personId', undefined)
      setShowPersonCreate(false)
    }
  }

  /** Parcelado quando há uma quantidade de parcelas definida. */
  const isParcelado = installmentCount > 1

  /**
   * Alternar à vista/parcelado mexe só na quantidade — o valor informado
   * continua sendo o total da compra. Voltar para parcelado recomeça em 2,
   * sem restaurar a quantidade anterior (mesma política de descartar estado).
   */
  function handlePaymentModeChange(parcelado: boolean) {
    setValue('installments', parcelado ? 2 : undefined, { shouldValidate: true })
  }

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
      // O toggle de "compra para outra pessoa" acompanha o estado real da
      // transação ao abrir para edição.
      setForOtherPerson(Boolean(editTarget?.personId))
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
      // Rede de segurança: mesmo que algum campo incompatível tenha escapado
      // dos handlers, o payload sai coerente com o tipo escolhido.
      await onSubmit({ ...data, ...clearIncompatibleFields(data, data.type) })
      // On success: keep ref=true — sheet will close, ref resets on next open
    } catch (err) {
      submittingRef.current = false // On error: allow retry
      throw err
    }
  }

  /**
   * Opções de banco: os ativos, mais o banco atual se ele estiver arquivado.
   *
   * `getBanks()` devolve só os ativos — correto para um lançamento novo. Mas ao
   * editar uma transação de um cartão encerrado, o valor atual não estaria na
   * lista e o Select apareceria vazio, como se o campo tivesse sido apagado.
   *
   * O banco vem de `editTarget.bank`, que a transação já carrega — sem consulta
   * extra. Ele é marcado como "Arquivado" e o backend continua recusando
   * qualquer OUTRO registro que tente apontar para ele.
   */
  const bankOptions = (() => {
    const current = editTarget?.bank

    /*
      O banco de sistema (`__system_receivables__`) fica FORA da lista.

      `GET /banks` já o exclui, mas ele chega aqui embutido na transação, e a
      reinclusão acima o tratava como um arquivado qualquer — colocando seu
      nome técnico no seletor e permitindo apontar novos lançamentos para um
      banco que o usuário nunca criou.
    */
    if (!current || !isSelectableBank(current)) return banks
    if (banks.some((bank) => bank.id === current.id)) return banks
    return [...banks, current as Bank]
  })()

  const selectedBank = bankOptions.find((b) => b.id === selectedBankId)
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
          {/* Natureza — "o que aconteceu". O tipo persistido é derivado desta
              escolha mais a forma, logo abaixo. */}
          <div className="space-y-1.5">
            <Label>O que aconteceu?</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['expense', 'income'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={selectedKind === kind}
                  onClick={() => handleKindChange(kind)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    selectedKind === kind
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  {KIND_LABELS[kind]}
                </button>
              ))}
            </div>
            {errors.type && <p className="text-xs text-destructive">{errors.type.message}</p>}
          </div>

          {/* Forma de pagamento — só existe para gasto. Receita é persistida
              como INCOME e o schema não separa a forma de recebimento. */}
          {selectedKind === 'expense' && (
            <div className="space-y-1.5">
              <Label>Forma de pagamento</Label>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    aria-pressed={selectedType === method}
                    onClick={() => handleMethodChange(method)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                      selectedType === method
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {TRANSACTION_TYPE_LABELS[method]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Estorno — só no crédito. Reduz a fatura em vez de somar. */}
          {selectedType === TransactionType.CREDIT_CARD && (
            <div className="space-y-1.5">
              <Controller
                control={control}
                name="isRefund"
                render={({ field }) => (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(field.value)}
                    onClick={() => handleRefundToggle(!field.value)}
                    className="flex w-fit items-center gap-2 rounded-md py-0.5 text-left text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className={cn('flex size-4 items-center justify-center rounded border transition-colors', field.value ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 bg-transparent')}>
                      {field.value && <Check className="size-3" />}
                    </span>
                    <span className="text-xs font-medium">Registrar como estorno</span>
                  </button>
                )}
              />
              {selectedIsRefund && (
                <p className="text-xs text-muted-foreground">
                  Reduz o total da fatura. Não é receita e não gera cobrança.
                </p>
              )}
            </div>
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
            {/* Em compras parceladas, o valor informado é o TOTAL — o backend
                divide entre as parcelas. O rótulo diz isso para não deixar
                dúvida entre total e valor da parcela. */}
            <Label htmlFor="amount">
              {installmentCount > 1 ? 'Valor total (R$)' : 'Valor (R$)'}
            </Label>
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
                      <span data-slot="select-value" className="flex flex-1 items-center gap-1.5 text-left text-sm">
                        {selectedBank ? (
                          <>
                            {bankDisplayName(selectedBank)}
                            {selectedBank.isArchived && (
                              <span className="text-xs text-muted-foreground">
                                — Arquivado
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">Selecione o banco</span>
                        )}
                      </span>
                    </SelectTrigger>
                    <SelectContent side="bottom" alignItemWithTrigger={false}>
                      {bankOptions.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {bankDisplayName(b)}
                          {b.isArchived && (
                            <span className="text-xs text-muted-foreground">
                              — Arquivado
                            </span>
                          )}
                        </SelectItem>
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

          {/* Pagamento — só no crédito, e nunca em estorno (que é sempre um
              único lançamento). A escolha explícita substitui a convenção
              implícita do campo vazio significando "à vista". */}
          {selectedType === TransactionType.CREDIT_CARD && !isEditing && !selectedIsRefund && (
            <div className="space-y-1.5">
              <Label>Pagamento</Label>
              <div className="grid grid-cols-2 gap-2">
                {([false, true] as const).map((parcelado) => (
                  <button
                    key={String(parcelado)}
                    type="button"
                    aria-pressed={isParcelado === parcelado}
                    onClick={() => handlePaymentModeChange(parcelado)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                      isParcelado === parcelado
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {parcelado ? 'Parcelado' : 'À vista'}
                  </button>
                ))}
              </div>

              {isParcelado && (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="installments">Número de parcelas</Label>
                  <Input
                    id="installments"
                    type="number"
                    min={2}
                    max={64}
                    aria-invalid={!!errors.installments}
                    {...register('installments')}
                  />
                  {errors.installments && (
                    <p className="text-xs text-destructive">{errors.installments.message}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Compra para outra pessoa — só no crédito, e nunca em estorno.
              O toggle nomeia a função antes de mostrar uma lista de nomes:
              "Pessoa (opcional)" exigia deduzir para que servia. */}
          {selectedType === TransactionType.CREDIT_CARD && !selectedIsRefund && (
            <div className="space-y-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={forOtherPerson}
                onClick={() => handleForOtherPersonToggle(!forOtherPerson)}
                className="flex w-fit items-center gap-2 rounded-md py-0.5 text-left text-muted-foreground transition-colors hover:text-foreground"
              >
                <span
                  className={cn(
                    'flex size-4 items-center justify-center rounded border transition-colors',
                    forOtherPerson
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/50 bg-transparent',
                  )}
                >
                  {forOtherPerson && <Check className="size-3" />}
                </span>
                <span className="text-xs font-medium">Compra para outra pessoa</span>
              </button>
              {forOtherPerson && (
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
                {/* A microcopy genérica ("gera automaticamente uma cobrança")
                    dá lugar ao valor e vencimento reais no painel de prévia,
                    assim que a pessoa é escolhida. */}
                {!selectedPersonId && (
                  <p className="text-xs text-muted-foreground">
                    A pessoa fica responsável pelo valor, e uma cobrança é
                    criada em A Receber.
                  </p>
                )}
              </div>
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

          {/* Consequências automáticas — só aparece quando há o que explicar. */}
          <TransactionPreviewPanel
            preview={previewEnabled ? preview : undefined}
            isLoading={previewEnabled && previewLoading}
            isError={previewEnabled && previewFailed}
          />
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
