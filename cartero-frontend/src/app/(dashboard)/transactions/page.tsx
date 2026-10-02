import { redirect } from 'next/navigation'
import { movementLegacyDestination } from '@/lib/movement-legacy-redirect'

type LegacyPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LegacyPage({ searchParams }: LegacyPageProps) {
  redirect(movementLegacyDestination('transactions', await searchParams))
}
