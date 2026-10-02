export interface StatementMetadataInput {
  bankName?: string | null
  categoryName?: string | null
  personContext?: { label: string; personName: string } | null
  receivablePersonName?: string | null
  subscription?: boolean
  invoicePeriod?: string | null
  isRefund?: boolean
}

type MetadataSegment = { text: string; preserveDuplicate?: boolean }

/** Build the ordered one-line metadata labels for a statement transaction. */
export function buildStatementMetadataSegments({
  bankName,
  categoryName,
  personContext,
  receivablePersonName,
  subscription,
  invoicePeriod,
  isRefund,
}: StatementMetadataInput): string[] {
  const personText = personContext
    ? `${personContext.label} ${personContext.personName}`
    : receivablePersonName
      ? `a receber de ${receivablePersonName}`
      : undefined

  const candidates: MetadataSegment[] = [
    { text: bankName ?? '' },
    { text: categoryName ?? '' },
    ...(personText ? [{ text: personText, preserveDuplicate: true }] : []),
    { text: subscription ? 'assinatura' : '' },
    { text: invoicePeriod ? `fatura ${invoicePeriod}` : '' },
    { text: isRefund ? 'reembolso' : '' },
  ]

  const seenLabels = new Set<string>()
  const segments: string[] = []

  for (const candidate of candidates) {
    const text = candidate.text.trim()
    if (!text) continue

    if (candidate.preserveDuplicate) {
      segments.push(text)
      continue
    }

    const normalized = text.toLowerCase()
    if (seenLabels.has(normalized)) continue
    seenLabels.add(normalized)
    segments.push(text)
  }

  return segments
}
