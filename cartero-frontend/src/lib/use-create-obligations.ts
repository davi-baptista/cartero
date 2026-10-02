'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createDebt } from '@/services/debts.service'
import { createReceivable } from '@/services/receivables.service'

type OnCreated = () => void | Promise<void>

export function useCreateDebtMutation(onCreated?: OnCreated) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createDebt,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['debts'] }),
        queryClient.invalidateQueries({ queryKey: ['budget'] }),
        queryClient.invalidateQueries({ queryKey: ['obligations'] }),
      ])
      await onCreated?.()
      toast.success('Dívida criada')
    },
    onError: () => toast.error('Erro ao criar dívida — verifique sua conexão e tente novamente'),
  })
}

export function useCreateReceivableMutation(onCreated?: OnCreated) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createReceivable,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['budget'] }),
        queryClient.invalidateQueries({ queryKey: ['obligations'] }),
      ])
      await onCreated?.()
      toast.success('Cobrança criada')
    },
    onError: () => toast.error('Erro ao criar cobrança — verifique sua conexão e tente novamente'),
  })
}
