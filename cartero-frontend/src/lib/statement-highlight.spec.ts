import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Transaction, TransactionType } from '@/types'
import type { TransactionPage } from '@/services/transactions.service'
import {
  findStatementHighlightPage,
  shouldFetchStatementHighlightPage,
  statementHighlightDay,
  transactionMatchesStatementGroup,
  transactionMatchesStatementSearch,
} from './statement-highlight'

const statementPage = readFileSync(new URL('../app/(dashboard)/movements/statement/page.tsx', import.meta.url), 'utf8')

function transaction(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    userId: 'user-1',
    bankId: 'bank-1',
    categoryId: 'category-1',
    type: 'PIX' as TransactionType,
    title: `Compra ${id}`,
    amount: 10,
    date: '2026-10-31T00:00:00.000Z',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

const page = (...items: Transaction[]): TransactionPage => ({
  items,
  pageInfo: { nextCursor: null, hasMore: false },
})

describe('statement deep-link highlight', () => {
  it('finds first-page and later-page targets by transaction id', () => {
    const pages = [page(transaction('page-1')), page(transaction('page-2'))]
    expect(findStatementHighlightPage(pages, 'page-1')).toBe(0)
    expect(findStatementHighlightPage(pages, 'page-2')).toBe(1)
    expect(findStatementHighlightPage(pages, 'missing')).toBe(-1)
  })

  it('fetches only cursor pages needed to reach the target and stops when found or blocked', () => {
    const base = { targetId: 'target', hasNextPage: true, isFetchingNextPage: false, isFetchNextPageError: false }
    expect(shouldFetchStatementHighlightPage({ ...base, targetPage: -1 })).toBe(true)
    expect(shouldFetchStatementHighlightPage({ ...base, targetPage: 1 })).toBe(false)
    expect(shouldFetchStatementHighlightPage({ ...base, targetPage: -1, hasNextPage: false })).toBe(false)
    expect(shouldFetchStatementHighlightPage({ ...base, targetPage: -1, isFetchingNextPage: true })).toBe(false)
    expect(shouldFetchStatementHighlightPage({ ...base, targetPage: -1, isFetchNextPageError: true })).toBe(false)
  })

  it('uses a DB-bounded target day and leaves cursor paging responsible for its page', () => {
    const target = transaction('target', { date: '2026-11-01T00:00:00.000Z' })
    expect(statementHighlightDay(target)).toBe('2026-11-01')
  })

  it('identifies only filters that hide the target', () => {
    const target = transaction('target', {
      title: 'Pagamento escola',
      description: 'Mensalidade',
      type: 'PIX' as TransactionType,
    })
    expect(transactionMatchesStatementSearch(target, 'escola')).toBe(true)
    expect(transactionMatchesStatementSearch(target, 'aluguel')).toBe(false)
    expect(transactionMatchesStatementGroup(target, 'direct')).toBe(true)
    expect(transactionMatchesStatementGroup({ type: 'CREDIT_CARD' as TransactionType }, 'direct')).toBe(false)
  })

  it('scrolls and pulses a located highlight without opening transaction detail', () => {
    expect(statementPage).toContain('useHighlight(visibleHighlightId)')
    expect(statementPage).toContain("useDetailNavigation('transactionId')")
    expect(statementPage).not.toContain('detail.open(highlightTargetId)')
    expect(statementPage).not.toContain('detail.open(visibleHighlightId)')
  })
})
