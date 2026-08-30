'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Resolver a entidade que a URL diz estar aberta
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O id vem da URL; o conteúdo vem de onde já estiver. Na maior parte dos
 * casos a lista da página já foi carregada — clicar numa linha não pode
 * disparar uma requisição para buscar algo que está na tela.
 *
 * A busca por id é FALLBACK, para os casos em que a lista não tem a entidade:
 * link direto, refresh, ou um item fora do recorte atual dos filtros.
 *
 * ── Id que não resolve ──
 *
 * Uma URL pode apontar para algo excluído, de outro usuário, ou digitado
 * errado. O painel não pode ficar vazio nem girando para sempre: quando a
 * busca falha, o param é removido e a página continua onde estava.
 */
export function useDetailEntity<T extends { id: string }>({
  openId,
  fromList,
  fetchById,
  queryKey,
  onNotFound,
}: {
  /** O id que a URL declara aberto — `null` quando não há detalhe. */
  openId: string | null
  /** A entidade, se a lista já carregada a contém. */
  fromList: T | undefined
  fetchById: (id: string) => Promise<T>
  /** Prefixo da chave de cache desta entidade, ex.: `'debt'`. */
  queryKey: string
  /** Chamado quando o id não resolve — a página limpa o param. */
  onNotFound: () => void
}): { entity: T | null; isLoading: boolean } {
  /*
    A consulta só roda quando a lista NÃO tem a entidade. Com ela em mãos,
    `enabled` fica falso e nenhuma requisição sai.
  */
  const precisaBuscar = Boolean(openId) && !fromList

  const { data, isLoading, isError } = useQuery({
    queryKey: [queryKey, openId],
    queryFn: () => fetchById(openId!),
    enabled: precisaBuscar,
    /*
      Sem retry: um id inválido devolve 404 e tentar de novo só atrasa a
      limpeza do param. Falha de rede o usuário resolve reabrindo.
    */
    retry: false,
  })

  useEffect(() => {
    if (isError) onNotFound()
    // `onNotFound` é recriada a cada render nas páginas; depender dela
    // reexecutaria o efeito sem que nada tivesse mudado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError])

  return {
    entity: fromList ?? data ?? null,
    isLoading: precisaBuscar && isLoading,
  }
}
