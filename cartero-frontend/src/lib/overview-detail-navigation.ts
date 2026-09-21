'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { detailHref, liveLocation } from '@/lib/detail-navigation'

export const OVERVIEW_DETAIL_PARAMS = [
  'invoiceId',
  'personId',
  'debtId',
  'receivableId',
] as const

export type OverviewDetailParam = (typeof OVERVIEW_DETAIL_PARAMS)[number]

export function withOverviewDetailParam(
  current: URLSearchParams | string,
  param: OverviewDetailParam,
  id: string,
): URLSearchParams {
  const next = new URLSearchParams(current.toString())
  for (const detailParam of OVERVIEW_DETAIL_PARAMS) next.delete(detailParam)
  next.set(param, id)
  return next
}

/** URL state local da Overview: personId não vira semântica global. */
export function useOverviewDetailNavigation() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [dismissed, setDismissed] = useState<{ id: string; generation: number } | null>(null)
  const [opens, setOpens] = useState(0)

  const activeParam = OVERVIEW_DETAIL_PARAMS.find((param) => searchParams.get(param)) ?? null
  const activeId = activeParam ? searchParams.get(activeParam) : null
  const openId = dismissed?.id === `${activeParam}:${activeId}` && opens <= dismissed.generation
    ? null
    : activeId

  function open(param: OverviewDetailParam, id: string) {
    const next = withOverviewDetailParam(searchParams, param, id)
    setOpens((value) => value + 1)
    router.push(detailHref(pathname, next), { scroll: false })
  }

  function close() {
    const current = liveLocation({ path: pathname, search: searchParams.toString() })
    const currentParams = new URLSearchParams(current.search)
    const currentParam = OVERVIEW_DETAIL_PARAMS.find((param) => currentParams.has(param))
    if (!currentParam) return
    const currentId = currentParams.get(currentParam)
    if (currentId) setDismissed({ id: `${currentParam}:${currentId}`, generation: opens })
    for (const detailParam of OVERVIEW_DETAIL_PARAMS) currentParams.delete(detailParam)
    if (typeof window !== 'undefined') {
      window.history.replaceState(window.history.state, '', detailHref(current.path, currentParams))
    } else {
      router.replace(detailHref(current.path, currentParams), { scroll: false })
    }
  }

  return {
    activeParam,
    activeId: openId,
    open,
    close,
  }
}
