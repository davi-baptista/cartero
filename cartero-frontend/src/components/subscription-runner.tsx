'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { runSubscriptions } from '@/services/subscriptions.service'

/**
 * Rede de segurança para a geração de assinaturas.
 *
 * O caminho principal é o cron diário; isso cobre o intervalo em que ele possa
 * ter falhado (o Render hiberna no plano free). Roda uma vez por montagem, em
 * background: quando o cron já passou, a chamada não encontra nada a fazer.
 *
 * ─── Sobre o silêncio ─────────────────────────────────────────────────────
 *
 * Este componente engolia qualquer erro num `catch` vazio, justificado por "o
 * cron é o caminho principal e não há nada que o usuário possa fazer". A
 * segunda parte não se sustenta: quando uma assinatura falha por banco
 * arquivado, restaurar o banco é exatamente o que resolve — e o usuário não
 * podia saber que era isso.
 *
 * Agora falhas aparecem. Sucesso continua silencioso: avisar "nada a fazer"
 * em cada abertura do app seria ruído.
 */
export function SubscriptionRunner() {
  const qc = useQueryClient()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    runSubscriptions()
      .then((results) => {
        /**
         * Falhas por assinatura.
         *
         * O backend isola cada uma, então um lote pode ter gerado e falhado ao
         * mesmo tempo — os dois casos são tratados aqui, na ordem em que
         * importam: primeiro o que precisa de ação.
         */
        const failures = results.filter((result) => result.failure)
        if (failures.length > 0) {
          const first = failures[0]
          toast.error(
            failures.length === 1
              ? `${first.title}: ${first.failure!.reason}`
              : `${failures.length} assinaturas não geraram cobranças. ${first.title}: ${first.failure!.reason}`,
          )
        }

        const created = results.some((result) =>
          result.generated.some((item) => !item.skipped),
        )
        if (!created) return

        // Só invalida quando algo foi realmente criado — o caso comum não
        // dispara refetch nenhum.
        qc.invalidateQueries({ queryKey: ['transactions'] })
        qc.invalidateQueries({ queryKey: ['invoices'] })
        qc.invalidateQueries({ queryKey: ['bank-invoices'] })
        qc.invalidateQueries({ queryKey: ['budget'] })
        qc.invalidateQueries({ queryKey: ['subscriptions'] })
        // A tela de compromissos deriva das assinaturas ativas e ficava com
        // dados velhos ao navegar entre as duas.
        qc.invalidateQueries({ queryKey: ['commitments'] })
      })
      .catch(() => {
        /**
         * A requisição inteira falhou — rede, sessão, servidor fora.
         *
         * Sem toast: o cron diário é o caminho principal, e um erro de rede
         * aqui não indica que a geração está quebrada. Mas registrar no
         * console deixa rastro para investigação, em vez de nada.
         */
        console.warn('Não foi possível verificar as assinaturas pendentes.')
      })
  }, [qc])

  return null
}
