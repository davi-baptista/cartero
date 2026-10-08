import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DrawerCompletionStatus } from '@/components/ui/drawer-section'

const subscriptions = readFileSync(
  resolve(__dirname, '../app/(dashboard)/recurring/subscription-panel.tsx'),
  'utf8',
)
const subscriptionDrawer = readFileSync(
  resolve(__dirname, '../app/(dashboard)/subscriptions/subscription-detail-drawer.tsx'),
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

  it('keeps the detail amount neutral in the shared recurring drawer', () => {
    expect(subscriptionDrawer).toContain('<DrawerSummaryLabel emphasis="regular">Valor por cobrança</DrawerSummaryLabel>')
    expect(subscriptionDrawer).toContain('<DrawerSummaryValue>{formatCurrency(Number(subscription.amount))}</DrawerSummaryValue>')
    expect(subscriptionDrawer).not.toContain('ROW_AMOUNT_TONE.out')
    expect(subscriptionDrawer).toContain("getTransactions({ subscriptionId: subscription!.id })")
  })

  it('colors active green and paused muted without changing their status icons', () => {
    expect(subscriptionDrawer).toContain("variant={subscription.isActive ? 'pending' : 'informational'}")
    expect(subscriptionDrawer).toContain("className={subscription.isActive ? 'text-paid' : 'text-muted-foreground'}")

    const active = renderToStaticMarkup(DrawerCompletionStatus({ variant: 'pending', className: 'text-paid', children: 'Ativa' }))
    const paused = renderToStaticMarkup(DrawerCompletionStatus({ variant: 'informational', className: 'text-muted-foreground', children: 'Pausada' }))
    expect(active).toContain('text-paid')
    expect(active).not.toContain('text-pending')
    expect(paused).toContain('text-muted-foreground')
    expect(paused).not.toContain('text-primary')
  })
})
