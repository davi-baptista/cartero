'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, LockOpen, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  markManyInvoicesPaid,
  reopenAllPaidInvoices,
} from '@/services/invoices.service'

/** Cliques seguidos no rótulo de versão que revelam a seção. */
const UNLOCK_CLICKS = 7
const STORAGE_KEY = 'cartero:reopened-invoices'

/**
 * Atalho de manutenção: reabre todas as faturas pagas para permitir corrigir
 * lançamentos antigos, e depois devolve ao estado anterior.
 *
 * Os ids ficam em `sessionStorage` porque o registro da fatura não guarda o
 * motivo da reabertura — sem essa lista não haveria como distinguir o que o
 * modo abriu do que já estava aberto antes.
 */
/** Faturas que uma visita anterior desta sessão deixou abertas. */
function readStoredIds(): string[] {
  if (typeof window === 'undefined') return []
  const stored = sessionStorage.getItem(STORAGE_KEY)
  if (!stored) return []
  try {
    const ids = JSON.parse(stored) as unknown
    return Array.isArray(ids) ? (ids as string[]) : []
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
    return []
  }
}

export function MaintenanceMode() {
  const qc = useQueryClient()
  const [clicks, setClicks] = useState(0)
  const [reopenedIds, setReopenedIds] = useState<string[]>(readStoredIds)
  // Já revelado quando há faturas pendentes de fechar — senão o usuário
  // precisaria redescobrir a sequência para desfazer o que deixou aberto.
  const [unlocked, setUnlocked] = useState(() => readStoredIds().length > 0)

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['invoices'] })
    qc.invalidateQueries({ queryKey: ['bank-invoices'] })
    qc.invalidateQueries({ queryKey: ['invoice'] })
    qc.invalidateQueries({ queryKey: ['budget'] })
  }

  const reopenMut = useMutation({
    mutationFn: reopenAllPaidInvoices,
    onSuccess: ({ ids, count }) => {
      setReopenedIds(ids)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
      invalidate()
      toast.success(
        count > 0
          ? `${count} fatura${count > 1 ? 's' : ''} reaberta${count > 1 ? 's' : ''}`
          : 'Nenhuma fatura paga para reabrir',
      )
    },
    onError: () => toast.error('Erro ao reabrir as faturas'),
  })

  const restoreMut = useMutation({
    mutationFn: () => markManyInvoicesPaid(reopenedIds),
    onSuccess: ({ count }) => {
      setReopenedIds([])
      sessionStorage.removeItem(STORAGE_KEY)
      invalidate()
      toast.success(
        `${count} fatura${count === 1 ? '' : 's'} marcada${count === 1 ? '' : 's'} como paga${count === 1 ? '' : 's'} de novo`,
      )
    },
    onError: () => toast.error('Erro ao restaurar as faturas'),
  })

  function handleVersionClick() {
    const next = clicks + 1
    setClicks(next)
    if (next >= UNLOCK_CLICKS) setUnlocked(true)
  }

  const isOpen = reopenedIds.length > 0
  const busy = reopenMut.isPending || restoreMut.isPending

  return (
    <div className="mt-2 flex flex-col items-center gap-3 pb-2">
      <button
        type="button"
        onClick={handleVersionClick}
        className="cursor-default text-[11px] text-muted-foreground/40 transition-colors hover:text-muted-foreground/60"
        aria-label="Versão do aplicativo"
      >
        Cartero
      </button>

      {unlocked && (
        <div className="w-full rounded-xl border border-dashed border-border bg-muted/20 px-5 py-4">
          <p className="text-[13px] font-medium">Manutenção</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {isOpen
              ? `${reopenedIds.length} fatura${reopenedIds.length > 1 ? 's' : ''} aberta${reopenedIds.length > 1 ? 's' : ''} por aqui. Ao terminar, feche para devolvê-las ao estado anterior.`
              : 'Reabre todas as faturas pagas para corrigir lançamentos antigos. Nada é apagado — só o status muda.'}
          </p>

          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={() => (isOpen ? restoreMut.mutate() : reopenMut.mutate())}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : isOpen ? (
              <Lock className="size-3.5" />
            ) : (
              <LockOpen className="size-3.5" />
            )}
            {isOpen ? 'Fechar faturas reabertas' : 'Reabrir faturas pagas'}
          </Button>

          {isOpen && (
            <p className="mt-2 text-[11px] text-muted-foreground/70">
              Faturas que você quitar enquanto isso permanecem pagas.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
