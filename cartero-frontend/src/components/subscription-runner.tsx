'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { runSubscriptions } from '@/services/subscriptions.service'

/**
 * Rede de segurança para a geração de assinaturas.
 *
 * O caminho principal é o cron diário; isso cobre o intervalo em que ele possa
 * ter falhado (o Render hiberna no plano free). Roda uma vez por montagem, em
 * background: quando o cron já passou, a chamada não encontra nada a fazer.
 */
export function SubscriptionRunner() {
  const qc = useQueryClient()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    runSubscriptions()
      .then((results) => {
        const criou = results.some((r) => r.generated.some((g) => !g.skipped))
        if (!criou) return
        // Só invalida quando algo foi realmente criado — o caso comum não
        // dispara refetch nenhum.
        qc.invalidateQueries({ queryKey: ['transactions'] })
        qc.invalidateQueries({ queryKey: ['invoices'] })
        qc.invalidateQueries({ queryKey: ['bank-invoices'] })
        qc.invalidateQueries({ queryKey: ['budget'] })
        qc.invalidateQueries({ queryKey: ['subscriptions'] })
      })
      .catch(() => {
        // Falha aqui é silenciosa de propósito: o cron é o caminho principal
        // e não há nada que o usuário possa fazer a respeito.
      })
  }, [qc])

  return null
}
