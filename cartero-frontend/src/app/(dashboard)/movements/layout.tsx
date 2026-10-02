import type { ReactNode } from 'react'
import { MovementsShell } from './movements-shell'

export default function MovementsLayout({ children }: { children: ReactNode }) {
  return <MovementsShell>{children}</MovementsShell>
}
