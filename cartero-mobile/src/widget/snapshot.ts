/**
 * Widget Snapshot V1 — o contrato entre o app e os widgets futuros.
 *
 * O widget é um processo separado, com execução curta e sem sessão. Ele não
 * chama a API nem carrega credencial: lê este arquivo e desenha. Tudo o que
 * ele precisa saber tem de caber aqui, já resolvido.
 *
 * ── O que NÃO entra ──
 *
 * Nada de token, e-mail, senha ou resposta crua da API. O snapshot fica em
 * disco no aparelho; cada campo a mais é superfície permanente em troca de
 * nada, porque o widget desenha quatro números.
 *
 * A autoridade financeira continua no backend: `totalToPay`, `totalPaid` e
 * `totalPending` chegam calculados de `GET /budget`. O app não recalcula
 * fatura, parte própria, dívida, carry ou acerto de pessoa — fazer isso
 * criaria uma segunda verdade que divergiria da web na primeira mudança.
 */

/**
 * Versão do formato.
 *
 * O widget é código INSTALADO: pode ficar semanas mais velho que o app que
 * escreve o arquivo. Um leitor de V1 que encontre V2 precisa recuar com
 * segurança em vez de interpretar campos que não entende. Por isso V1, uma
 * vez publicado, não muda de forma — uma alteração incompatível vira V2.
 */
export const SNAPSHOT_VERSION = 1

/** Moeda do Cartero. Explícita no arquivo para o widget não presumir. */
export const SNAPSHOT_CURRENCY = 'BRL'

export interface SnapshotBudget {
  /** 1–12. */
  month: number
  year: number
  currency: string
  /** Inteiros em centavos — ver `toCents`. */
  totalToPayCents: number
  totalPaidCents: number
  totalPendingCents: number
}

export interface ReadySnapshot {
  version: typeof SNAPSHOT_VERSION
  state: 'ready'
  generatedAt: string
  /**
   * A quem estes números pertencem.
   *
   * Não é credencial e não autentica nada: existe para o widget nunca exibir
   * o saldo de A depois que B entrou. Não é para exibição.
   */
  ownerId: string
  privacy: { hideAmounts: boolean }
  budget: SnapshotBudget
}

export interface SignedOutSnapshot {
  version: typeof SNAPSHOT_VERSION
  state: 'signedOut'
  generatedAt: string
}

export type WidgetSnapshot = ReadySnapshot | SignedOutSnapshot

/**
 * Valores ocultos por padrão.
 *
 * A tela inicial é vista por quem passa ao lado. Um usuário que não sabe que a
 * preferência existe não deveria descobrir isso com o saldo já exposto — o
 * padrão precisa ser o estado que não vaza.
 */
export const DEFAULT_HIDE_AMOUNTS = true

/**
 * Reais → centavos inteiros.
 *
 * Serialização, não regra financeira: o valor chega pronto do backend e aqui
 * só muda de representação. Guardar `float` num arquivo que outro processo lê
 * carrega o erro de ponto flutuante para fora do app — `Math.round` fixa o
 * inteiro uma vez, no ponto de escrita.
 *
 * Recusa o que não é número finito. Um `NaN` viraria `null` no JSON e o widget
 * desenharia um valor inventado; melhor não escrever snapshot nenhum e
 * preservar o anterior.
 */
export function toCents(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new TypeError('valor monetário inválido')
  }

  return Math.round(amount * 100)
}

/* ────────────────────── leitura defensiva ────────────────────── */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value)

/**
 * Interpreta o conteúdo do arquivo, ou devolve `null`.
 *
 * O arquivo pode estar truncado por uma escrita interrompida, vir de uma
 * versão futura do app ou ter sido escrito por um bug. Nenhum desses casos
 * pode derrubar o widget nem produzir um número inventado na tela inicial —
 * devolver `null` deixa o leitor mostrar o estado neutro.
 */
export function parseSnapshot(raw: string | null): WidgetSnapshot | null {
  if (!raw) return null

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isObject(value)) return null
  // Versão desconhecida não é lida como V1, nem "na dúvida".
  if (value.version !== SNAPSHOT_VERSION) return null
  if (typeof value.generatedAt !== 'string' || value.generatedAt === '') {
    return null
  }

  if (value.state === 'signedOut') {
    return {
      version: SNAPSHOT_VERSION,
      state: 'signedOut',
      generatedAt: value.generatedAt,
    }
  }

  if (value.state !== 'ready') return null
  if (typeof value.ownerId !== 'string' || value.ownerId === '') return null

  if (!isObject(value.privacy) || typeof value.privacy.hideAmounts !== 'boolean') {
    return null
  }

  const budget = value.budget
  if (!isObject(budget)) return null
  if (typeof budget.month !== 'number' || budget.month < 1 || budget.month > 12) {
    return null
  }
  if (typeof budget.year !== 'number') return null
  if (typeof budget.currency !== 'string' || budget.currency === '') return null
  if (
    !isCents(budget.totalToPayCents) ||
    !isCents(budget.totalPaidCents) ||
    !isCents(budget.totalPendingCents)
  ) {
    return null
  }

  return {
    version: SNAPSHOT_VERSION,
    state: 'ready',
    generatedAt: value.generatedAt,
    ownerId: value.ownerId,
    privacy: { hideAmounts: value.privacy.hideAmounts },
    budget: {
      month: budget.month,
      year: budget.year,
      currency: budget.currency,
      totalToPayCents: budget.totalToPayCents,
      totalPaidCents: budget.totalPaidCents,
      totalPendingCents: budget.totalPendingCents,
    },
  }
}

/** O snapshot neutro, escrito no logout. Sem dono, sem valores. */
export function buildSignedOutSnapshot(now: Date = new Date()): SignedOutSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    state: 'signedOut',
    generatedAt: now.toISOString(),
  }
}
