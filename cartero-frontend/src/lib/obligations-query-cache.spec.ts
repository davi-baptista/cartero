import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InfiniteQueryObserver, QueryClient } from '@tanstack/query-core'
import { obligationsSectionKey } from './obligations-query'
import type { ObligationPage, ObligationSection } from '@/services/obligations.service'

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const period = { month: 10, year: 2026 }
const page = (id: string): ObligationPage => ({
  items: [{
    domain: 'RECEIVABLE', id, title: id, amount: '10.00', description: null,
    personId: null, personName: null, counterpartyName: id,
    dueDate: '2026-10-10', isResolved: false, resolvedAt: null, paymentTransactionId: null,
  }],
  pageInfo: { nextCursor: null, hasMore: false },
})

function observe(
  section: ObligationSection,
  month: number,
  queryFn: () => Promise<ObligationPage> = async () => page(`${section}-${month}`),
) {
  const queryKey = obligationsSectionKey({ section, domain: 'ALL', search: '', month, year: 2026 })
  return new InfiniteQueryObserver(client, {
    queryKey,
    queryFn,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.pageInfo.hasMore ? lastPage.pageInfo.nextCursor ?? undefined : undefined,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
  })
}

afterEach(() => client.clear())

describe('obligations month cache behavior', () => {
  it('returns a visited month from its own query key without initial loading', () => {
    const octoberKey = obligationsSectionKey({ section: 'OPEN', domain: 'ALL', search: '', ...period })
    const novemberKey = obligationsSectionKey({ section: 'OPEN', domain: 'ALL', search: '', month: 11, year: 2026 })
    client.setQueryData(octoberKey, { pages: [page('october-row')], pageParams: [null] })

    const november = observe('OPEN', 11)
    expect(november.getCurrentResult().isPending).toBe(true)
    client.setQueryData(novemberKey, { pages: [page('november-row')], pageParams: [null] })
    const loadedNovember = observe('OPEN', 11).getCurrentResult()
    expect(loadedNovember.data?.pages[0]?.items[0]?.id).toBe('november-row')

    const returnedOctober = observe('OPEN', 10).getCurrentResult()
    expect(returnedOctober.data?.pages[0]?.items[0]?.id).toBe('october-row')
    expect(returnedOctober.isPending).toBe(false)
    expect(returnedOctober.isLoading).toBe(false)
  })

  it('keeps cached rows available during a background refetch', async () => {
    const key = obligationsSectionKey({ section: 'HISTORY', domain: 'ALL', search: '', ...period })
    client.setQueryData(key, { pages: [page('history-row')], pageParams: [null] })
    let finish!: (value: ObligationPage) => void
    const observer = observe('HISTORY', 10, () => new Promise<ObligationPage>((resolvePage) => { finish = resolvePage }))
    const unsubscribe = observer.subscribe(() => undefined)
    const refetch = observer.refetch()
    const refreshing = observer.getCurrentResult()
    expect(refreshing.isFetching).toBe(true)
    expect(refreshing.isLoading).toBe(false)
    expect(refreshing.data?.pages[0]?.items[0]?.id).toBe('history-row')
    finish(page('history-row'))
    await refetch
    unsubscribe()
  })

  it('keeps overdue keys stable across month changes while open and history keys change', () => {
    for (const section of ['OVERDUE', 'OPEN', 'HISTORY'] as const) {
      const october = obligationsSectionKey({ section, domain: 'ALL', search: 'foo', ...period })
      const november = obligationsSectionKey({ section, domain: 'ALL', search: 'foo', month: 11, year: 2026 })
      if (section === 'OVERDUE') expect(october).toEqual(november)
      else expect(october).not.toEqual(november)
    }
  })
})

describe('obligations navigation policy', () => {
  const layout = readFileSync(resolve(process.cwd(), 'src/app/(dashboard)/layout.tsx'), 'utf8')
  const pageSource = readFileSync(resolve(process.cwd(), 'src/app/(dashboard)/movements/obligations/obligations-client.tsx'), 'utf8')

  it('scrolls only from manual month selection and lets highlight navigation own its target', () => {
    expect(layout).toContain("pathname !== '/movements/obligations'")
    expect(layout).toContain("params.has('highlight')")
    expect(layout).toContain("'[data-slot=\"dashboard-scroll-viewport\"]'")
    expect(layout).toContain("getElementById('obligations-scroll-anchor')")
    expect(pageSource).toContain('id="obligations-scroll-anchor"')
    expect(pageSource).toContain('setPeriod(highlightPeriod)')
    expect(pageSource).not.toContain("removeQueries({ queryKey: ['obligations', 'section'] })")
  })
})
