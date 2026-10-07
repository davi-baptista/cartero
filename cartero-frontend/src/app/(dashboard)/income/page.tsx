import { redirect } from 'next/navigation'
import { recurringLegacyDestination, type LegacyRecurringParams } from '@/lib/recurring-route'

export default async function IncomeLegacyPage({ searchParams }: { searchParams: Promise<LegacyRecurringParams> }) {
  redirect(recurringLegacyDestination('income', await searchParams))
}
