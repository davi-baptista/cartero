'use client'

import { useEffect } from 'react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Info } from 'lucide-react'
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
import { previewSubscription } from '@/services/subscriptions.service'
import { formatCurrency, TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import type { Category, Subscription } from '@/types'
import { TransactionType } from '@/types'

const schema = z.object({
  title: z.string().min(1, 'Título obrigatório'),
  bankId: z.string().min(1, 'Banco obrigatório'),
  // Opcional: sem escolha, o backend usa a categoria de sistema
  // "Assinatura" e o cadastro segue rápido.
  categoryId: z.string().optional(),
  type: z.enum(TransactionType),
  amount: z.number({ message: 'Valor inválido' }).positive('Valor deve ser positivo'),
  description: z.string().optional(),
  dayOfMonth: z.number().int().min(1).max(31),
  startedAt: z.string().regex(/^\d{4}-\d{2}$/, 'Mês inválido'),
})

export type SubscriptionFormData = z.infer<typeof schema>

/** Assinatura é sempre saída de dinheiro — receita não faz sentido aqui. */
const PAYMENT_TYPES = [
  TransactionType.CREDIT_CARD,
  TransactionType.DEBIT_CARD,
  TransactionType.PIX,
  TransactionType.BOLETO,
]

function currentCycle() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function cycleLabel(cycle: string) {
  const [year, month] = cycle.split('-').map(Number)
  const nome = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })
  return nome.charAt(0).toUpperCase() + nome.slice(1)
}

/** Últimos 24 meses — o suficiente para trazer histórico sem virar uma lista infinita. */
function cycleOptions() {
  const options: string[] = []
  const now = new Date()
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return options
}

interface SubscriptionSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editSubscription?: Subscription | null
  onSubmit: (data: SubscriptionFormData) => Promise<void>
}

/**
 * Nome da categoria escolhida.
 *
 * Busca na lista COMPLETA, não na filtrada: uma assinatura antiga pode estar
 * na categoria de sistema "Assinatura", e ela precisa aparecer como valor
 * atual mesmo estando fora das opções selecionáveis.
 */
function categoryLabel(
  categoryId: string | undefined,
  categories: Category[],
): string | undefined {
  if (!categoryId) return undefined
  return categories.find((c) => c.id === categoryId)?.name
}

export function SubscriptionSheet({
  open,
  onOpenChange,
  editSubscription,
  onSubmit,
}: SubscriptionSheetProps) {
  const isEdit = !!editSubscription

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SubscriptionFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      bankId: '',
      categoryId: undefined,
      type: TransactionType.CREDIT_CARD,
      amount: 0,
      dayOfMonth: 1,
      startedAt: currentCycle(),
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

  /**
   * Categorias de sistema ficam fora do seletor.
   *
   * "Assinatura" é o default quando nada é escolhido, mas oferecê-la na lista
   * sugeriria que ela é uma opção como as outras — e as demais ("Dívida paga",
   * "Receita recebida") pertencem a fluxos que não são este. A categoria atual
   * de uma assinatura em edição continua aparecendo, mesmo sendo de sistema.
   */
  const selectableCategories = categories.filter((c) => !c.isSystem)

  const bankId = useWatch({ control, name: 'bankId' })
  const dayOfMonth = useWatch({ control, name: 'dayOfMonth' })
  const startedAt = useWatch({ control, name: 'startedAt' })
  const type = useWatch({ control, name: 'type' })
  const amount = useWatch({ control, name: 'amount' })

  // Só faz sentido prever quando o início é retroativo e ainda não existe.
  const isRetroactive = !isEdit && !!startedAt && startedAt < currentCycle()

  const { data: preview = [], isFetching: previewLoading } = useQuery({
    queryKey: ['subscription-preview', bankId, dayOfMonth, startedAt, type],
    queryFn: () => previewSubscription({ bankId, dayOfMonth, startedAt, type }),
    enabled: open && isRetroactive && !!bankId && !!dayOfMonth,
  })

  useEffect(() => {
    if (!open) return
    if (editSubscription) {
      reset({
        title: editSubscription.title,
        bankId: editSubscription.bankId,
        categoryId: editSubscription.categoryId,
        type: editSubscription.type,
        amount: Number(editSubscription.amount),
        description: editSubscription.description ?? '',
        dayOfMonth: editSubscription.dayOfMonth,
        startedAt: editSubscription.startedAt,
      })
    } else {
      reset({
        title: '',
        bankId: '',
        categoryId: undefined,
        type: TransactionType.CREDIT_CARD,
        amount: 0,
        description: '',
        dayOfMonth: 1,
        startedAt: currentCycle(),
      })
    }
  }, [open, editSubscription, reset])

  // Quem fecha o drawer é a página, no `onSuccess` da mutação — igual aos
  // demais. Fechar aqui escondia o formulário mesmo quando o salvamento
  // falhava, e o usuário perdia o que havia digitado.
  async function submit(data: SubscriptionFormData) {
    await onSubmit(data)
  }

  const willCreate = preview.filter((p) => !p.skipped)
  const willSkip = preview.filter((p) => p.skipped)
  const previewTotal = willCreate.length * (amount || 0)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{isEdit ? 'Editar assinatura' : 'Nova assinatura'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? 'Alterações valem dos próximos lançamentos em diante.'
              : 'Um lançamento por mês, criado automaticamente no dia da cobrança.'}
          </SheetDescription>
        </SheetHeader>

        {/* O footer fica fora do form e se liga por `form="subscription-form"`,
            como nos demais drawers: assim ele não rola junto com os campos e
            continua alcançável em formulários longos. */}
        <form
          id="subscription-form"
          onSubmit={handleSubmit(submit)}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          {/* `aria-invalid` + `aria-describedby` ligam o campo à sua mensagem
              de erro, como nos demais formulários. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Nome</Label>
            <Input
              id="title"
              placeholder="Netflix"
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

          <div className="flex flex-col gap-1.5">
            <Label>Forma de pagamento</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-label="Forma de pagamento">
                    <SelectValue>{TRANSACTION_TYPE_LABELS[field.value]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {PAYMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TRANSACTION_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bankId">Banco</Label>
            <Controller
              control={control}
              name="bankId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  {/* Mesmo padrão de `title` e `amount`: sem `aria-invalid` e
                      `aria-describedby` um leitor de tela anunciava "Banco,
                      botão" sem indício de erro, e este é o único Select do
                      formulário com validação que produz mensagem visível. */}
                  <SelectTrigger
                    id="bankId"
                    aria-label="Banco"
                    aria-invalid={Boolean(errors.bankId)}
                    aria-describedby={
                      errors.bankId ? 'subscription-bank-error' : undefined
                    }
                  >
                    <SelectValue placeholder="Selecione">
                      {selectableBanks.find((b) => b.id === field.value)?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {selectableBanks.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.bankId && (
              <p
                id="subscription-bank-error"
                className="text-xs text-destructive"
              >
                {errors.bankId.message}
              </p>
            )}
          </div>

          {/*
            Categoria dos lançamentos gerados.
            Vazio significa "usar a de sistema" — não é um estado inválido, e o
            texto de apoio diz isso para o campo não parecer incompleto.
          */}
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
                  <SelectTrigger aria-label="Categoria">
                    <SelectValue placeholder="Assinatura (padrão)">
                      {categoryLabel(field.value, categories)}
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
            <p className="text-[11px] text-muted-foreground">
              {isEdit
                ? 'Vale dos próximos lançamentos em diante; os já criados mantêm a categoria que tinham.'
                : 'Sem escolher, os lançamentos entram em "Assinatura".'}
            </p>
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
                  <SelectTrigger aria-label="Dia da cobrança">
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
            <Label>Assinando desde</Label>
            <Controller
              control={control}
              name="startedAt"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isEdit}
                >
                  <SelectTrigger aria-label="Assinando desde">
                    <SelectValue>{field.value ? cycleLabel(field.value) : undefined}</SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {cycleOptions().map((c) => (
                      <SelectItem key={c} value={c}>{cycleLabel(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
            <Input id="description" {...register('description')} />
          </div>
        </form>

        <SheetFooter className="px-6 pb-6 pt-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button type="submit" form="subscription-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? 'Salvar alterações' : 'Criar assinatura'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
