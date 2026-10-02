import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { ObligationsClient } from './obligations-client'

export default function MovementObligationsPage() {
  return (
    <Suspense fallback={<div className="space-y-3" aria-label="Carregando obrigações"><Skeleton className="h-9 w-48" /><Skeleton className="h-24 w-full" /></div>}>
      <ObligationsClient />
    </Suspense>
  )
}
