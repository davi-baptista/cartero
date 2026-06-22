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
import { getBanks, createBank } from '@/services/banks.service'
import { getCategories, createCategory } from '@/services/categories.service'
import type { Transaction, InstallmentScope, Bank, Category } from '@/types'
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
      z.number().int().min(2).max(64).optional(),
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
  onSubmit: (data: TransactionFormData, scope: InstallmentScope | null) => Promise<void>
}

export function TransactionSheet({
  open,
  onOpenChange,
  editTarget,
  editScope,
  onSubmit,
}: TransactionSheetProps) {
  const isEditing = editTarget !== null
  const submittingRef = useRef(false)
  const qc = useQueryClient()

  // ── Queries ──
  const { data: banks = [] } = useQuery({ queryKey: ['banks'], queryFn: getBanks })
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: getCategories })

  // ── Inline bank create ──
  const [showBankCreate, setShowBankCreate] = useState(false)
  const [newBank, setNewBank] = useState({ name: '', closeDate: '', dueDate: '' })
  const bankNameRef = useRef<HTMLInputElement>(null)

  const createBankMut = useMutation({
    mutationFn: createBank,
    onSuccess: (bank) => {
      qc.setQueryData<Bank[]>(['banks'], (old) => [...(old ?? []), bank])
      qc.invalidateQueries({ queryKey: ['banks'] })
      setValue('bankId', bank.id)
      setShowBankCreate(false)
      setNewBank({ name: '', closeDate: '', dueDate: '' })
    },
    onError: () => toast.error('Não foi possível criar o banco.'),
  })

  function handleOpenBankCreate() {
    setShowBankCreate(true)
    setTimeout(() => bankNameRef.current?.focus(), 0)
  }

  function handleConfirmBankCreate() {
    const name = newBank.name.trim()
    const close = Number(newBank.closeDate)
    const due = Number(newBank.dueDate)
    if (!name || !close || !due) return
    createBankMut.mutate({ name, invoiceCloseDate: close, invoiceDueDate: due })
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
      date: '',
      description: '',
      installments: undefined,
    },
  })

  const selectedType = useWatch({ control, name: 'type' })
  const selectedBankId = useWatch({ control, name: 'bankId' })
  const selectedCategoryId = useWatch({ control, name: 'categoryId' })

  useEffect(() => {
    if (open) {
      submittingRef.current = false
      setShowBankCreate(false)
      setShowCategoryCreate(false)
      setNewBank({ name: '', closeDate: '', dueDate: '' })
      setNewCategoryName('')
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
                      if (e.key === 'Escape') { setShowBankCreate(false); setNewBank({ name: '', closeDate: '', dueDate: '' }) }
                    }}
                  />
                  <div className="flex gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={newBank.closeDate}
                      onChange={(e) => setNewBank((b) => ({ ...b, closeDate: e.target.value }))}
                      placeholder="Dia fechamento"
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
                      disabled={!newBank.name.trim() || !newBank.closeDate || !newBank.dueDate || createBankMut.isPending}
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
                      onClick={() => { setShowBankCreate(false); setNewBank({ name: '', closeDate: '', dueDate: '' }) }}
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
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
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

              {showCategoryCreate ? (
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
          {selectedType === TransactionType.CREDIT_CARD && !isEditing && (
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
