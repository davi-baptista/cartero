import type { Receivable } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Como uma cobrança pode ser excluída
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Um booleano `canDelete` não descreve mais a regra: existem motivos
 * semanticamente diferentes para poder, não poder, ou poder por outro caminho.
 * A união discriminada carrega o MOTIVO junto, para cada superfície explicar
 * ao usuário o que fazer em vez de só esconder o botão.
 *
 * ── As duas relações NÃO são a mesma coisa ──
 *
 *   `transactionId`        → a compra que GEROU esta cobrança (automática).
 *   `paymentTransactionId` → o comprovante de que ela foi RECEBIDA.
 *
 * Reduzir as duas a um `hasTransaction` já produziu bug antes: o warning de
 * vínculo abria para cobrança automática e oferecia duas opções que o backend
 * recusava com 409.
 *
 * ── Por que a automática não é excluída direto ──
 *
 * `DELETE /receivables/:id` recusa cobrança automática
 * (`AUTOMATIC_RECEIVABLE_MANAGED_BY_TRANSACTION`), e essa guarda é correta: a
 * compra é a origem, e o filho não apaga o pai. O caminho é excluir a COMPRA,
 * e a cascata canônica remove a cobrança junto — uma operação só, atômica.
 *
 * ── Precedência ──
 *
 * Bloqueio permanente vem ANTES de bloqueio removível. Se a compra está numa
 * fatura paga, desmarcar o recebimento não vai liberar nada — mandar o usuário
 * desmarcar seria mandá-lo a um beco.
 */

export type ReceivableDeletePolicy =
  /** Manual: some sozinha. */
  | { mode: 'direct' }
  /** Manual com comprovante: o aviso de vínculo decide o que fazer com ele. */
  | { mode: 'linked-payment' }
  /** Automática simples e pendente: exclui a compra de origem. */
  | { mode: 'source-transaction'; transactionId: string }
  /** Automática já recebida: desmarcar primeiro. */
  | { mode: 'unmark-first' }
  /** Automática parcelada: o escopo se decide na compra. */
  | { mode: 'manage-from-source' }

/**
 * Reproduz `belongsToSeries` sobre a cobrança.
 *
 * A cobrança automática herda o título da parcela (`"Jantar 2/10"`) e ganha a
 * própria cadeia de `parentId`, então a série é reconhecível sem buscar a
 * transação — nada de N+1.
 *
 * O sufixo vem antes do `parentId` porque a PRIMEIRA parcela tem `parentId`
 * nulo: só o título a identifica.
 */
function belongsToInstallmentSeries(receivable: Receivable): boolean {
  const declared = receivable.title.match(/\s\d+\/(\d+)$/)
  if (declared) return Number(declared[1]) > 1
  return Boolean(receivable.parentId)
}

/**
 * `sourceLocked` é informado por quem conhece a compra.
 *
 * A cobrança não carrega a fatura da origem, e buscá-la por linha seria N+1.
 * Quem tiver o dado — hoje ninguém, no fluxo atual — passa `true`; sem ele, o
 * backend continua sendo a autoridade e recusa com a mensagem própria.
 *
 * Isto NÃO é um bypass: o atalho chama o mesmo `DELETE /transactions/:id`, com
 * as mesmas guardas de fatura paga e comprovante. O frontend antecipa o que
 * consegue e nunca decide sozinho.
 */
export function resolveReceivableDeletePolicy(
  receivable: Receivable,
  options: { sourceLocked?: boolean } = {},
): ReceivableDeletePolicy {
  const isAutomatic = Boolean(receivable.transactionId)

  if (!isAutomatic) {
    /*
      Manual com comprovante de recebimento: o aviso de vínculo pergunta se a
      transação de recebimento deve sobreviver. É o caso legítimo dele.
    */
    return receivable.paymentTransactionId
      ? { mode: 'linked-payment' }
      : { mode: 'direct' }
  }

  /*
    Parcelada vem antes de recebida: mesmo desmarcando, a exclusão continua
    sendo decidida na compra, onde o escopo existe. Prometer que desmarcar
    libera o botão aqui seria falso.
  */
  if (belongsToInstallmentSeries(receivable)) {
    return { mode: 'manage-from-source' }
  }

  /*
    Origem travada vem ANTES de recebida — e a ordem importa.

    Com a compra numa fatura paga, desmarcar o recebimento não libera nada:
    ela continua inexcluível. Devolver `unmark-first` aqui mandaria o usuário
    executar uma ação que não destrava o que ele quer.
  */
  if (options.sourceLocked) return { mode: 'manage-from-source' }

  /*
    Recebida: apagar a compra removeria a cobrança e deixaria a transação de
    recebimento sem origem. O backend recusa (`RECEIVABLE_ALREADY_PAID`); aqui
    a UI diz o que destrava.
  */
  if (receivable.isPaid) return { mode: 'unmark-first' }


  /*
    O caso simples. `transactionId` já foi verificado por `isAutomatic`, mas o
    TypeScript não estreita `string | undefined` através daquele boolean.
  */
  return {
    mode: 'source-transaction',
    transactionId: receivable.transactionId!,
  }
}

/** A exclusão é oferecida como ação executável? */
export function canDeleteReceivable(policy: ReceivableDeletePolicy): boolean {
  return (
    policy.mode === 'direct' ||
    policy.mode === 'linked-payment' ||
    policy.mode === 'source-transaction'
  )
}
