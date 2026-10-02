'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createTransaction } from '@/services/transactions.service'
import { invalidateTransactionDependents, transactionAffectsPerson } from '@/lib/transaction-dependent-queries'

type OnCreated = () => void | Promise<void>

/** Shared create mutation for the statement form and the unified Movements drawer. */
export function useCreateTransactionMutation(onCreated?: OnCreated) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createTransaction,
    onSuccess: (_data, variables) => {
      invalidateTransactionDependents(queryClient, {
        affectsPerson: transactionAffectsPerson(null, variables.personId),
      })
      if (variables.personId) {
        void queryClient.invalidateQueries({ queryKey: ['obligations'] })
      }
      void onCreated?.()
      toast.success('Transação criada')
    },
    onError: () => toast.error('Não foi possível criar a transação. Tente novamente.'),
  })
}
