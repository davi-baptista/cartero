import { Suspense } from 'react'
import { RecurringClient } from './recurring-client'

export default function RecurringPage() {
  return <Suspense fallback={null}><RecurringClient /></Suspense>
}
