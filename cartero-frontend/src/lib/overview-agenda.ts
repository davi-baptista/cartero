import type { Bank, Debt, Invoice, Receivable } from '@/types'
import type { AttentionDueUrgency } from '@/lib/overview-attention'
import { attentionDueUrgency } from '@/lib/overview-attention'
import type { CalEvent, CalEventKind } from '@/lib/calendar-events'

export type AgendaEntry = {
  id: string
  kind: CalEventKind
  title: string
  amount: number
  status: string
  direction: CalEvent['direction']
  href: string
  detail?: string
  personId?: string
  personName?: string
  settled?: boolean
  urgency?: AttentionDueUrgency
  dueDate?: string
  invoice?: Invoice
  bankName?: string
}

export type AgendaGroup = {
  key: string
  kind: CalEventKind
  personId?: string
  personName?: string
  entries: AgendaEntry[]
}

export type LimitedAgenda = {
  visible: AgendaGroup[]
  hiddenItems: number
}

function entryFromEvent(event: CalEvent): AgendaEntry {
  return {
    id: event.id,
    kind: event.kind,
    title: event.title,
    amount: event.amount,
    status: event.status,
    direction: event.direction,
    href: event.href,
    detail: event.detail,
    personId: event.personId,
    personName: event.personName,
    settled: event.settled,
  }
}

function groupKey(entry: AgendaEntry, mode: 'selected' | 'attention'): string {
  if (entry.personId && entry.personName) {
    if (mode === 'selected') return `${entry.kind}:${entry.personId}:${entry.settled ? 'settled' : 'open'}`
    return `${entry.kind}:${entry.personId}:${entry.urgency ?? 'normal'}`
  }
  return entry.id
}

function groupOldestDueDate(group: AgendaGroup): string | undefined {
  const dates = group.entries
    .map((entry) => entry.dueDate ?? entry.invoice?.dueDate)
    .filter((date): date is string => Boolean(date))
    .sort()
  return dates[0]
}

function sortAgendaGroups(groups: AgendaGroup[], mode: 'selected' | 'attention'): AgendaGroup[] {
  if (mode === 'selected') {
    return groups
      .map((group, index) => ({ group, index }))
      .sort((a, b) => {
        const aOpen = a.group.entries.some((entry) => !entry.settled)
        const bOpen = b.group.entries.some((entry) => !entry.settled)
        return Number(bOpen) - Number(aOpen) || a.index - b.index
      })
      .map(({ group }) => group)
  }

  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const aDate = groupOldestDueDate(a.group) ?? '9999-12-31'
      const bDate = groupOldestDueDate(b.group) ?? '9999-12-31'
      return aDate.localeCompare(bDate) || a.index - b.index
    })
    .map(({ group }) => group)
}

export function groupAgendaEntries(
  entries: readonly AgendaEntry[],
  mode: 'selected' | 'attention',
): AgendaGroup[] {
  const groups = new Map<string, AgendaGroup>()

  for (const entry of entries) {
    const key = groupKey(entry, mode)
    const existing = groups.get(key)
    if (existing) {
      existing.entries.push(entry)
      continue
    }

    groups.set(key, {
      key,
      kind: entry.kind,
      personId: entry.personId,
      personName: entry.personName,
      entries: [entry],
    })
  }

  return sortAgendaGroups([...groups.values()], mode)
}

export function groupSelectedDay(events: readonly CalEvent[]): AgendaGroup[] {
  return groupAgendaEntries(events.map(entryFromEvent), 'selected')
}

function invoiceEntry(invoice: Invoice, banks: readonly Bank[]): AgendaEntry {
  const bankName = banks.find((bank) => bank.id === invoice.bankId)?.name ?? 'Banco'
  return {
    id: `invoice:${invoice.id}`,
    kind: 'invoice-due',
    title: bankName,
    amount: Number(invoice.totalAmount),
    status: invoice.status,
    direction: 'out',
    href: `/banks/${invoice.bankId}/invoices?invoiceId=${invoice.id}`,
    invoice,
    bankName,
    settled: invoice.status === 'PAID',
    dueDate: invoice.dueDate,
  }
}

function debtEntry(debt: Debt, today: Date): AgendaEntry {
  return {
    id: `debt:${debt.id}`,
    kind: 'debt',
    title: debt.title,
    amount: Number(debt.amount),
    status: debt.isPaid ? 'Pago' : 'Pendente',
    direction: 'out',
    href: `/debts?highlight=${debt.id}`,
    personId: debt.personId,
    personName: debt.person?.name,
    urgency: attentionDueUrgency(debt.dueDate, today),
    dueDate: debt.dueDate,
    settled: debt.isPaid,
  }
}

function receivableEntry(receivable: Receivable, today: Date): AgendaEntry {
  return {
    id: `receivable:${receivable.id}`,
    kind: 'receivable',
    title: receivable.title,
    amount: Number(receivable.amount),
    status: receivable.isPaid ? 'Recebido' : 'Pendente',
    direction: receivable.isPaid ? 'in' : 'neutral',
    href: `/receivables?highlight=${receivable.id}`,
    personId: receivable.personId,
    personName: receivable.person?.name,
    urgency: attentionDueUrgency(receivable.dueDate, today),
    dueDate: receivable.dueDate,
    settled: receivable.isPaid,
  }
}

export function groupAttention({
  invoices,
  banks,
  debts,
  receivables,
  hiddenIds,
  today,
}: {
  invoices: readonly Invoice[]
  banks: readonly Bank[]
  debts: readonly Debt[]
  receivables: readonly Receivable[]
  hiddenIds: ReadonlySet<string>
  today: Date
}): AgendaGroup[] {
  const entries: AgendaEntry[] = []

  for (const invoice of invoices) {
    const entry = invoiceEntry(invoice, banks)
    if (!hiddenIds.has(entry.id)) entries.push(entry)
  }
  for (const debt of debts) {
    const entry = debtEntry(debt, today)
    if (!hiddenIds.has(entry.id)) entries.push(entry)
  }
  for (const receivable of receivables) {
    const entry = receivableEntry(receivable, today)
    if (!hiddenIds.has(entry.id)) entries.push(entry)
  }

  return groupAgendaEntries(entries, 'attention')
}

export function limitAgenda(groups: readonly AgendaGroup[], limit = 4): LimitedAgenda {
  const visible = groups.slice(0, limit)
  return {
    visible,
    hiddenItems: groups.slice(limit).reduce((total, group) => total + group.entries.length, 0),
  }
}
