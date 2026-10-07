'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { movementViewLinkClass } from '@/lib/movement-view-switch'
import { MovementsAddFlow } from './movements-add-flow'

const views = [
  { href: '/movements/statement', label: 'Extrato' },
  { href: '/movements/obligations', label: 'A pagar e receber' },
]

export function MovementsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  return (
    <section className="space-y-4">
        <div className="flex min-w-0 items-start justify-between gap-1.5">
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="break-words text-2xl font-semibold tracking-tight">Movimentações</h1>
            <p className="text-sm text-muted-foreground">
              Acompanhe o que aconteceu e o que ainda está por vir
            </p>
          </div>
          <div className="flex shrink-0 justify-end">
            <MovementsAddFlow />
          </div>
        </div>

        <div className="space-y-2">
          <nav
            aria-label="Visões de Movimentações"
            className="flex w-full max-w-md rounded-xl border bg-muted/40 p-1 sm:inline-flex"
          >
            {views.map(({ href, label }) => {
              const active = pathname === href
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={movementViewLinkClass(active)}
                >
                  <span className="whitespace-nowrap">{label}</span>
                </Link>
              )
            })}
          </nav>
          <div className="pt-1">
            <div aria-hidden className="border-t border-border/60" />
          </div>
        </div>

        <div className="pt-2">{children}</div>
    </section>
  )
}
