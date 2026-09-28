import type { CalEventKind } from '@/lib/calendar-events'

export type AgendaIconKind = 'invoice' | 'debt' | 'receivable' | 'person'

export type AgendaPresentation = {
  iconKind: AgendaIconKind
  iconContainerClass: string
  iconClass: string
  statusText: string
  statusClass: string
}

function lowercaseInline(text: string): string {
  return text.length > 0 ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

function timingStatusClass(text: string): string {
  if (text === 'em atraso' || text.startsWith('venceu ')) return 'text-destructive'
  if (/^(vence|fecha) (hoje|amanhã|em )/.test(text)) {
    return 'text-pending'
  }
  return 'text-destructive'
}

function agendaIconKind(kind: CalEventKind, hasPerson: boolean): AgendaIconKind {
  if (hasPerson) return 'person'
  if (kind === 'invoice-due') return 'invoice'
  return kind === 'debt' ? 'debt' : 'receivable'
}

/** Presentation authority for the Overview contextual agenda only. */
export function resolveAgendaPresentation({
  kind,
  hasPerson,
  statusText,
  isSettled,
}: {
  kind: CalEventKind
  hasPerson: boolean
  statusText: string
  isSettled: boolean
}): AgendaPresentation {
  const text = lowercaseInline(statusText)
  const statusClass = isSettled
    ? 'text-paid'
    : timingStatusClass(text)

  return {
    iconKind: agendaIconKind(kind, hasPerson),
    iconContainerClass: 'bg-muted/50',
    iconClass: 'text-muted-foreground',
    statusText: text,
    statusClass,
  }
}
