'use client'

import { useState, useMemo, memo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { ShoppingBag, CreditCard, HandCoins, Wallet, ExternalLink, TriangleAlert, RotateCcw, Loader2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useMonthPeriod } from '@/components/month-nav'
import { getTransactions } from '@/services/transactions.service'
import { getInvoices } from '@/services/invoices.service'
import { getBanks } from '@/services/banks.service'
import { getDebts } from '@/services/debts.service'
import { getReceivables } from '@/services/receivables.service'
import { formatCurrency, formatMonthYear, formatRelativeDate } from '@/lib/formatters'
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
  type CalEvent,
  type CalEventDirection,
} from '@/lib/calendar-events'
import {
  buildAttentionSelection,
} from '@/lib/overview-attention'
import {
  groupAttention,
  groupSelectedDay,
  limitAgenda,
  type AgendaGroup,
  type AgendaEntry,
} from '@/lib/overview-agenda'
import { FinancialListRow } from '@/components/ui/financial-list-row'
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

type InvoiceDueUrgency = 'overdue' | 'urgent' | 'soon' | 'normal'

function computeInvoiceDue(
  invoice: Invoice,
  bank: Bank | undefined,
  today: Date = new Date(),
): { text: string; urgency: InvoiceDueUrgency; diffDays: number } {
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
        'inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-medium',
        className,
      )}
    >
      {label}
    </span>
  )
}


/** Círculo tonal compartilhado das rows deste painel — vermelho quando overdue. */
function AttentionRowIcon({ icon: Icon, isOverdue, isSettled }: { icon: LucideIcon; isOverdue: boolean; isSettled: boolean }) {
  return (
    <div
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md',
        isSettled ? 'bg-muted/30' : isOverdue ? 'bg-destructive/10' : 'bg-muted/40',
      )}
    >
      <Icon className={cn('size-3.5', !isSettled && isOverdue ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true" />
    </div>
  )
}

function agendaKindLabel(kind: AgendaEntry['kind'], count: number): string {
  const labels = {
    debt: count === 1 ? 'dívida' : 'dívidas',
    receivable: count === 1 ? 'valor a receber' : 'valores a receber',
    'invoice-due': 'fatura',
  }
  return labels[kind]
}

function AgendaSummaryRow({
  group,
  banks,
  today,
}: {
  group: AgendaGroup
  banks: Bank[]
  today: Date
}) {
  const entry = group.entries[0]
  const count = group.entries.length
  const total = group.entries.reduce((sum, item) => sum + item.amount, 0)
  const isSettled = group.entries.every((item) => item.settled)
  const isInvoice = entry.kind === 'invoice-due'
  const invoice = entry.invoice
  const bank = invoice ? banks.find((item) => item.id === invoice.bankId) : undefined
  const urgency = invoice
    ? computeInvoiceDue(invoice, bank, today).urgency
    : entry.urgency
  const isOverdue = urgency === 'overdue' && !isSettled
  const dueText = entry.dueDate ? formatDueDate(entry.dueDate) : undefined
  const title = group.personName ?? entry.title
  const subtitle =
    count > 1
      ? `${count} ${agendaKindLabel(group.kind, count)}${isOverdue ? ' vencidas' : ''}`
      : group.personName && !isInvoice
        ? `${entry.title} · ${dueText ?? entry.status}`
        : isInvoice && invoice
          ? `Fatura de ${capitalize(formatMonthYear(invoice.month, invoice.year))}${dueText ? ` · ${dueText}` : ''}`
          : `${agendaKindLabel(group.kind, count)} · ${dueText ?? entry.status}`
  const href =
    count > 1 && group.personId
      ? `/persons?personId=${group.personId}`
      : entry.href
  const Icon = isInvoice ? CreditCard : group.kind === 'debt' ? HandCoins : Wallet
  const directionClass = group.kind === 'receivable' ? CAL_DIRECTION_AMOUNT[entry.direction] : ''
  const accessible = `${title}, ${subtitle}, ${formatCurrency(total)}`

  return (
    <FinancialListRow
      href={href}
      ariaLabel={accessible}
      leading={<AttentionRowIcon icon={Icon} isOverdue={isOverdue} isSettled={isSettled} />}
      title={<span className={cn(isSettled && 'text-muted-foreground')}>{title}</span>}
      titleAdornment={isInvoice && invoice ? <InvoiceBadge status={invoice.status} /> : undefined}
      meta={<span className="truncate text-xs">{subtitle}</span>}
      trailing={
        <span className={cn('text-sm font-semibold tabular-nums tracking-[-0.02em]', !isSettled && directionClass, isOverdue && 'text-destructive', isSettled && 'text-muted-foreground')}>
          {formatCurrency(total)}
        </span>
      }
      className="gap-2.5 py-2.5 sm:gap-3 sm:py-3"
    />
  )
}

function AgendaSection({
  title,
  groups,
  banks,
  today,
  overflowLabel,
  overflowCount,
}: {
  title: string
  groups: AgendaGroup[]
  banks: Bank[]
  today: Date
  overflowLabel: string
  overflowCount: number
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1.5 text-sm font-semibold tracking-tight">{title}</h3>
      {groups.length > 0 && (
        <div className="divide-y divide-border/50">
          {groups.map((group) => (
            <AgendaSummaryRow key={group.key} group={group} banks={banks} today={today} />
          ))}
        </div>
      )}
      {overflowCount > 0 && (
        <p className="pt-1.5 text-xs text-muted-foreground">
          + {overflowCount} {overflowLabel}
        </p>
      )}
    </section>
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

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/**
 * Agenda contextual: dia selecionado e pendências, sempre visíveis.
 *
 * O calendário responde "o que acontece NESTE DIA?" e pendências respondem
 * "o que ainda exige minha atenção AGORA?". As duas respostas vivem no mesmo
 * painel, sem uma escolha intermediária.
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
  attentionReceivables,
  attentionLoading,
  attentionError,
  attentionFetching,
  onRetryAttention,
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
  attentionReceivables: Receivable[]
  attentionLoading: boolean
  attentionError: boolean
  attentionFetching: boolean
  onRetryAttention: () => void
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
      : formatRelativeDate(`${year}-${String(month).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`)

  const selectedGroups = limitAgenda(groupSelectedDay(selectedEvents), 4)
  const selectedIds = new Set(selectedEvents.map((event) => event.id))
  const attentionGroups = limitAgenda(
    groupAttention({
      invoices: attentionInvoices,
      banks,
      debts: attentionDebts,
      receivables: attentionReceivables,
      hiddenIds: selectedIds,
      today,
    }),
    4,
  )
  const attentionAllEmpty = attentionGroups.visible.length === 0

  return (
    <section aria-label="Calendário e itens que requerem atenção">
      <div className="grid w-full min-w-0 items-start gap-10 lg:gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <div className="min-w-0">
      <h2 className="text-[15px] font-semibold tracking-tight">Calendário</h2>
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
          <div className="grid grid-cols-7 rounded-t-lg border-b border-border px-1 py-1.5">
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
              const dayIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isToday = dayIso === todayStr
              const isSelected = day === selectedDay
              const isPast = dayIso < todayStr
              const hasUnresolvedOverdue = events.some(
                (event) => !event.settled && event.status === 'Em atraso',
              )
              const isHistoricalResolved = isPast && !hasUnresolvedOverdue
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
                  }}
                  aria-pressed={isSelected || undefined}
                  aria-label={`Dia ${day}${hasEvents ? `, ${events.length} item${events.length > 1 ? 's' : ''}` : ''}`}
                  className={cn(
                    'flex min-w-0 flex-col items-center gap-1 rounded-md bg-card/80 py-1.5 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring sm:py-2',
                    isSelected
                      ? 'bg-muted/80'
                      : hasEvents && !isHistoricalResolved
                        ? 'bg-muted/55 hover:bg-muted/65'
                        : hasEvents
                          ? 'bg-muted/35 hover:bg-muted/45'
                        : 'hover:bg-muted/50',
                    isHistoricalResolved && !isSelected && 'opacity-40',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full text-[13px] font-medium leading-none',
                      isToday
                        ? 'bg-primary text-primary-foreground'
                        : isSelected
                          ? 'bg-foreground text-background'
                          : isHistoricalResolved
                            ? 'text-muted-foreground'
                            : 'text-foreground',
                    )}
                  >
                    {day}
                  </span>
                  <div className="flex min-h-[6px] items-center gap-0.5">
                    {directions.slice(0, 3).map((direction) => (
                      <span
                        key={direction}
                         className={cn('size-1.5 rounded-full', CAL_DIRECTION_DOT[direction], isHistoricalResolved && !isSelected && 'opacity-60')}
                        aria-hidden
                      />
                    ))}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Legenda: direção do dinheiro, que é o que as cores codificam. */}
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 sm:mt-4">
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

          {/* ─── Painel contextual: Hoje/dia selecionado × Pendências ─── */}
          </>
        )}
        </div>
        <div className="rounded-xl border border-border/50 bg-card/20 p-3 sm:p-3.5 lg:mt-0">
          <div className="space-y-5">
            <section aria-label={dayLabel}>
              <h3 className="mb-1.5 text-sm font-semibold tracking-tight">{dayLabel}</h3>
              {selectedDay === null ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Selecione um dia no calendário.
                </p>
              ) : selectedEvents.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {isTodaySelected ? 'Nenhum evento hoje.' : 'Nenhum evento neste dia.'}
                </p>
              ) : (
                <div className="divide-y divide-border/50">
                  {selectedGroups.visible.map((group) => (
                    <AgendaSummaryRow key={group.key} group={group} banks={banks} today={today} />
                  ))}
                </div>
              )}
              {selectedGroups.hiddenItems > 0 && (
                <p className="pt-2 text-[11px] text-muted-foreground">
                  + {selectedGroups.hiddenItems} outros eventos
                </p>
              )}
            </section>

            <div className="border-t border-border/60 pt-4">
              {attentionLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-3 w-24" />
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="flex items-center gap-3 py-2">
                      <Skeleton className="size-7 shrink-0 rounded-lg" />
                      <div className="flex flex-1 flex-col gap-1.5">
                        <Skeleton className="h-3.5 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-4 w-20" />
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
                <section aria-label="Pendências">
                  <h3 className="mb-1.5 text-sm font-semibold tracking-tight">Pendências</h3>
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Nenhuma pendência agora.
                  </p>
                </section>
              ) : (
                <AgendaSection
                  title="Pendências"
                  groups={attentionGroups.visible}
                  banks={banks}
                  today={today}
                  overflowLabel="outras pendências"
                  overflowCount={attentionGroups.hiddenItems}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

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
    Seleção de pendências — extraída para `overview-attention.ts`
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
        Calendário + pendências (Overview Agenda V1) — primeira e
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
        attentionDebts={attention.debtsAll}
        attentionReceivables={attention.receivablesAll}
        attentionLoading={attentionLoading}
        attentionError={attentionError}
        attentionFetching={attentionFetching}
        onRetryAttention={retryAttention}
      />

      {/* Gastos por categoria — segunda superfície nesta rodada (§0/§23/§24). */}
      <div className="mt-2 border-t border-border pt-6 sm:mt-0">
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
