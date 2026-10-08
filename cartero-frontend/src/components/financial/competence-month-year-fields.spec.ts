import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const selectHarness = vi.hoisted(() => ({
  values: [] as Array<{ value: string; onValueChange: (value: string | null) => void }>,
  content: [] as Array<{ alignItemWithTrigger: boolean; portalContainer: HTMLElement | null }>,
}))

vi.mock('@/components/ui/select', async () => {
  const { createElement: element } = await import('react')
  return {
    Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string | null) => void; children: ReactNode }) => {
      selectHarness.values.push({ value, onValueChange })
      return element('div', null, children)
    },
    SelectTrigger: ({ children, ...props }: { children: ReactNode; 'aria-label': string }) => element('button', { 'aria-label': props['aria-label'] }, children),
    SelectValue: ({ placeholder }: { placeholder: string }) => element('span', null, placeholder),
    SelectContent: ({ children, alignItemWithTrigger, portalContainer }: { children: ReactNode; alignItemWithTrigger: boolean; portalContainer: HTMLElement | null }) => {
      selectHarness.content.push({ alignItemWithTrigger, portalContainer })
      return element('div', null, children)
    },
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => element('div', { 'data-month-option': value }, children),
  }
})

import { CompetenceMonthYearFields } from './competence-month-year-fields'

describe('CompetenceMonthYearFields', () => {
  it.each(['Renda desde', 'Primeira competência automática', 'Primeira competência manual'])('keeps month selection inside the shared control for %s', (flow) => {
    selectHarness.values.length = 0
    selectHarness.content.length = 0
    const onMonthChange = vi.fn()
    const onYearChange = vi.fn()
    const markup = renderToStaticMarkup(createElement(CompetenceMonthYearFields, {
      month: '',
      year: '',
      onMonthChange,
      onYearChange,
      monthAriaLabel: `Mês de ${flow}`,
      yearAriaLabel: `Ano de ${flow}`,
    }))

    expect(markup).toContain(`aria-label="Mês de ${flow}"`)
    expect(markup).toContain('placeholder="Ano"')
    expect(markup.match(/data-month-option=/g)).toHaveLength(12)
    expect(selectHarness.values[0].value).toBe('')
    expect(selectHarness.content[0]).toEqual({ alignItemWithTrigger: false, portalContainer: null })

    selectHarness.values[0].onValueChange('05')
    expect(onMonthChange).toHaveBeenCalledWith('05')
    selectHarness.values[0].onValueChange(null)
    expect(onMonthChange).toHaveBeenCalledWith('')
  })

  it('preserves persisted month and year in edit state', () => {
    selectHarness.values.length = 0
    const markup = renderToStaticMarkup(createElement(CompetenceMonthYearFields, {
      month: '09',
      year: '2026',
      onMonthChange: vi.fn(),
      onYearChange: vi.fn(),
      monthAriaLabel: 'Mês da primeira competência',
      yearAriaLabel: 'Ano da primeira competência',
    }))
    expect(selectHarness.values[0].value).toBe('09')
    expect(markup).toContain('value="2026"')
  })
})
