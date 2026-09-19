import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const subscriptions = readFileSync(
  resolve(__dirname, '../app/(dashboard)/subscriptions/page.tsx'),
  'utf8',
)

describe('subscription amount presentation', () => {
  it('uses neutral amounts in both row variants and the monthly total', () => {
    expect(subscriptions).toContain('className={ROW_AMOUNT_CLASS}')
    expect(subscriptions).not.toContain('ROW_AMOUNT_TONE.out')
    expect(subscriptions).not.toContain('text-destructive')
    expect(subscriptions).toContain('{formatCurrency(Number(subscription.amount))}')
    expect(subscriptions).toContain('{formatCurrency(monthlyTotal)}')
  })

  it('preserves the business amount, formatting, and paused state', () => {
    expect(subscriptions).toContain('Number(subscription.amount)')
    expect(subscriptions).toContain("formatCurrency, formatDate, TRANSACTION_TYPE_LABELS")
    expect(subscriptions).toContain("inactive && 'opacity-55'")
    expect(subscriptions).toContain('Pausada')
  })
})
