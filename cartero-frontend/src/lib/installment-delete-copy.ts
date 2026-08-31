import type {
  InstallmentPreservationReason,
  TransactionDeletePreview,
} from '@/services/transactions.service'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O que a exclusão vai fazer, dito em português
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O servidor responde com contagens e códigos. Traduzir isso mora aqui, e não
 * dentro do diálogo, por dois motivos: as duas superfícies que excluem
 * parcelas (Extrato e o painel da fatura) precisam dizer a mesma coisa, e
 * frase é o tipo de coisa que se testa sem renderizar nada.
 *
 * Nenhum código interno chega ao usuário. `PAID_INVOICE` é vocabulário de
 * API; quem lê a tela vê "a fatura já foi paga".
 */

/** Plural sem gambiarra de template no meio da frase. */
function parcelas(quantidade: number): string {
  return quantidade === 1 ? '1 parcela' : `${quantidade} parcelas`
}

/**
 * A frase de cada motivo, já no plural certo.
 *
 * `Record` de propósito: um motivo novo no backend não compila aqui sem a
 * frase correspondente.
 */
const MOTIVOS: Record<
  InstallmentPreservationReason,
  (quantidade: number) => string
> = {
  PAID_INVOICE: (n) =>
    n === 1
      ? '1 parcela será preservada porque a fatura dela já foi paga.'
      : `${n} parcelas serão preservadas porque já pertencem a faturas pagas.`,
  RECEIVABLE_ALREADY_PAID: (n) =>
    n === 1
      ? '1 parcela será preservada porque a cobrança dela já foi recebida.'
      : `${n} parcelas serão preservadas porque as cobranças delas já foram recebidas.`,
  PAYMENT_TRANSACTION_LINKED: (n) =>
    n === 1
      ? '1 parcela será preservada porque registra o pagamento de uma dívida ou cobrança.'
      : `${n} parcelas serão preservadas porque registram pagamentos de dívidas ou cobranças.`,
}

/**
 * Uma linha por MOTIVO, não por parcela.
 *
 * Seis linhas dizendo "a fatura já foi paga" seriam ruído: o usuário precisa
 * saber quantas e por quê, não repetir o porquê seis vezes.
 *
 * A ordem segue a precedência do domínio, para que a leitura seja estável
 * entre aberturas.
 */
const ORDEM: InstallmentPreservationReason[] = [
  'PAID_INVOICE',
  'RECEIVABLE_ALREADY_PAID',
  'PAYMENT_TRANSACTION_LINKED',
]

export function preservationLines(
  preview: Pick<TransactionDeletePreview, 'preserved'>,
): string[] {
  const contagem = new Map<InstallmentPreservationReason, number>()
  for (const item of preview.preserved) {
    contagem.set(item.reason, (contagem.get(item.reason) ?? 0) + 1)
  }

  return ORDEM.filter((motivo) => contagem.has(motivo)).map((motivo) =>
    MOTIVOS[motivo](contagem.get(motivo) as number),
  )
}

/**
 * A frase principal: quantas saem, e o que fica.
 *
 * Nunca "todas as parcelas" quando há histórico preservado — dizer isso numa
 * série 6 pagas / 4 abertas sugeriria que o passado vai junto, que é
 * exatamente o medo que esta operação precisa dissipar.
 */
export function deleteSummaryLine(
  preview: Pick<
    TransactionDeletePreview,
    'deletableCount' | 'preservedCount' | 'seriesTotal'
  >,
): string {
  const saem = `${parcelas(preview.deletableCount)} em aberto ${
    preview.deletableCount === 1 ? 'será excluída' : 'serão excluídas'
  }.`

  if (preview.preservedCount === 0) return saem

  const ficam =
    preview.preservedCount === 1
      ? 'A 1 parcela restante será preservada.'
      : `As ${preview.preservedCount} parcelas restantes serão preservadas.`

  return `${saem} ${ficam}`
}

/**
 * A compra inteira desaparece?
 *
 * Só quando nada sobra. Vale avisar porque muda o que o usuário vai encontrar
 * depois: a linha some do extrato em vez de encolher.
 */
export function seriesDisappears(
  preview: Pick<TransactionDeletePreview, 'preservedCount' | 'deletableCount'>,
): boolean {
  return preview.preservedCount === 0 && preview.deletableCount > 0
}

/**
 * As cobranças que saem junto.
 *
 * `null` quando não há nenhuma — a frase só aparece se houver o que dizer.
 * Não nomeia a pessoa: a prévia devolve contagem, e inventar um nome a partir
 * do contexto da tela arriscaria dizer o nome errado.
 */
export function receivablesLine(
  preview: Pick<TransactionDeletePreview, 'receivablesRemoved'>,
): string | null {
  if (preview.receivablesRemoved === 0) return null

  return preview.receivablesRemoved === 1
    ? 'A cobrança pendente vinculada a essa parcela também será removida.'
    : `As ${preview.receivablesRemoved} cobranças pendentes vinculadas a essas parcelas também serão removidas.`
}

/**
 * Por que não há nada a excluir.
 *
 * Substitui a confirmação destrutiva: sem parcela deletável, oferecer o botão
 * seria oferecer uma requisição que o servidor recusa.
 */
export function nothingToDeleteLines(
  preview: Pick<TransactionDeletePreview, 'preserved'>,
): string[] {
  return preservationLines(preview)
}

/** O texto do toast, com a contagem REAL devolvida pela execução. */
export function deleteSuccessMessage(deletedCount: number): string {
  return deletedCount === 1
    ? '1 parcela em aberto excluída'
    : `${deletedCount} parcelas em aberto excluídas`
}
