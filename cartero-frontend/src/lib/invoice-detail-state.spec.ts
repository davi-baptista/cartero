import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InvoiceStatus, type Invoice } from '@/types'
import {
  reconcilePendingDetailOpen,
  resolveDetailOpenId,
} from './detail-navigation'
import { invoiceForDetailId } from './invoice-detail-state'

const banksPage = readFileSync(
  new URL('../app/(dashboard)/banks/page.tsx', import.meta.url),
  'utf-8',
)
const invoiceDrawer = readFileSync(
  new URL('../components/invoice-details-drawer.tsx', import.meta.url),
  'utf-8',
)

const invoice = (id: string) => ({
  id,
  userId: 'user-1',
  bankId: 'bank-1',
  month: 10,
  year: 2026,
  status: InvoiceStatus.OPEN,
  closeDate: '2026-10-01',
  dueDate: '2026-10-10',
  totalAmount: 100,
  createdAt: '',
  updatedAt: '',
}) satisfies Invoice

describe('invoice detail data identity', () => {
  it('does not expose invoice A while invoice B is loading', () => {
    const a = invoice('A')
    expect(invoiceForDetailId(a, 'B')).toBeUndefined()
    expect(invoiceForDetailId(invoice('B'), 'B')?.id).toBe('B')
  })

  it('supports A → B → A without cross-rendering stale detail data', () => {
    const a = invoice('A')
    const b = invoice('B')
    expect(invoiceForDetailId(a, 'A')?.id).toBe('A')
    expect(invoiceForDetailId(a, 'B')).toBeUndefined()
    expect(invoiceForDetailId(b, 'B')?.id).toBe('B')
    expect(invoiceForDetailId(b, 'A')).toBeUndefined()
    expect(invoiceForDetailId(a, 'A')?.id).toBe('A')
  })

  it('keeps requested B through close-A → open-B while the URL still says A', () => {
    const a = invoice('A')
    const b = invoice('B')
    const pending = { id: 'B', fromId: 'A' }
    const targetWhileRouterCatchesUp = resolveDetailOpenId('A', true, pending)

    expect(targetWhileRouterCatchesUp).toBe('B')
    expect(invoiceForDetailId(a, targetWhileRouterCatchesUp)).toBeUndefined()
    expect(invoiceForDetailId(undefined, targetWhileRouterCatchesUp)).toBeUndefined()
    expect(invoiceForDetailId(b, targetWhileRouterCatchesUp)?.id).toBe('B')

    const afterUrlMovesToB = reconcilePendingDetailOpen('B', pending)
    expect(afterUrlMovesToB).toBeNull()
    expect(resolveDetailOpenId('B', false, afterUrlMovesToB)).toBe('B')
    expect(resolveDetailOpenId('A', false, afterUrlMovesToB)).toBe('A')
  })

  it('handles A → B without closing, then Back to A without reviving pending B', () => {
    const pending = { id: 'B', fromId: 'A' }
    expect(resolveDetailOpenId('A', false, pending)).toBe('B')

    const afterUrlMovesToB = reconcilePendingDetailOpen('B', pending)
    expect(resolveDetailOpenId('B', false, afterUrlMovesToB)).toBe('B')
    expect(resolveDetailOpenId('A', false, afterUrlMovesToB)).toBe('A')
  })

  it('keeps Banks keyed and invoice detail data scoped to its target ID', () => {
    expect(banksPage).toContain("key={detail.openId ?? 'none'}")
    expect(invoiceDrawer).toContain("queryKey: ['invoice', invoiceId]")
    expect(invoiceDrawer).toContain('invoiceForDetailId(invoiceQueryData, invoiceId)')
    expect(invoiceDrawer).toContain('isLoading || !invoice')
  })
})
