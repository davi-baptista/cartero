'use client'

import { Loader2, RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Estado de erro de uma query, com retry.
 *
 * Existe porque erro e vazio são fatos diferentes e as telas os confundiam:
 * com a API fora do ar, `isLoading` vira false e os dados ficam `undefined`,
 * então a página caía no ramo vazio e exibia "Nenhum banco cadastrado" — o app
 * afirmando que o usuário não tem bancos quando só não conseguiu buscá-los.
 *
 * O retry usa `refetch` do React Query, não `window.location.reload()`: recarregar
 * a página descartaria todo o cache que carregou corretamente.
 */
export function QueryError({
  message,
  isFetching = false,
  onRetry,
  className,
}: {
  /** O que não foi possível carregar, do ponto de vista do usuário. */
  message: string
  isFetching?: boolean
  onRetry: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={
        className ??
        'flex flex-col items-center justify-center py-16 text-center'
      }
    >
      <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-destructive/10">
        <TriangleAlert className="size-5 text-destructive/70" aria-hidden />
      </div>
      <p className="text-sm font-medium">{message}</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        Verifique sua conexão e tente novamente. Seus dados continuam salvos.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-5 gap-1.5"
        disabled={isFetching}
        onClick={onRetry}
      >
        {isFetching ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <RotateCcw className="size-3.5" aria-hidden />
        )}
        {isFetching ? 'Carregando…' : 'Tentar novamente'}
      </Button>
    </div>
  )
}
