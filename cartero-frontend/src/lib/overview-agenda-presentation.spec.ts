import { describe, expect, it } from 'vitest'
import { resolveAgendaPresentation } from './overview-agenda-presentation'

describe('Overview agenda presentation authority', () => {
  it('keeps person glyph neutral while due-today status is orange', () => {
    const presentation = resolveAgendaPresentation({
      kind: 'debt',
      hasPerson: true,
      statusText: 'vence hoje',
      isSettled: false,
    })

    expect(presentation).toMatchObject({
      iconKind: 'person',
      iconContainerClass: 'bg-muted/50',
      iconClass: 'text-muted-foreground',
      statusText: 'vence hoje',
      statusClass: 'text-pending',
    })
  })

  it('keeps domain glyphs neutral and status tones semantic', () => {
    expect(resolveAgendaPresentation({
      kind: 'debt',
      hasPerson: false,
      statusText: 'venceu há 27 dias',
      isSettled: false,
    })).toMatchObject({ iconKind: 'debt', statusClass: 'text-destructive' })

    expect(resolveAgendaPresentation({
      kind: 'invoice-due',
      hasPerson: false,
      statusText: 'paga',
      isSettled: true,
    })).toMatchObject({ iconKind: 'invoice', statusClass: 'text-paid' })

    expect(resolveAgendaPresentation({
      kind: 'receivable',
      hasPerson: false,
      statusText: 'pendentes',
      isSettled: false,
    })).toMatchObject({ iconKind: 'receivable', statusClass: 'text-destructive' })
  })

  it.each([
    'vence hoje',
    'vence amanhã',
    'vence em 2 dias',
    'fecha hoje',
    'fecha amanhã',
    'fecha em 2 dias',
  ])('uses pending for future timing: %s', (statusText) => {
    expect(resolveAgendaPresentation({
      kind: 'invoice-due',
      hasPerson: false,
      statusText,
      isSettled: false,
    }).statusClass).toBe('text-pending')
  })

  it.each(['venceu ontem', 'venceu há 43 dias', 'Em atraso'])('uses destructive for overdue timing: %s', (statusText) => {
    expect(resolveAgendaPresentation({
      kind: 'invoice-due',
      hasPerson: false,
      statusText,
      isSettled: false,
    }).statusClass).toBe('text-destructive')
  })
})
