import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const reveal = readFileSync(new URL('../components/ui/progressive-reveal.ts', import.meta.url), 'utf8')
const flow = readFileSync(new URL('../app/(dashboard)/movements/movements-add-flow.tsx', import.meta.url), 'utf8')
const transaction = readFileSync(new URL('../app/(dashboard)/transactions/transaction-sheet.tsx', import.meta.url), 'utf8')
const debt = readFileSync(new URL('../app/(dashboard)/debts/debt-sheet.tsx', import.meta.url), 'utf8')
const receivable = readFileSync(new URL('../app/(dashboard)/receivables/receivable-sheet.tsx', import.meta.url), 'utf8')

describe('Movements progressive reveal motion', () => {
  it('keeps the approved entrance as the single shared authority', () => {
    expect(reveal).toContain('animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none')
    for (const source of [flow, transaction, debt, receivable]) {
      expect(source).toContain('PROGRESSIVE_REVEAL_CLASS')
    }
  })

  it('uses the shared authority for transaction type, payment method, and fields', () => {
    expect(flow).toContain("className={cn('space-y-1.5', PROGRESSIVE_REVEAL_CLASS)}")
    expect(transaction).toContain("className={cn('space-y-1.5', scrollManagedByParent && PROGRESSIVE_REVEAL_CLASS)}")
    expect(transaction).toContain("'flex flex-col gap-4', scrollManagedByParent && PROGRESSIVE_REVEAL_CLASS")
  })

  it('animates later installment and person fields only when they are newly revealed', () => {
    expect(transaction).toContain("className={cn('space-y-1.5 pt-1', scrollManagedByParent && PROGRESSIVE_REVEAL_CLASS)}")
    expect(transaction).toContain("className={cn('space-y-2', scrollManagedByParent && PROGRESSIVE_REVEAL_CLASS)}")
    expect(transaction).toContain("className={cn('text-xs text-muted-foreground', scrollManagedByParent && PROGRESSIVE_REVEAL_CLASS)}")
  })

  it('reveals future debt and receivable bodies with the same motion', () => {
    for (const source of [debt, receivable]) {
      expect(source).toContain('? <div className={PROGRESSIVE_REVEAL_CLASS}>{content}</div>')
      expect(source).toContain('scrollManagedByParent && embeddedFooterHost')
    }
    expect(flow).toContain("target: 'receivable'")
    expect(flow).toContain("target: 'debt'")
  })

  it('keeps earlier questions and the shared scroll viewport stable during reveals', () => {
    const viewport = flow.indexOf('<div className={cn(DRAWER_SCROLL_REGION_CLASS')
    const questions = flow.indexOf('{decisionQuestions}')
    const nextForm = flow.indexOf('{activeTarget && footerHost && (')
    expect(viewport).toBeGreaterThan(-1)
    expect(questions).toBeGreaterThan(viewport)
    expect(nextForm).toBeGreaterThan(questions)
    expect(flow.slice(viewport, questions)).not.toContain('key=')
    expect(flow).not.toContain('scrollTop =')
    expect(flow).not.toContain('scrollIntoView(')
  })

  it('preserves reduced-motion behavior in the shared class', () => {
    expect(reveal).toContain('motion-reduce:animate-none')
    expect([flow, transaction, debt, receivable].join('\n')).not.toContain('useReducedMotion')
  })
})
