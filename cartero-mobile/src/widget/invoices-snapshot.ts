/**
 * Invoices Snapshot V1 — o segundo contrato widget do Cartero.
 *
 * Mesmo desenho do Budget Snapshot V1 (`snapshot.ts`), arquivo independente:
 * o widget de Invoices (futuro M6) não deve depender do mesmo JSON que o
 * widget de Budget, e uma falha de sincronização de um não pode corromper o
 * outro. Ver `snapshot.ts` para a razão de existir do padrão inteiro — este
 * arquivo só repete o que muda.
 *
 * ── Backend é a authority; o mobile não recalcula nada ──
 *
 * `GET /invoices/actionable` (M5A + M5A.1 + M5A.2) já decide: quais bancos
 * entram, qual invoice representa cada um, a ordem entre eles, `actionDate`,
 * status e o valor pessoal em centavos. O mobile PRESERVA a ordem e o
 * conteúdo exatamente como chegam — nenhum `.sort()`, `.filter()` por status,
 * dedupe por nome ou recálculo de dinheiro entra aqui. Fazer qualquer uma
 * dessas coisas seria uma segunda implementação da mesma regra de produto,
 * capaz de divergir da autoridade na próxima mudança do backend.
 *
 * ── Por que `closeDate`/`dueDate` NÃO entram ──
 *
 * O backend já transformou `status + closeDate + dueDate` em `actionDate`
 * canônica. Persistir as duas datas brutas só permitiria a um consumidor
 * futuro redescobrir a decisão que o backend já tomou — e um redescobrimento
 * é uma chance de divergir dela. Para a apresentação (M6) bastam `status` e
 * `actionDate`.
 */

export const INVOICES_SNAPSHOT_VERSION = 1

/** Os únicos status que `GET /invoices/actionable` pode devolver. */
export type ActionableInvoiceStatus = 'OVERDUE' | 'CLOSED' | 'OPEN'

export interface SnapshotInvoiceItem {
  bankName: string
  status: ActionableInvoiceStatus
  /** Dia civil `YYYY-MM-DD`, como o backend já entrega. */
  actionDate: string
  /** Inteiro em centavos, como o backend já entrega — nunca recalculado aqui. */
  ownAmountCents: number
}

export interface InvoicesReadySnapshot {
  version: typeof INVOICES_SNAPSHOT_VERSION
  state: 'ready'
  generatedAt: string
  /** Mesma função do `ownerId` do Budget: nunca para exibição, só account binding. */
  ownerId: string
  privacy: { hideAmounts: boolean }
  /** Na ORDEM exata em que o backend devolveu — nunca reordenado aqui. */
  invoices: SnapshotInvoiceItem[]
}

export interface InvoicesSignedOutSnapshot {
  version: typeof INVOICES_SNAPSHOT_VERSION
  state: 'signedOut'
  generatedAt: string
}

export type InvoicesSnapshot = InvoicesReadySnapshot | InvoicesSignedOutSnapshot

/** Mesmo padrão fail-safe do Budget: nunca revelar por padrão. */
export const INVOICES_DEFAULT_HIDE_AMOUNTS = true

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value)

const VALID_STATUS = new Set<string>(['OVERDUE', 'CLOSED', 'OPEN'])

/** Dia civil `YYYY-MM-DD` — o backend nunca deve mandar mais nem menos. */
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isCivilDate(value: unknown): value is string {
  if (typeof value !== 'string' || !CIVIL_DATE_PATTERN.test(value)) return false
  // Rejeita datas sintaticamente válidas mas civilmente impossíveis
  // (2026-13-40): `Date.UTC` normaliza silenciosamente em vez de recusar, e
  // uma comparação contra os componentes originais expõe a normalização.
  const [year, month, day] = value.split('-').map(Number)
  const asDate = new Date(Date.UTC(year, month - 1, day))
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  )
}

function parseInvoiceItem(value: unknown): SnapshotInvoiceItem | null {
  if (!isObject(value)) return null
  if (typeof value.bankName !== 'string' || value.bankName === '') return null
  if (typeof value.status !== 'string' || !VALID_STATUS.has(value.status)) {
    return null
  }
  if (!isCivilDate(value.actionDate)) return null
  if (!isCents(value.ownAmountCents)) return null

  return {
    bankName: value.bankName,
    status: value.status as ActionableInvoiceStatus,
    actionDate: value.actionDate,
    ownAmountCents: value.ownAmountCents,
  }
}

/**
 * Interpreta o conteúdo do arquivo, ou devolve `null`.
 *
 * Mesma postura do Budget: arquivo truncado, versão futura ou bug de escrita
 * não pode derrubar o widget nem inventar um número na tela — `null` deixa o
 * leitor mostrar o estado neutro.
 */
export function parseInvoicesSnapshot(raw: string | null): InvoicesSnapshot | null {
  if (!raw) return null

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isObject(value)) return null
  if (value.version !== INVOICES_SNAPSHOT_VERSION) return null
  if (typeof value.generatedAt !== 'string' || value.generatedAt === '') {
    return null
  }

  if (value.state === 'signedOut') {
    return {
      version: INVOICES_SNAPSHOT_VERSION,
      state: 'signedOut',
      generatedAt: value.generatedAt,
    }
  }

  if (value.state !== 'ready') return null
  if (typeof value.ownerId !== 'string' || value.ownerId === '') return null

  if (!isObject(value.privacy) || typeof value.privacy.hideAmounts !== 'boolean') {
    return null
  }

  if (!Array.isArray(value.invoices)) return null

  const invoices: SnapshotInvoiceItem[] = []
  for (const raw of value.invoices) {
    const parsed = parseInvoiceItem(raw)
    // Um item malformado invalida o snapshot inteiro — não descarta a linha
    // e mantém o resto. Aceitar parcialmente inventaria uma lista que o
    // backend nunca devolveu exatamente assim.
    if (!parsed) return null
    invoices.push(parsed)
  }

  return {
    version: INVOICES_SNAPSHOT_VERSION,
    state: 'ready',
    generatedAt: value.generatedAt,
    ownerId: value.ownerId,
    privacy: { hideAmounts: value.privacy.hideAmounts },
    invoices,
  }
}

/** O snapshot neutro, escrito no logout. Sem dono, sem faturas. */
export function buildInvoicesSignedOutSnapshot(
  now: Date = new Date(),
): InvoicesSignedOutSnapshot {
  return {
    version: INVOICES_SNAPSHOT_VERSION,
    state: 'signedOut',
    generatedAt: now.toISOString(),
  }
}
