'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { deleteTransaction } from '@/services/transactions.service'
import { invalidateTransactionDependents } from '@/lib/transaction-dependent-queries'
import { apiErrorMessage } from '@/lib/api-error'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Excluir a compra que originou uma cobrança automática
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A cobrança automática não é apagada por `DELETE /receivables/:id` — o
 * backend recusa, e com razão: a compra é a origem, e o filho não apaga o pai.
 * O caminho é excluir a COMPRA, e a cascata canônica remove a cobrança junto,
 * dentro da mesma transação de banco.
 *
 * UMA requisição, nunca duas. Dois deletes independentes deixariam estado
 * parcial se o segundo falhasse.
 *
 * Vive aqui, e não na página do Extrato, porque A Receber e o extrato de
 * Pessoa precisam do mesmo comportamento — e importar uma página dentro de
 * outra tela para reaproveitar uma mutation acoplaria as duas.
 *
 * Sem `scope`: este atalho só é oferecido para compra NÃO parcelada. Série se
 * exclui pelo Extrato, onde o diálogo de escopo já existe.
 */
export function useDeleteSourceTransaction(options?: {
  onSuccess?: () => void
}) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (transactionId: string) => deleteTransaction(transactionId),
    onSuccess: () => {
      /*
        A política compartilhada de qualquer lançamento. A lista anterior
        invalidava `persons` mas esquecia `person-statement` — e este atalho
        parte justamente do extrato da pessoa, a tela que ficava obsoleta.

        `affectsPerson` é sempre verdadeiro: este caminho só existe para
        excluir a compra que ORIGINOU uma cobrança automática de alguém.
      */
      invalidateTransactionDependents(qc, { affectsPerson: true })

      toast.success('Compra e cobrança excluídas')
      options?.onSuccess?.()
    },
    /*
      Recusas do domínio — fatura paga, recebimento vinculado — chegam com
      mensagem própria do backend. Mostrá-la é mais útil que um texto genérico,
      e NUNCA se tenta apagar a cobrança como alternativa.
    */
    onError: (error) =>
      toast.error(
        apiErrorMessage(error, 'Não foi possível excluir a compra de origem'),
      ),
  })
}
