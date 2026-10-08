'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Info, Plus } from 'lucide-react'
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
import { CurrencyInput } from '@/components/ui/currency-input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getBanks } from '@/services/banks.service'
import { getCategories } from '@/services/categories.service'
import { InlineBankCreate } from '@/components/financial/inline-bank-create'
import { InlineCategoryCreate } from '@/components/financial/inline-category-create'
import { PaymentMethodChoice } from '@/components/financial/payment-method-choice'
import { CompetenceMonthYearFields } from '@/components/financial/competence-month-year-fields'
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/transaction-kind'
import { previewSubscription } from '@/services/subscriptions.service'
import { formatCurrency } from '@/lib/formatters'
import { accountTodayDate } from '@/lib/date'
import { useAuth } from '@/providers/auth-provider'
import type { Category, Subscription } from '@/types'
import { TransactionType } from '@/types'
import { PROGRESSIVE_REVEAL_CLASS } from '@/components/ui/progressive-reveal'
import { bankDisplayName, isSelectableBank } from '@/lib/bank-display'

export const subscriptionFormSchema = z.object({
  title: z.string().min(1, 'Título obrigatório'),
  bankId: z.string().optional(),
  categoryId: z.string().min(1, 'Selecione uma categoria'),
  type: z.enum(TransactionType),
  amount: z.number({ message: 'Valor inválido' }).positive('Valor deve ser positivo'),
  description: z.string().optional(),
  dayOfMonth: z.number().int().min(1).max(31),
  startedAt: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Escolha mês e ano'),
}).refine((data) => data.type !== TransactionType.CREDIT_CARD || Boolean(data.bankId), {
  message: 'Selecione um banco', path: ['bankId'],
})

export type SubscriptionFormData = z.infer<typeof subscriptionFormSchema>

function currentCycle(timeZone: string | null = null) {
  const now = accountTodayDate(timeZone)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

interface SubscriptionSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editSubscription?: Subscription | null
  onSubmit: (data: SubscriptionFormData) => Promise<void>
  embedded?: boolean
  embeddedFooterHost?: HTMLElement | null
}

/**
 * Nome da categoria escolhida.
 *
 * Uma categoria própria em edição pode chegar antes da lista refazer a busca.
 */
function categoryLabel(
  categoryId: string | undefined,
  categories: Category[],
  currentCategory?: Category,
): string | undefined {
  if (!categoryId) return undefined
  return categories.find((c) => c.id === categoryId && !c.isSystem)?.name
    ?? (currentCategory?.id === categoryId && !currentCategory.isSystem ? currentCategory.name : undefined)
}

export function SubscriptionSheet({
  open,
  onOpenChange,
  editSubscription,
  onSubmit,
  embedded = false,
  embeddedFooterHost,
}: SubscriptionSheetProps) {
  const isEdit = !!editSubscription
  const [showOptionalBank, setShowOptionalBank] = useState(Boolean(editSubscription?.bank && isSelectableBank(editSubscription.bank)))
  const { user } = useAuth()
  const timeZone = user?.timeZone ?? null

  const {
    register,
    handleSubmit,
    control,
    reset,
    trigger,
    setValue,
    formState: { errors, isSubmitting, isValid },
  } = useForm<SubscriptionFormData>({
    resolver: zodResolver(subscriptionFormSchema),
    mode: 'onChange',
    defaultValues: editSubscription ? {
      title: editSubscription.title,
      bankId: isSelectableBank(editSubscription.bank) ? editSubscription.bankId : '',
      categoryId: editSubscription.category?.isSystem ? '' : editSubscription.categoryId,
      type: editSubscription.type,
      amount: Number(editSubscription.amount),
      description: editSubscription.description ?? '',
      dayOfMonth: editSubscription.dayOfMonth,
      startedAt: editSubscription.startedAt,
    } : {
      title: '',
      bankId: '',
      categoryId: '',
      type: undefined,
      amount: 0,
      description: '',
      dayOfMonth: 1,
      startedAt: '',
    },
  })

  const { data: banks = [] } = useQuery({ queryKey: ['banks'], queryFn: () => getBanks() })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  })

  /**
   * `getBanks()` já devolve só os ativos, e o interno de recebíveis é
   * descartado aqui. Um banco arquivado não pode receber assinatura — a
   * reativação e a troca são recusadas pelo backend.
   */
  const selectableBanks = banks.filter((b) => !b.isSystem && !b.isArchived)

  /** Categorias internas não são opções de classificação do usuário. */
  const selectableCategories = categories.filter((c) => !c.isSystem)

  const bankId = useWatch({ control, name: 'bankId' })
  const categoryId = useWatch({ control, name: 'categoryId' })
  const selectedBank = banks.find((bank) => bank.id === bankId) ?? (editSubscription?.bankId === bankId && editSubscription?.bank && isSelectableBank(editSubscription.bank) ? editSubscription.bank : undefined)
  const dayOfMonth = useWatch({ control, name: 'dayOfMonth' })
  const startedAt = useWatch({ control, name: 'startedAt' })
  const type = useWatch({ control, name: 'type' })
  const amount = useWatch({ control, name: 'amount' })
  const hasPaymentMethod = PAYMENT_METHODS.includes(type as PaymentMethod)
  const bankIsRequired = type === TransactionType.CREDIT_CARD
  const showBankSelector = bankIsRequired || showOptionalBank || Boolean(bankId)

  // Só faz sentido prever quando o início é retroativo e ainda não existe.
  const isRetroactive = !isEdit && /^\d{4}-(0[1-9]|1[0-2])$/.test(startedAt) && startedAt < currentCycle(timeZone)

  const { data: preview = [], isFetching: previewLoading } = useQuery({
    queryKey: ['subscription-preview', bankId, categoryId, dayOfMonth, startedAt, type],
    queryFn: () => previewSubscription({ bankId: bankId || undefined, categoryId, dayOfMonth, startedAt, type }),
    enabled: open && isRetroactive && hasPaymentMethod && !!categoryId && (!bankIsRequired || !!bankId) && !!dayOfMonth,
  })

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowOptionalBank(Boolean(editSubscription?.bank && isSelectableBank(editSubscription.bank)))
    if (editSubscription) {
      reset({
        title: editSubscription.title,
        bankId: isSelectableBank(editSubscription.bank) ? editSubscription.bankId : '',
        categoryId: editSubscription.category?.isSystem ? '' : editSubscription.categoryId,
        type: editSubscription.type,
        amount: Number(editSubscription.amount),
        description: editSubscription.description ?? '',
        dayOfMonth: editSubscription.dayOfMonth,
        startedAt: editSubscription.startedAt,
      })
      void trigger()
    } else {
      reset({
        title: '',
        bankId: '',
        categoryId: '',
        type: undefined,
        amount: 0,
        description: '',
        dayOfMonth: 1,
        startedAt: '',
      })
    }
  }, [open, editSubscription, reset, trigger, timeZone])

  // Quem fecha o drawer é a página, no `onSuccess` da mutação — igual aos
  // demais. Fechar aqui escondia o formulário mesmo quando o salvamento
  // falhava, e o usuário perdia o que havia digitado.
  async function submit(data: SubscriptionFormData) {
    await onSubmit(data)
  }

  const willCreate = preview.filter((p) => !p.skipped)
  const willSkip = preview.filter((p) => p.skipped)
  const previewTotal = willCreate.length * (amount || 0)

  const bankField = <div className="flex flex-col gap-1.5">
    {showBankSelector ? <Label htmlFor="bankId">Banco</Label> : null}
    {!showBankSelector ? (
      <button type="button" onClick={() => setShowOptionalBank(true)} className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <Plus className="size-3" /> Adicionar banco (opcional)
      </button>
    ) : (
      <>
        <Controller control={control} name="bankId" render={({ field }) => (
          <Select value={field.value || ''} onValueChange={field.onChange}>
            <SelectTrigger id="bankId" className="w-full" aria-label="Banco" aria-invalid={Boolean(errors.bankId)} aria-describedby={errors.bankId ? 'subscription-bank-error' : undefined}>
              <SelectValue placeholder={bankIsRequired ? 'Selecione o banco' : 'Selecione um banco'}>{selectedBank ? bankDisplayName(selectedBank) : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {selectableBanks.map((bank) => <SelectItem key={bank.id} value={bank.id}>{bankDisplayName(bank)}</SelectItem>)}
            </SelectContent>
          </Select>
        )} />
        {!bankIsRequired ? <button type="button" onClick={() => { setValue('bankId', undefined, { shouldDirty: true, shouldValidate: true }); setShowOptionalBank(false) }} className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground">Remover banco</button> : null}
        <InlineBankCreate onCreated={(bank) => { setValue('bankId', bank.id, { shouldDirty: true, shouldValidate: true }); setShowOptionalBank(true) }} />
      </>
    )}
    {errors.bankId ? <p id="subscription-bank-error" className="text-xs text-destructive">{errors.bankId.message}</p> : null}
  </div>

  const fields = (
        <form
          id="subscription-form"
          onSubmit={handleSubmit(submit)}
          className={embedded ? `flex flex-col gap-4 ${PROGRESSIVE_REVEAL_CLASS}` : 'flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5'}
        >
          <Controller control={control} name="type" render={({ field }) => <PaymentMethodChoice value={hasPaymentMethod ? field.value as PaymentMethod : null} onChange={field.onChange} error={errors.type?.message} />} />
          {(isEdit || hasPaymentMethod) && <div className={isEdit ? 'flex flex-col gap-4' : `flex flex-col gap-4 ${PROGRESSIVE_REVEAL_CLASS}`}>
          {/* `aria-invalid` + `aria-describedby` ligam o campo à sua mensagem
              de erro, como nos demais formulários. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Nome</Label>
            <Input
              id="title"
              placeholder="Ex.: Netflix"
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'subscription-title-error' : undefined}
              {...register('title')}
            />
            {errors.title && (
              <p id="subscription-title-error" className="text-xs text-destructive">
                {errors.title.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="amount">Valor</Label>
            <Controller
              control={control}
              name="amount"
              render={({ field }) => (
                <CurrencyInput
                  id="amount"
                  value={field.value}
                  onChange={field.onChange}
                  aria-invalid={Boolean(errors.amount)}
                  aria-describedby={errors.amount ? 'subscription-amount-error' : undefined}
                />
              )}
            />
            {errors.amount && (
              <p id="subscription-amount-error" className="text-xs text-destructive">
                {errors.amount.message}
              </p>
            )}
          </div>

          {bankIsRequired ? bankField : null}

          <div className="flex flex-col gap-1.5">
            <Label>Categoria</Label>
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <Select
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full" aria-label="Categoria" aria-invalid={Boolean(errors.categoryId)} aria-describedby={errors.categoryId ? 'subscription-category-error' : undefined}>
                    <SelectValue placeholder="Selecione uma categoria">
                      {categoryLabel(field.value, categories, editSubscription?.category)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {selectableCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.categoryId ? <p id="subscription-category-error" className="text-xs text-destructive">{errors.categoryId.message}</p> : null}
            {isEdit ? <p className="text-[11px] text-muted-foreground">Vale dos próximos lançamentos em diante; os já criados mantêm a categoria que tinham.</p> : null}
            <InlineCategoryCreate onCreated={(category) => setValue('categoryId', category.id, { shouldDirty: true, shouldValidate: true })} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dayOfMonth">Dia da cobrança</Label>
            <Controller
              control={control}
              name="dayOfMonth"
              render={({ field }) => (
                <Select
                  value={String(field.value)}
                  onValueChange={(v) => field.onChange(Number(v))}
                >
                  <SelectTrigger className="w-full" aria-label="Dia da cobrança">
                    <SelectValue>{`Dia ${field.value}`}</SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <SelectItem key={d} value={String(d)}>{`Dia ${d}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {dayOfMonth > 28 && (
              <p className="text-[11px] text-muted-foreground">
                Meses sem o dia {dayOfMonth} cobram no último dia.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Primeira competência</Label>
            <Controller
              control={control}
              name="startedAt"
              render={({ field }) => {
                const [year, month] = (field.value ?? '').split('-')
                return <CompetenceMonthYearFields month={month ?? ''} year={year ?? ''} onMonthChange={(nextMonth) => field.onChange(`${year}-${nextMonth}`)} onYearChange={(nextYear) => field.onChange(`${nextYear}-${month ?? ''}`)} monthAriaLabel="Mês da primeira competência" yearAriaLabel="Ano da primeira competência" disabled={isEdit} />
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              {isEdit
                ? 'Não pode ser alterado — para corrigir, exclua e crie novamente.'
                : 'Escolha um mês passado para lançar o histórico junto.'}
            </p>
          </div>

          {/* Aviso do que a criação retroativa vai lançar */}
          {isRetroactive && (previewLoading || preview.length > 0) && (
            <div className="flex items-start gap-2 rounded-lg bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
              {previewLoading ? (
                <p>Calculando o que será lançado…</p>
              ) : (
                <p>
                  Isso vai lançar{' '}
                  <span className="font-medium text-foreground">
                    {willCreate.length} cobrança{willCreate.length > 1 ? 's' : ''}
                  </span>
                  {willCreate.length > 0 && amount > 0 && (
                    <> — {formatCurrency(previewTotal)} no total</>
                  )}
                  .
                  {willSkip.length > 0 && (
                    <>
                      {' '}
                      {willSkip.length} cai
                      {willSkip.length > 1 ? 'em' : ''} em fatura já paga e ser
                      {willSkip.length > 1 ? 'ão' : 'á'} pulada
                      {willSkip.length > 1 ? 's' : ''}.
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Descrição (opcional)</Label>
            <Input id="description" placeholder="Anotação livre..." {...register('description')} />
          </div>
          {!bankIsRequired ? bankField : null}
          </div>}
        </form>
  )
  const footer = (
        <SheetFooter className={embedded ? 'px-6 py-4' : 'px-6 pb-6 pt-0'}>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button type="submit" form="subscription-form" disabled={isSubmitting || !hasPaymentMethod || !categoryId || !isValid}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? 'Salvar alterações' : 'Criar despesa'}
          </Button>
        </SheetFooter>
  )

  if (embedded) return <>{fields}{embeddedFooterHost ? createPortal(footer, embeddedFooterHost) : null}</>

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{isEdit ? 'Editar despesa automática' : 'Nova despesa automática'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? 'Alterações valem dos próximos lançamentos em diante.'
              : 'Um lançamento por mês, criado automaticamente no dia da cobrança.'}
          </SheetDescription>
        </SheetHeader>
        {fields}
        {footer}
      </SheetContent>
    </Sheet>
  )
}
