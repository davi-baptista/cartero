'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Destaque temporário de uma linha vinda por `?highlight=<id>`.
 *
 * Existe para um caso concreto: uma cobrança automática linka para a compra
 * que a originou, e o usuário precisa chegar NAQUELA transação — não numa
 * página filtrada onde ele ainda tem de procurar.
 *
 * Deliberadamente pequeno. Não é infraestrutura de deep linking para o app
 * inteiro: é um id na URL, um scroll e um destaque que apaga sozinho.
 *
 * Segurança: o parâmetro é só navegação. A query de transações continua
 * filtrada por ownership no backend, então um id de outro usuário simplesmente
 * não é encontrado nos dados carregados — e aí nada é destacado. Nenhum dado
 * privado é exposto e nada quebra.
 */
export function useHighlight(highlightId: string | null | undefined) {
  /**
   * Quando o destaque atual expirou.
   *
   * O estado guarda o id JÁ APAGADO, não o ativo: assim o valor exibido é
   * derivado durante o render (`highlightId !== expiredId`) em vez de escrito
   * por um efeito. Escrever o id ativo em `setState` dentro de um efeito
   * causaria o render em cascata que o `react-hooks/set-state-in-effect`
   * aponta — e o destaque piscaria depois da primeira pintura.
   */
  const [expiredId, setExpiredId] = useState<string | null>(null)

  const highlightedId =
    highlightId && highlightId !== expiredId ? highlightId : null

  useEffect(() => {
    if (!highlightedId) return

    /*
      Um destaque permanente seria lido como estado do registro ("esta
      transação tem algo de especial") e não como "foi para cá que você
      navegou". Por isso ele apaga sozinho.
    */
    const timer = setTimeout(
      () => setExpiredId(highlightedId),
      HIGHLIGHT_DURATION_MS,
    )
    return () => clearTimeout(timer)
  }, [highlightedId])

  /**
   * Ref da linha destacada — rola até ela quando aparece.
   *
   * `block: 'center'` porque a linha pode estar sob o cabeçalho fixo. O
   * `scrolled` impede repetir o scroll se o React remontar o nó.
   */
  const scrolled = useRef<string | null>(null)
  const highlightRef = useCallback(
    (node: HTMLElement | null) => {
      if (!node || !highlightedId || scrolled.current === highlightedId) return

      scrolled.current = highlightedId
      node.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
        block: 'center',
      })
    },
    [highlightedId],
  )

  return { highlightedId, highlightRef }
}

/** Tempo do destaque: o bastante para o olho achar a linha, e não mais. */
const HIGHLIGHT_DURATION_MS = 2600
