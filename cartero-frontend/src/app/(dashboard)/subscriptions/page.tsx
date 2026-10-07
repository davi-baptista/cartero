import { redirect } from 'next/navigation'
import { recurringLegacyDestination, type LegacyRecurringParams } from '@/lib/recurring-route'

export default async function SubscriptionsLegacyPage({ searchParams }: { searchParams: Promise<LegacyRecurringParams> }) {
  redirect(recurringLegacyDestination('expenses', await searchParams))
}
