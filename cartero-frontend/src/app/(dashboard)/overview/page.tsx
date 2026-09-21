'use client'

import { useState, useMemo, memo, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { ShoppingBag, CreditCard, HandCoins, Wallet, ArrowRight, CheckCircle2, ExternalLink, TriangleAlert, RotateCcw, Loader2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useMonthPeriod } from '@/components/month-nav'
import { getTransactions } from '@/services/transactions.service'
import { getInvoices } from '@/services/invoices.service'
import { getBanks } from '@/services/banks.service'
import { getDebts } from '@/services/debts.service'
import { getReceivables } from '@/services/receivables.service'
import { formatCurrency, formatMonthYear } from '@/lib/formatters'
import { bankDisplayName } from '@/lib/bank-display'
import {
  expenseSignedAmount,
  isOwnExpense,
  isRefundTransaction,
} from '@/lib/money-semantics'
import { accountToday, accountTodayDate, formatDateValue } from '@/lib/date'
import { useAuth } from '@/providers/auth-provider'
import { parseInvoiceDate } from '@/lib/invoice-dates'
import { resolveCategoryIcon } from '@/lib/category-icons'
import { invoiceStatusConfig } from '@/lib/invoice-status'
import {
  civilDaysUntil,
  formatCloseTiming,
  formatDueTiming,
  formatDueTimingFromISO,
} from '@/lib/invoice-timing'
import { cn } from '@/lib/utils'
import {
  buildCalendarEvents,
  eventsForDay,
  CAL_KIND_LABEL,
  type CalEvent,
  type CalEventDirection,
} from '@/lib/calendar-events'
import {
  ATTENTION_DAYS_WINDOW,
  attentionDueUrgency,
  buildAttentionSelection,
} from '@/lib/overview-attention'
import { FinancialListRow, ROW_AMOUNT_CLASS } from '@/components/ui/financial-list-row'
import { Button } from '@/components/ui/button'
import type { Invoice, Debt, Receivable, Bank, Transaction } from '@/types'
import { InvoiceStatus } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const

// Rótulo e cor de status vêm de `@/lib/invoice-status` — este mapa era uma
// cópia byte a byte do que existia em `budget` e em `banks/[id]/invoices`.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function monthRange(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end = formatDateValue(new Date(year, month, 0))
  return { startDate: start, endDate: end }
}

/** Dívidas e recebíveis guardam a data como string ISO. */
function formatDueDate(dateString: string): string {
  return formatDueTimingFromISO(dateString)
}

type DueUrgency = 'overdue' | 'urgent' | 'soon' | 'normal'

const DUE_URGENCY_CLASS: Record<DueUrgency, string> = {
  overdue: 'text-destructive',
  urgent: 'text-pending',
  soon: 'text-primary',
  normal: 'text-muted-foreground',
}

function computeInvoiceDue(
  invoice: Invoice,
  bank: Bank | undefined,
  today: Date = new Date(),
): { text: string; urgency: DueUrgency; diffDays: number } {
  if (!bank) return { text: '', urgency: 'normal', diffDays: 999 }

  today = new Date(today)
  today.setHours(0, 0, 0, 0)

  const isOpen = invoice.status === InvoiceStatus.OPEN

  if (isOpen) {
    // Data congelada da fatura, não recalculada pelo cartão.
    const close = parseInvoiceDate(invoice.closeDate)
    const closeDiff = civilDaysUntil(close, today)
    if (closeDiff >= 0) {
      // A urgência aqui é própria deste painel (fechar hoje é tratado como
      // crítico, porque depois disso a fatura já não aceita ajuste fácil); só
      // o TEXTO passou a vir do helper compartilhado.
      return {
        text: formatCloseTiming(close, today),
        urgency:
          closeDiff === 0 ? 'overdue' : closeDiff <= 2 ? 'urgent' : 'soon',
        diffDays: closeDiff,
      }
    }
    // Fechamento já passou mas o status ainda é OPEN (cron atrasado) — segue
    // para o vencimento, senão a linha não explicaria por que está ali.
  }

  const due = parseInvoiceDate(invoice.dueDate)
  const diffDays = civilDaysUntil(due, today)
  return {
    text: formatDueTiming(due, today),
    urgency: diffDays <= 0 ? 'overdue' : 'urgent',
    diffDays,
  }
}

/**
 * Erro de carregamento de um widget.
 *
 * Existe porque os widgets da Visão Geral têm queries INDEPENDENTES: se as
 * categorias falham e o painel de atenção carrega, o certo é errar só ali. A
 * alternativa — um estado de erro global — apagaria informação que chegou bem.
 *
 * Sem isso, uma falha de API renderizava "Sem gastos no período": o app
 * afirmando que o usuário não gastou nada quando apenas não conseguiu saber.
 */
function WidgetError({
  message,
  isFetching,
  onRetry,
}: {
  message: string
  isFetching: boolean
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center py-12 text-center"
    >
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-destructive/10">
        <TriangleAlert className="size-5 text-destructive/70" aria-hidden />
      </div>
      <p className="text-sm font-medium">{message}</p>
      <p className="mt-1 max-w-[26ch] text-xs text-muted-foreground">
        Verifique sua conexão e tente novamente.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4 gap-1.5"
        disabled={isFetching}
        onClick={onRetry}
      >
        {isFetching ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <RotateCcw className="size-3.5" aria-hidden />
        )}
        {isFetching ? 'Carregando…' : 'Tentar novamente'}
      </Button>
    </div>
  )
}

// ─── Category breakdown ───────────────────────────────────────────────────────

interface CategoryRowData {
  categoryId: string
  name: string
  color?: string
  icon?: string
  amount: number
  pct: number
}

const CategoryBar = memo(function CategoryBar({
  name,
  color,
  icon,
  amount,
  pct,
  index,
  href,
}: CategoryRowData & { index: number; href: string }) {
  const { Icon } = resolveCategoryIcon(icon)
  const barColor = color ?? 'oklch(0.640 0.210 272)'

  /*
    Categoria líquida negativa: os estornos do período passaram do gasto.

    A barra fica vazia (`pct` já vem 0) e o valor usa o token de recebido —
    voltou dinheiro. Sem isso a linha exibiria "-R$ 50" com a cor de despesa,
    lendo como um gasto negativo.
  */
  const isNetRefund = amount < 0

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg py-2.5 transition-colors hover:bg-muted/30 -mx-2 px-2"
    >
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `color-mix(in oklch, ${barColor} 15%, transparent)` }}
      >
        <Icon
          aria-hidden="true"
          className="size-3.5"
          style={{ color: barColor }}
        />
      </div>

      <span className="w-28 shrink-0 truncate text-sm font-medium">{name}</span>

      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ backgroundColor: barColor }}
          initial={{ width: '0%' }}
          animate={{ width: `${pct}%` }}
          transition={{
            duration: 0.55,
            ease: EASE_OUT_EXPO,
            delay: index * 0.04,
          }}
        />
      </div>

      <span
        className={cn(
          'w-[6.5rem] shrink-0 text-right text-sm tabular-nums tracking-[-0.01em]',
          isNetRefund && 'text-receivable',
        )}
      >
        {formatCurrency(amount)}
      </span>

      <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {isNetRefund ? '—' : `${pct.toFixed(0)}%`}
      </span>

      <ExternalLink className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50" aria-hidden />
    </Link>
  )
})

function CategoryBreakdown({
  rows,
  total,
  isLoading,
  isError,
  isFetching,
  onRetry,
  startDate,
  endDate,
}: {
  rows: CategoryRowData[]
  /** Soma das linhas — por construção igual ao gasto próprio do período. */
  total: number
  isLoading: boolean
  isError: boolean
  isFetching: boolean
  onRetry: () => void
  startDate: string
  endDate: string
}) {
  return (
    <section aria-label="Seus gastos por categoria">
      {/* "Seus" porque o total exclui compras feitas para outras pessoas. */}
      <h2 className="text-[15px] font-semibold tracking-tight">
        Seus gastos por categoria
        {/*
          O total fica no cabeçalho para a reconciliação ser visível: a soma
          das linhas é exatamente este número.
        */}
        {!isLoading && !isError && rows.length > 0 && (
          <span className="ml-1.5 font-normal text-muted-foreground">
            · {formatCurrency(total)}
          </span>
        )}
      </h2>
      <p className="mb-4 mt-0.5 text-[11px] text-muted-foreground">
        Sem as compras de outras pessoas
      </p>

      {isLoading ? (
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5">
              <Skeleton className="size-7 rounded-lg" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-1.5 flex-1 rounded-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <WidgetError
          message="Não foi possível carregar seus gastos"
          isFetching={isFetching}
          onRetry={onRetry}
        />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted/40">
            <ShoppingBag className="size-5 text-muted-foreground/60" />
          </div>
          <p className="text-sm font-medium">Sem gastos no período</p>
          <p className="mt-1 max-w-[24ch] text-xs text-muted-foreground">
            Nenhuma despesa registrada neste mês.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {rows.map((row, i) => (
            <CategoryBar
              key={row.categoryId}
              {...row}
              index={i}
              href={`/transactions?startDate=${startDate}&endDate=${endDate}&categoryId=${row.categoryId}&invoicePeriod=true`}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Attention panel ──────────────────────────────────────────────────────────

function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  const { label, className } = invoiceStatusConfig(status)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        className,
      )}
    >
      {label}
    </span>
  )
}


/** Círculo tonal compartilhado das rows deste painel — vermelho quando overdue. */
function AttentionRowIcon({ icon: Icon, isOverdue }: { icon: LucideIcon; isOverdue: boolean }) {
  return (
    <div
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-lg',
        isOverdue ? 'bg-destructive/10' : 'bg-muted/40',
      )}
    >
      <Icon className={cn('size-3.5', isOverdue ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true" />
    </div>
  )
}

function InvoiceAttentionRow({
  invoice,
  banks,
  today,
}: {
  invoice: Invoice
  banks: Bank[]
  today: Date
}) {
  const bank = banks.find((b) => b.id === invoice.bankId)
  const monthYear = capitalize(formatMonthYear(invoice.month, invoice.year))
  const total = Number(invoice.totalAmount)
  const { text: dueText, urgency } = computeInvoiceDue(invoice, bank, today)
  const isOverdue = urgency === 'overdue'
  const name = bankDisplayName(bank, 'Banco')

  return (
    <FinancialListRow
      href={`/banks/${invoice.bankId}/invoices?invoiceId=${invoice.id}`}
      ariaLabel={`Fatura de ${name}, ${monthYear}, ${formatCurrency(total)}${dueText ? `, ${dueText}` : ''}`}
      leading={<AttentionRowIcon icon={CreditCard} isOverdue={isOverdue} />}
      title={name}
      titleAdornment={<InvoiceBadge status={invoice.status} />}
      meta={
        <>
          <span className="truncate">Fatura de {monthYear}</span>
          {dueText && (
            <>
              <span aria-hidden="true">·</span>
              <span className={DUE_URGENCY_CLASS[urgency]}>{dueText}</span>
            </>
          )}
        </>
      }
      trailing={
        <span className={cn(ROW_AMOUNT_CLASS, isOverdue && 'text-destructive')}>
          {formatCurrency(total)}
        </span>
      }
    />
  )
}

function DebtAttentionRow({ debt, today }: { debt: Debt; today: Date }) {
  const urgency = attentionDueUrgency(debt.dueDate, today)
  const dueText = formatDueDate(debt.dueDate)
  const counterpart = debt.person?.name ?? debt.creditorName
  const isOverdue = urgency === 'overdue'

  return (
    <FinancialListRow
      href={`/debts?highlight=${debt.id}`}
      ariaLabel={`${debt.title}, ${formatCurrency(Number(debt.amount))}, ${dueText}`}
      leading={<AttentionRowIcon icon={HandCoins} isOverdue={isOverdue} />}
      title={debt.title}
      meta={
        <span className="truncate">
          {counterpart ? `${counterpart} · ` : ''}
          <span className={DUE_URGENCY_CLASS[urgency]}>{dueText}</span>
        </span>
      }
      trailing={
        <span className={cn(ROW_AMOUNT_CLASS, isOverdue && 'text-destructive')}>
          {formatCurrency(Number(debt.amount))}
        </span>
      }
    />
  )
}

function ReceivableAttentionRow({ receivable, today }: { receivable: Receivable; today: Date }) {
  const urgency = attentionDueUrgency(receivable.dueDate, today)
  const dueText = formatDueDate(receivable.dueDate)
  const counterpart = receivable.person?.name ?? receivable.debtorName
  const isOverdue = urgency === 'overdue'

  return (
    <FinancialListRow
      href={`/receivables?highlight=${receivable.id}`}
      ariaLabel={`${receivable.title}, ${formatCurrency(Number(receivable.amount))}, ${dueText}`}
      leading={<AttentionRowIcon icon={Wallet} isOverdue={isOverdue} />}
      title={receivable.title}
      meta={
        <span className="truncate">
          {counterpart ? `${counterpart} · ` : ''}
          <span className={DUE_URGENCY_CLASS[urgency]}>{dueText}</span>
        </span>
      }
      trailing={
        <span className={cn(ROW_AMOUNT_CLASS, isOverdue && 'text-destructive')}>
          {formatCurrency(Number(receivable.amount))}
        </span>
      }
    />
  )
}

function AttentionSection({
  title,
  icon: Icon,
  href,
  remaining,
  children,
}: {
  title: string
  icon: LucideIcon
  href: string
  remaining: number
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1.5">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] font-medium text-muted-foreground">{title}</span>
      </div>
      <div className="divide-y divide-border/50">{children}</div>
      {remaining > 0 && (
        <Link
          href={href}
          className="mt-1 flex items-center gap-1 pt-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
          Ver {remaining} {remaining === 1 ? 'item' : 'itens'} a mais
        </Link>
      )}
    </div>
  )
}

/**
 * Só o conteúdo já resolvido (loading/error/empty ficam a cargo do
 * `CalendarSection`, chamador único desta rodada — evita duplicar os três
 * estados em dois lugares).
 */
function AttentionPanel({
  invoices,
  banks,
  debts,
  debtsTotal,
  receivables,
  receivablesTotal,
  windowStr,
  today,
}: {
  invoices: Invoice[]
  banks: Bank[]
  debts: Debt[]
  debtsTotal: number
  receivables: Receivable[]
  receivablesTotal: number
  windowStr: string
  today: Date
}) {
  return (
    <div aria-label="Itens que requerem atenção" className="space-y-5">
      {invoices.length > 0 && (
        <AttentionSection title="Faturas" icon={CreditCard} href="/banks" remaining={0}>
          {invoices.map((inv) => (
            <InvoiceAttentionRow key={inv.id} invoice={inv} banks={banks} today={today} />
          ))}
        </AttentionSection>
      )}

      {debts.length > 0 && (
        <AttentionSection
          title="Dívidas"
          icon={HandCoins}
          href={`/debts?endDate=${windowStr}`}
          remaining={debtsTotal - debts.length}
        >
          {debts.map((d) => (
            <DebtAttentionRow key={d.id} debt={d} today={today} />
          ))}
        </AttentionSection>
      )}

      {receivables.length > 0 && (
        <AttentionSection
          title="A receber"
          icon={Wallet}
          href={`/receivables?endDate=${windowStr}`}
          remaining={receivablesTotal - receivables.length}
        >
          {receivables.map((r) => (
            <ReceivableAttentionRow key={r.id} receivable={r} today={today} />
          ))}
        </AttentionSection>
      )}
    </div>
  )
}

// ─── Calendar section ────────────────────────────────────────────────────────

/**
 * Cor do ponto/valor por DIREÇÃO do dinheiro, não por status.
 *
 * São conceitos distintos e a versão anterior os confundia: recebível pendente
 * usava o verde de "recebido", então dinheiro que TALVEZ entre era pintado como
 * dinheiro que entrou. E uma saída já paga continua sendo saída — status
 * concluído não a torna positiva.
 */
const CAL_DIRECTION_DOT: Record<CalEventDirection, string> = {
  out: 'bg-destructive',
  in: 'bg-receivable',
  // Pendente: atenção, não conclusão.
  neutral: 'bg-pending',
}

const CAL_DIRECTION_AMOUNT: Record<CalEventDirection, string> = {
  out: 'text-destructive',
  in: 'text-receivable',
  neutral: 'text-pending',
}

/** Sinal explícito por direção, seguindo a convenção global. */
function signedLabel(event: CalEvent): string {
  const value = formatCurrency(event.amount)
  if (event.direction === 'in') return `+${value}`
  if (event.direction === 'out') return `-${value}`
  return value
}

/** Ícone tonal de um evento do calendário — um ponto colorido por DIREÇÃO. */
function CalendarEventLeading({ direction }: { direction: CalEventDirection }) {
  return (
    <div className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', 'bg-muted/40')}>
      <span className={cn('size-2 rounded-full', CAL_DIRECTION_DOT[direction])} aria-hidden />
    </div>
  )
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/**
 * Painel contextual: "Hoje"/dia selecionado vs. "Atenção agora" — Overview
 * Agenda V1.
 *
 * Duas perguntas de produto diferentes (§1 da especificação): o calendário
 * responde "o que acontece NESTE DIA?", Atenção agora responde "o que ainda
 * exige minha atenção AGORA?". Compartilham o mesmo container visual (Tabs,
 * primitive já existente do design system — nada novo criado), mas cada
 * painel mantém sua própria fonte e sua própria régua temporal.
 */
function CalendarSection({
  year,
  month,
  debts,
  receivables,
  invoices,
  transactions,
  banks,
  isLoading,
  isError,
  isFetching,
  onRetry,
  attentionInvoices,
  attentionDebts,
  attentionDebtsTotal,
  attentionReceivables,
  attentionReceivablesTotal,
  attentionLoading,
  attentionError,
  attentionFetching,
  onRetryAttention,
  attentionWindowEnd,
}: {
  year: number
  month: number
  debts: Debt[]
  receivables: Receivable[]
  invoices: Invoice[]
  /** Movimentações diretas do mês — o calendário antes ignorava todas. */
  transactions: Transaction[]
  banks: Bank[]
  isLoading: boolean
  /** Alguma fonte falhou: o mês está incompleto. */
  isError: boolean
  isFetching: boolean
  onRetry: () => void
  attentionInvoices: Invoice[]
  attentionDebts: Debt[]
  attentionDebtsTotal: number
  attentionReceivables: Receivable[]
  attentionReceivablesTotal: number
  attentionLoading: boolean
  attentionError: boolean
  attentionFetching: boolean
  onRetryAttention: () => void
  attentionWindowEnd: string
}) {
  /*
    "Hoje" (TZ3): conta com `User.timeZone` configurado usa a timezone
    financeira da conta; conta legada (`timeZone === null`) preserva EXATO
    o fuso local do navegador, como sempre foi.
  */
  const { user } = useAuth()
  const today = useMemo(() => accountTodayDate(user?.timeZone ?? null), [user?.timeZone])
  const todayStr = useMemo(() => accountToday(user?.timeZone ?? null), [user?.timeZone])
  const [todayYear, todayMonth, todayDate] = todayStr.split('-').map(Number)
  const isCurrentMonth = todayYear === year && todayMonth === month
  const todayDay = isCurrentMonth ? todayDate : -1

  /*
    §3/§5: mês atual inicia com hoje selecionado; outro mês inicia neutro
    (null — nenhum "hoje" artificial). `key={year-month}` no ponto de uso
    remonta este componente a cada troca de mês, então este useState só
    precisa resolver o valor inicial corretamente uma vez por montagem.
  */
  const [selectedDay, setSelectedDay] = useState<number | null>(
    isCurrentMonth ? todayDate : null,
  )
  const [mode, setMode] = useState<'day' | 'attention'>('day')

  /** Nome por id: evita `banks.find()` dentro do laço de faturas. */
  const bankNames = useMemo(
    () => new Map(banks.map((bank) => [bank.id, bank.name])),
    [banks],
  )

  const eventsByDay = useMemo(
    () =>
      buildCalendarEvents({
        year,
        month,
        debts,
        receivables,
        invoices,
        transactions,
        bankNames,
        today: todayStr,
      }),
    [year, month, debts, receivables, invoices, transactions, bankNames, todayStr],
  )

  const firstDOW = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: Array<number | null> = [
    ...Array(firstDOW).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const selectedEvents = eventsForDay(eventsByDay, selectedDay)
  const isTodaySelected = selectedDay !== null && selectedDay === todayDay
  const dayLabel = selectedDay === null
    ? 'Selecione um dia'
    : isTodaySelected
      ? 'Hoje'
      : `Dia ${selectedDay}`

  const attentionAllEmpty =
    attentionInvoices.length === 0 &&
    attentionDebts.length === 0 &&
    attentionReceivables.length === 0

  return (
    <section aria-label="Calendário e itens que requerem atenção">
      <div className="grid w-full min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <div className="min-w-0">
      <h2 className="text-[15px] font-semibold tracking-tight">Calendário</h2>
      <p className="mb-4 mt-0.5 text-[11px] text-muted-foreground">
        Vencimentos e movimentações com data neste mês
      </p>

      {/*
        Enquanto qualquer fonte carrega, o grid fica em skeleton.

        Renderizar o calendário parcial faria "nenhum evento" piscar em dias
        que na verdade têm eventos ainda em trânsito.
      */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full rounded-lg" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {/*
            Erro parcial: o que carregou continua visível, com aviso de que
            falta coisa. Esconder tudo perderia informação boa; não avisar
            afirmaria que os eventos ausentes não existem.
          */}
          {isError && (
            <div
              role="alert"
              className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-pending/25 bg-pending/5 px-3 py-2"
            >
              <TriangleAlert className="size-3.5 shrink-0 text-pending" aria-hidden />
              <p className="flex-1 text-xs text-muted-foreground">
                Alguns eventos não puderam ser carregados.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={isFetching}
                onClick={onRetry}
              >
                {isFetching ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="size-3" aria-hidden />
                )}
                Tentar novamente
              </Button>
            </div>
          )}

          {/* Weekday headers */}
          <div className="grid grid-cols-7 rounded-t-lg border-b border-border/70 px-1 py-1.5">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-0.5 text-center text-[11px] font-medium text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-b-lg bg-border/30 p-px">
            {cells.map((day, idx) => {
              if (day === null) return <div key={`e-${idx}`} />

              const events = eventsForDay(eventsByDay, day)
              const isToday = day === todayDay
              const isSelected = day === selectedDay
              const isPast = isCurrentMonth && day < todayDay
              const directions = [
                ...new Set(events.map((e: CalEvent) => e.direction)),
              ]
              const hasEvents = events.length > 0

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    setSelectedDay(isSelected ? null : day)
                    setMode('day')
                  }}
                  aria-pressed={isSelected || undefined}
                  aria-label={`Dia ${day}${hasEvents ? `, ${events.length} item${events.length > 1 ? 's' : ''}` : ''}`}
                  className={cn(
                    'flex min-w-0 flex-col items-center gap-1 rounded-md bg-card/80 py-1.5 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring sm:py-2',
                    isSelected ? 'bg-muted/80' : 'hover:bg-muted/50',
                    isPast && 'opacity-40',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full text-[13px] font-medium leading-none',
                      isToday ? 'bg-primary text-primary-foreground' : 'text-foreground',
                    )}
                  >
                    {day}
                  </span>
                  <div className="flex min-h-[6px] items-center gap-0.5">
                    {directions.slice(0, 3).map((direction) => (
                      <span
                        key={direction}
                        className={cn('size-1.5 rounded-full', CAL_DIRECTION_DOT[direction])}
                        aria-hidden
                      />
                    ))}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Legenda: direção do dinheiro, que é o que as cores codificam. */}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
            {(
              [
                ['out', 'Saída / vencimento'],
                ['in', 'Entrada'],
                ['neutral', 'Pendente'],
              ] as [CalEventDirection, string][]
            ).map(([direction, label]) => (
              <div key={direction} className="flex items-center gap-1.5">
                <span className={cn('size-2 shrink-0 rounded-full', CAL_DIRECTION_DOT[direction])} aria-hidden />
                <span className="text-[11px] text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>

          {/* ─── Painel contextual: Hoje/dia selecionado × Atenção agora ─── */}
          </>
        )}
        </div>
        <div className="rounded-xl border border-border/60 bg-card/30 p-4 sm:p-5 lg:mt-0">
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'day' | 'attention')}>
              <TabsList>
                <TabsTrigger value="day">{dayLabel}</TabsTrigger>
                <TabsTrigger value="attention">Atenção agora</TabsTrigger>
              </TabsList>

              <TabsContent value="day">
                {selectedDay === null ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Selecione um dia no calendário para ver os fatos daquele dia.
                  </p>
                ) : selectedEvents.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Nenhum evento financeiro {isTodaySelected ? 'hoje' : `no dia ${selectedDay}`}.
                  </p>
                ) : (
                  <div className="divide-y divide-border/50">
                    {selectedEvents.map((ev: CalEvent) => (
                      <FinancialListRow
                        key={ev.id}
                        href={ev.href}
                        ariaLabel={`${CAL_KIND_LABEL[ev.kind]}: ${ev.title}, ${signedLabel(ev)}, ${ev.status}${
                          ev.detail ? `. ${ev.detail}` : ''
                        }`}
                        leading={<CalendarEventLeading direction={ev.direction} />}
                        title={ev.title}
                        meta={
                          <span className="truncate">
                            {CAL_KIND_LABEL[ev.kind]} · {ev.status}
                          </span>
                        }
                        belowMeta={
                          ev.detail && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground/70">{ev.detail}</p>
                          )
                        }
                        trailing={
                          <span className={cn(ROW_AMOUNT_CLASS, CAL_DIRECTION_AMOUNT[ev.direction])}>
                            {signedLabel(ev)}
                          </span>
                        }
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="attention">
                {/*
                  Este painel responde ao PRESENTE, não ao mês exibido no
                  calendário acima — navegar para julho não muda o que exige
                  atenção hoje. Ver `overview-attention.ts`.
                */}
                <p className="mb-3 text-[11px] text-muted-foreground">
                  Independente do mês exibido no calendário
                </p>
                {attentionLoading ? (
                  <div className="space-y-5 py-1">
                    {[3, 2].map((count, s) => (
                      <div key={s} className="space-y-0">
                        <Skeleton className="mb-2 h-3 w-16" />
                        {Array.from({ length: count }).map((_, i) => (
                          <div key={i} className="flex items-center gap-3 py-3">
                            <Skeleton className="size-7 shrink-0 rounded-lg" />
                            <div className="flex flex-1 flex-col gap-1.5">
                              <Skeleton className="h-3.5 w-32" />
                              <Skeleton className="h-3 w-24" />
                            </div>
                            <Skeleton className="h-4 w-20" />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : attentionError ? (
                  <WidgetError
                    message="Não foi possível carregar as pendências"
                    isFetching={attentionFetching}
                    onRetry={onRetryAttention}
                  />
                ) : attentionAllEmpty ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-receivable/10">
                      <CheckCircle2 className="size-5 text-receivable" />
                    </div>
                    <p className="text-sm font-medium">Tudo em dia</p>
                    <p className="mt-1 max-w-[22ch] text-xs text-muted-foreground">
                      Nenhum item vence nos próximos {ATTENTION_DAYS_WINDOW} dias.
                    </p>
                  </div>
                ) : (
                  <AttentionPanel
                    invoices={attentionInvoices}
                    banks={banks}
                    debts={attentionDebts}
                    debtsTotal={attentionDebtsTotal}
                    receivables={attentionReceivables}
                    receivablesTotal={attentionReceivablesTotal}
                    windowStr={attentionWindowEnd}
                    today={today}
                  />
                )}
              </TabsContent>
            </Tabs>
          </div>
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/*
function AttentionNowSection({
  invoices,
  banks,
  debts,
  debtsTotal,
  receivables,
  receivablesTotal,
  isLoading,
  isError,
  isFetching,
  onRetry,
  windowStr,
  today,
}: {
  invoices: Invoice[]
  banks: Bank[]
  debts: Debt[]
  debtsTotal: number
  receivables: Receivable[]
  receivablesTotal: number
  isLoading: boolean
  isError: boolean
  isFetching: boolean
  onRetry: () => void
  windowStr: string
  today: Date
}) {
  const isEmpty = invoices.length === 0 && debts.length === 0 && receivables.length === 0

  return (
    <section aria-label="Itens que requerem atenção">
      <h2 className="text-[15px] font-semibold tracking-tight">Atenção agora</h2>
      <p className="mb-4 mt-0.5 text-[11px] text-muted-foreground">
        Pendências independentes do mês exibido
      </p>
      {isLoading ? (
        <div className="space-y-5 py-1">
          {[3, 2].map((count, sectionIndex) => (
            <div key={sectionIndex} className="space-y-0">
              <Skeleton className="mb-2 h-3 w-16" />
              {Array.from({ length: count }).map((_, itemIndex) => (
                <div key={itemIndex} className="flex items-center gap-3 py-3">
                  <Skeleton className="size-7 shrink-0 rounded-lg" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : isError ? (
        <WidgetError message="Não foi possível carregar as pendências" isFetching={isFetching} onRetry={onRetry} />
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-receivable/10">
            <CheckCircle2 className="size-5 text-receivable" />
          </div>
          <p className="text-sm font-medium">Tudo em dia</p>
          <p className="mt-1 max-w-[22ch] text-xs text-muted-foreground">
            Nenhum item vence nos próximos {ATTENTION_DAYS_WINDOW} dias.
          </p>
        </div>
      ) : (
        <AttentionPanel
          invoices={invoices}
          banks={banks}
          debts={debts}
          debtsTotal={debtsTotal}
          receivables={receivables}
          receivablesTotal={receivablesTotal}
          windowStr={windowStr}
          today={today}
        />
      )}
    </section>
  )
}

*/
export default function OverviewPage() {
  // O mês é contexto do app, controlado pela barra superior.
  const { period } = useMonthPeriod()
  const { month, year } = period
  const { user } = useAuth()
  const attentionToday = useMemo(
    () => accountTodayDate(user?.timeZone ?? null),
    [user?.timeZone],
  )

  const { startDate, endDate } = useMemo(() => monthRange(year, month), [year, month])

  // ── Queries ──
  const {
    data: transactions,
    isLoading: txLoading,
    isError: txError,
    isFetching: txFetching,
    refetch: refetchTx,
  } = useQuery({
    queryKey: ['transactions', { startDate, endDate, invoicePeriod: true }],
    queryFn: () => getTransactions({ startDate, endDate, invoicePeriod: true }),
  })

  const {
    data: invoices = [],
    isLoading: invLoading,
    isError: invError,
    isFetching: invFetching,
    refetch: refetchInvoices,
  } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => getInvoices(),
  })

  const { data: banks = [] } = useQuery({
    queryKey: ['banks'],
    queryFn: () => getBanks(),
  })

  const {
    data: debts = [],
    isLoading: debtLoading,
    isError: debtError,
    isFetching: debtFetching,
    refetch: refetchDebts,
  } = useQuery({
    queryKey: ['debts'],
    queryFn: () => getDebts(),
  })

  const {
    data: receivables = [],
    isLoading: recLoading,
    isError: recError,
    isFetching: recFetching,
    refetch: refetchReceivables,
  } = useQuery({
    queryKey: ['receivables'],
    queryFn: () => getReceivables(),
  })

  const attentionLoading = invLoading || debtLoading || recLoading
  /*
    O painel junta três fontes: se qualquer uma falhar, o conjunto está
    incompleto e mostrar o resto como se fosse tudo seria enganoso.
  */
  const attentionError = invError || debtError || recError
  const attentionFetching = invFetching || debtFetching || recFetching

  /*
    O calendário depende de quatro fontes. Se qualquer uma falhar, o mês está
    INCOMPLETO — e mostrar o resto sem avisar afirmaria que não há eventos
    daquele tipo.
  */
  const calendarLoading = txLoading || invLoading || debtLoading || recLoading
  const calendarError = txError || invError || debtError || recError
  const calendarFetching =
    txFetching || invFetching || debtFetching || recFetching

  function retryCalendar() {
    void refetchTx()
    void refetchInvoices()
    void refetchDebts()
    void refetchReceivables()
  }

  function retryAttention() {
    void refetchInvoices()
    void refetchDebts()
    void refetchReceivables()
  }

  // ── Derived data ──
  // Aqui a pergunta é "quanto EU gastei", não "o que passou pelo cartão":
  // compras feitas para outra pessoa voltam como A Receber e não são custo do
  // usuário. Estornos abatem a própria categoria, em vez de sumir do total —
  // mesma regra já usada no detalhe da fatura.
  const categoryRows = useMemo((): CategoryRowData[] => {
    if (!transactions) return []
    // Saídas próprias mais os estornos próprios: o estorno precisa entrar para
    // poder abater a categoria (o filtro de saída sozinho o excluiria).
    const ownExpenses = transactions.filter(
      (t) => !t.personId && (isOwnExpense(t) || isRefundTransaction(t)),
    )
    const grouped = new Map<string, { amount: number; name: string; color?: string; icon?: string }>()

    for (const tx of ownExpenses) {
      const signed = expenseSignedAmount(tx)
      const existing = grouped.get(tx.categoryId)
      if (existing) {
        existing.amount += signed
      } else {
        grouped.set(tx.categoryId, {
          amount: signed,
          name: tx.category?.name ?? 'Sem categoria',
          color: tx.category?.color,
          icon: tx.category?.icon,
        })
      }
    }

    /*
      Categoria com estorno maior que o gasto CONTINUA na lista.

      Antes ela era descartada por `amount > 0`, e a soma das linhas exibidas
      deixava de fechar com o total de gastos próprios: com R$ 300 em
      Restaurantes, R$ 350 de estorno e R$ 200 em Mercado, a tela mostrava
      R$ 200 enquanto o gasto real do mês era R$ 150. Sumir com a linha
      esconde justamente o fato interessante — o estorno que passou do gasto.

      O que precisa ser tratado é a BARRA, que não aceita largura negativa.
    */
    const entries = Array.from(grouped.entries()).filter(
      ([, value]) => value.amount !== 0,
    )

    /*
      Denominador do percentual: só as categorias positivas.

      Usar a soma líquida (que pode ser zero ou negativa) produziria
      Infinity/NaN e barras absurdas. Uma categoria negativa não tem
      "percentual do gasto" — ela devolveu dinheiro.
    */
    const positiveTotal = entries.reduce(
      (sum, [, value]) => (value.amount > 0 ? sum + value.amount : sum),
      0,
    )

    return entries
      .map(([categoryId, { amount, name, color, icon }]) => ({
        categoryId,
        name,
        color,
        icon,
        amount,
        pct:
          amount > 0 && positiveTotal > 0 ? (amount / positiveTotal) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [transactions])

  /**
   * Total de gastos próprios do período — a mesma base das categorias.
   *
   * Existe para a tela poder AFIRMAR a reconciliação em vez de deixar o
   * usuário somar linhas: por construção,
   * `sum(categoryRows.amount) === ownExpenseTotal`.
   */
  const ownExpenseTotal = useMemo(
    () => categoryRows.reduce((sum, row) => sum + row.amount, 0),
    [categoryRows],
  )

  /*
    Seleção de "Atenção agora" — extraída para `overview-attention.ts`
    (Overview Agenda V1). Mesmas regras de antes: current-state, sempre
    relativo a hoje, nunca ao mês navegado no calendário abaixo.
  */
  const attention = useMemo(
    () => buildAttentionSelection({ invoices, banks, debts, receivables }, attentionToday),
    [invoices, banks, debts, receivables, attentionToday],
  )

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visão Geral</h1>
        {/* O recorte é a competência da fatura, não a data da compra: uma
            compra depois do fechamento pesa no mês da fatura que a recebeu.
            Por isso este mês pode divergir do mesmo mês no Extrato. */}
        <p className="mt-0.5 text-sm text-muted-foreground">
          O que pesa no mês, pela fatura em que cada gasto caiu
        </p>
      </div>

      {/*
        Calendário + Atenção agora (Overview Agenda V1) — primeira e
        principal superfície. `key` por competência: trocar de mês remonta a
        seção, reavaliando o estado inicial de `selectedDay` (hoje no mês
        atual, neutro em outro mês) sem um efeito chamando `setState`.
      */}
      <CalendarSection
        key={`${year}-${month}`}
        year={year}
        month={month}
        debts={debts}
        receivables={receivables}
        invoices={invoices}
        /*
          Reusa a MESMA resposta que alimenta as categorias — nenhuma request
          nova. A query já traz crédito pela competência da fatura e os
          diretos pela data, que é exatamente o que o calendário precisa.
        */
        transactions={transactions ?? []}
        banks={banks}
        isLoading={calendarLoading}
        isError={calendarError}
        isFetching={calendarFetching}
        onRetry={retryCalendar}
        attentionInvoices={attention.invoices}
        attentionDebts={attention.debts}
        attentionDebtsTotal={attention.debtsAll.length}
        attentionReceivables={attention.receivables}
        attentionReceivablesTotal={attention.receivablesAll.length}
        attentionLoading={attentionLoading}
        attentionError={attentionError}
        attentionFetching={attentionFetching}
        onRetryAttention={retryAttention}
        attentionWindowEnd={attention.windowEnd}
      />

      {/* Gastos por categoria — segunda superfície nesta rodada (§0/§23/§24). */}
      <div className="border-t border-border pt-6">
        <CategoryBreakdown
          rows={categoryRows}
          total={ownExpenseTotal}
          isLoading={txLoading}
          isError={txError}
          isFetching={txFetching}
          onRetry={() => void refetchTx()}
          startDate={startDate}
          endDate={endDate}
        />
      </div>
    </div>
  )
}
