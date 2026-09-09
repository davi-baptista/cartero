/**
 * ══════════════════════════════════════════════════════════════════════════
 * A quantidade de parcelas: rascunho permissivo, valor final estrito
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Digitar `10` no campo passa obrigatoriamente por dois estados que NÃO são
 * valores finais válidos:
 *
 *   "2"  →  ""   (o usuário apaga)
 *        →  "1"  (primeiro caractere de 10, 12, 15, 18…)
 *        →  "10" (finalmente válido)
 *
 * A versão anterior derivava o MODO do próprio número
 * (`isParcelado = (Number(installments) || 1) > 1`). Como `Number('') === 0`,
 * o primeiro Backspace fazia o campo valer 1, o modo virar "À vista" e o
 * input DESMONTAR no meio da edição — o caminho natural para 10x era
 * impossível, e no mobile, sem spinner, não havia contorno.
 *
 * ── A separação ──
 *
 *   MODO       escolha explícita do usuário (estado próprio no form)
 *   RASCUNHO   o que está no input agora: "", "0", "1", "10"
 *   FINAL      o que o submit aceita: inteiro >= 2, <= MAX
 *
 * Rascunho permissivo não afrouxa a regra: quem decide é `installmentsIssue`,
 * chamada na validação. Um campo vazio em modo Parcelado é ERRO, não uma
 * conversão silenciosa para compra à vista.
 *
 * ── Por que o vazio precisava de tratamento próprio ──
 *
 * O schema fazia `'' → undefined` e o campo era `.optional()`, então submeter
 * em modo Parcelado com o campo limpo PASSAVA na validação e criava uma
 * compra à vista — o oposto do que a tela mostrava. Antes isso era
 * inalcançável (limpar já trocava o modo); com o modo desacoplado, virou um
 * caminho real, e é por isso que a regra é contextual ao modo.
 */

/** Máximo de parcelas aceito pelo formulário. Não muda nesta fase. */
export const MAX_INSTALLMENTS = 64

/** Mínimo para uma compra ser genuinamente parcelada. */
export const MIN_INSTALLMENTS = 2

export type InstallmentsIssue =
  /** Modo Parcelado com o campo vazio. */
  | 'required'
  /** Valor abaixo de 2 — inclusive o `1` intermediário da digitação. */
  | 'tooFew'
  /** Acima do teto vigente. */
  | 'tooMany'
  /** Não é inteiro: decimal, negativo, texto. */
  | 'notInteger'

/**
 * Mensagens no padrão do formulário — curtas, sem ponto final, como as
 * demais (`Selecione um banco`, `Título obrigatório`).
 */
export const INSTALLMENTS_MESSAGE: Record<InstallmentsIssue, string> = {
  required: 'Informe a quantidade de parcelas',
  tooFew: `Mínimo ${MIN_INSTALLMENTS} parcelas`,
  tooMany: `Máximo ${MAX_INSTALLMENTS} parcelas`,
  notInteger: 'Quantidade inválida',
}

/**
 * O rascunho é aceitável enquanto se digita?
 *
 * Vale para QUALQUER estado transitório — inclusive os inválidos como valor
 * final. O input nunca é revertido nem desmontado por causa do que está
 * escrito nele; quem recusa é a validação, no submit.
 */
export function isEditableDraft(raw: unknown): boolean {
  if (raw === '' || raw === undefined || raw === null) return true
  return /^\d*$/.test(String(raw))
}

/**
 * O problema do valor FINAL, ou `null` quando ele serve.
 *
 * `isParcelado` é o contexto: fora do modo parcelado o campo não é exigido,
 * porque a compra à vista tem outra representação canônica (o backend trata
 * ausente e 1 como um lançamento único).
 */
export function installmentsIssue(
  raw: unknown,
  isParcelado: boolean,
): InstallmentsIssue | null {
  if (!isParcelado) return null

  if (raw === '' || raw === undefined || raw === null) return 'required'

  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())

  if (!Number.isFinite(n) || !Number.isInteger(n)) return 'notInteger'
  if (n < MIN_INSTALLMENTS) return 'tooFew'
  if (n > MAX_INSTALLMENTS) return 'tooMany'

  return null
}

/**
 * O valor que vai para o payload.
 *
 * `undefined` fora do modo parcelado — a representação de compra à vista que
 * o backend já usa. Nunca inventa `1`: deixar o campo decidir isso foi o que
 * permitiu, com o campo vazio, um submit em modo Parcelado virar à vista.
 */
export function toInstallmentsPayload(
  raw: unknown,
  isParcelado: boolean,
): number | undefined {
  if (!isParcelado) return undefined
  if (installmentsIssue(raw, true) !== null) return undefined

  return typeof raw === 'number' ? raw : Number(String(raw).trim())
}
