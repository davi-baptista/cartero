/**
 * ══════════════════════════════════════════════════════════════════════════
 * Identidade dos diálogos de parcelamento
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Dois diálogos — exclusão de parcelas em aberto e escolha de escopo — ficam
 * montados o tempo todo como IRMÃOS, tanto no Extrato quanto no painel da
 * fatura. Cada um remonta quando muda a compra ou a operação, e é a `key` que
 * garante isso: sem ela o diálogo reabriria com a prévia da série anterior.
 *
 * ── O bug que este módulo fecha ──
 *
 * Os dois usavam a mesma sentinela `'none'` quando ociosos. Como estão no mesmo
 * nível de renderização, o estado ocioso — que é o normal, a maior parte do
 * tempo — dava aos dois a MESMA key, e o React avisava a cada render:
 *
 *   "Encountered two children with the same key, `none`"
 *
 * Cada diálogo estava correto sozinho; a colisão só existia entre eles. Por
 * isso o prefixo, e não uma key mais "única" de cada lado: o que faltava era
 * namespace, não entropia.
 *
 * ── Por que não index, aleatório ou timestamp ──
 *
 * Qualquer um deles calaria o aviso e quebraria a identidade: o diálogo
 * remontaria a cada render, perdendo estado no meio de uma confirmação.
 */

/** Prefixos — o que separa os dois diálogos irmãos. */
const OPEN_DELETE = 'open-delete'
const SCOPE = 'scope'

/**
 * `idle` no lugar de `none`: nomeia o estado (fechado), em vez de sugerir
 * ausência de identidade. Duas ociosidades diferentes continuam distintas
 * porque o prefixo já as separa.
 */
const IDLE = 'idle'

/** Identidade do diálogo de exclusão de parcelas em aberto. */
export function openDeleteDialogKey(transactionId: string | null | undefined) {
  return `${OPEN_DELETE}:${transactionId ?? IDLE}`
}

/**
 * Identidade do diálogo de escopo.
 *
 * Inclui o `mode` porque a mesma compra pode ser alvo de edição e de exclusão,
 * e o diálogo precisa remontar ao trocar de operação.
 */
export function scopeDialogKey(
  scope: { mode: string; transactionId: string } | null | undefined,
) {
  return `${SCOPE}:${scope ? `${scope.mode}:${scope.transactionId}` : IDLE}`
}
