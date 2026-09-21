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

export type OverviewDetailIdentity = {
  param: OverviewDetailParam
  id: string
}

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

export function overviewDetailIdentity(
  current: URLSearchParams | string,
): OverviewDetailIdentity | null {
  const params = new URLSearchParams(current.toString())
  const param = OVERVIEW_DETAIL_PARAMS.find((item) => params.get(item))
  const id = param ? params.get(param) : null
  return param && id ? { param, id } : null
}

/** URL state local da Overview: personId não vira semântica global. */
export function useOverviewDetailNavigation() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const urlIdentity = overviewDetailIdentity(searchParams)
  const urlKey = urlIdentity ? `${urlIdentity.param}:${urlIdentity.id}` : 'none'
  const [visualOverride, setVisualOverride] = useState<{
    urlKey: string
    identity: OverviewDetailIdentity | null
  } | null>(null)
  const override = visualOverride?.urlKey === urlKey
    ? visualOverride.identity
    : urlIdentity

  function open(param: OverviewDetailParam, id: string) {
    const next = withOverviewDetailParam(searchParams, param, id)
    setVisualOverride({ urlKey, identity: { param, id } })
    router.push(detailHref(pathname, next), { scroll: false })
  }

  function close() {
    const current = liveLocation({ path: pathname, search: searchParams.toString() })
    const currentParams = new URLSearchParams(current.search)
    const currentParam = OVERVIEW_DETAIL_PARAMS.find((param) => currentParams.has(param))
    if (!currentParam) return
    setVisualOverride({ urlKey, identity: null })
    for (const detailParam of OVERVIEW_DETAIL_PARAMS) currentParams.delete(detailParam)
    if (typeof window !== 'undefined') {
      window.history.replaceState(window.history.state, '', detailHref(current.path, currentParams))
    } else {
      router.replace(detailHref(current.path, currentParams), { scroll: false })
    }
  }

  return {
    activeParam: override?.param ?? null,
    activeId: override?.id ?? null,
    open,
    close,
  }
}
