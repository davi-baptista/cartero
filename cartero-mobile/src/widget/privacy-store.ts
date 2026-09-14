/**
 * A preferência de privacidade dos widgets.
 *
 * ── Por que ela é por CONTA, não por aparelho ──
 *
 * "Mostrar valores" é uma decisão sobre dinheiro de alguém. Guardá-la como
 * ajuste global do aparelho faria a conta B nascer revelando saldos porque a
 * conta A optou por isso — e B nunca escolheu nada. A associação com o
 * `ownerId` é o que impede esse vazamento entre pessoas que usam o mesmo
 * telefone.
 *
 * ── Por que ela não some no logout ──
 *
 * Sair da conta não desfaz a escolha de quem sai. Apagar a preferência
 * obrigaria a pessoa a optar de novo a cada sessão, e o efeito prático seria
 * treiná-la a ignorar o ajuste. O snapshot é neutralizado no logout; a
 * decisão sobrevive.
 */

/**
 * Versão do arquivo de preferência.
 *
 * Independente do Snapshot V1 — são dois arquivos com ciclos de vida
 * distintos. Um formato futuro vira V2 e o leitor atual recua para o padrão
 * seguro em vez de adivinhar campos.
 */
export const PRIVACY_STORE_VERSION = 1

/**
 * O padrão, e ele é oculto.
 *
 * Toda dúvida termina aqui: arquivo ausente, corrompido, versão desconhecida,
 * dono sem entrada, leitura que falhou. Revelar por engano expõe saldo na
 * tela inicial para quem passa ao lado; ocultar por engano custa um toque no
 * ajuste. Os dois erros não são simétricos.
 */
export const DEFAULT_HIDE_AMOUNTS = true

export interface PrivacyEntry {
  ownerId: string
  hideAmounts: boolean
}

export interface PrivacyStore {
  version: typeof PRIVACY_STORE_VERSION
  entries: PrivacyEntry[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Interpreta o arquivo, ou devolve um armazenamento vazio.
 *
 * Nunca lança: uma preferência ilegível não pode impedir o app de funcionar,
 * e o vazio resolve para "oculto" em toda consulta.
 */
export function parsePrivacyStore(raw: string | null): PrivacyStore {
  const empty: PrivacyStore = { version: PRIVACY_STORE_VERSION, entries: [] }
  if (!raw) return empty

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return empty
  }

  if (!isObject(value)) return empty
  if (value.version !== PRIVACY_STORE_VERSION) return empty
  if (!Array.isArray(value.entries)) return empty

  /*
    Entrada inválida é descartada, não derruba as demais. Um registro
    corrompido de uma conta não deve apagar a escolha das outras — e a conta
    afetada simplesmente volta ao padrão oculto.
  */
  const entries: PrivacyEntry[] = []
  for (const entry of value.entries) {
    if (!isObject(entry)) continue
    if (typeof entry.ownerId !== 'string' || entry.ownerId === '') continue
    if (typeof entry.hideAmounts !== 'boolean') continue

    entries.push({ ownerId: entry.ownerId, hideAmounts: entry.hideAmounts })
  }

  return { version: PRIVACY_STORE_VERSION, entries }
}

/** A escolha desta conta, ou o padrão seguro se ela nunca escolheu. */
export function hideAmountsFor(store: PrivacyStore, ownerId: string): boolean {
  const entry = store.entries.find((item) => item.ownerId === ownerId)
  return entry ? entry.hideAmounts : DEFAULT_HIDE_AMOUNTS
}

/**
 * Registra a escolha de uma conta, preservando as outras.
 *
 * Substituir o arquivo inteiro apagaria a preferência de quem não estava
 * logado no momento — e essa pessoa descobriria o efeito só ao voltar, com o
 * saldo já exposto ou já oculto sem ter mexido em nada.
 */
export function withHideAmounts(
  store: PrivacyStore,
  ownerId: string,
  hideAmounts: boolean,
): PrivacyStore {
  const others = store.entries.filter((entry) => entry.ownerId !== ownerId)

  return {
    version: PRIVACY_STORE_VERSION,
    entries: [...others, { ownerId, hideAmounts }],
  }
}
