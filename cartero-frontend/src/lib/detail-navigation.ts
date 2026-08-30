'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A identidade do detalhe aberto vive na URL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * DETALHE é navegação: abrir uma entidade para consultar muda onde o usuário
 * está, e o Back precisa fechar. TAREFA é estado transitório — criar, editar,
 * confirmar continuam locais, porque ninguém espera voltar no histórico para
 * cancelar um formulário.
 *
 * Antes, os seis detalhes guardavam a entidade inteira num `useState`. O Back
 * saía da página, o refresh perdia o que estava aberto, e o link não podia ser
 * compartilhado. Fatura e Pessoa tinham query param, mas só como SEMENTE de
 * chegada: clicar numa linha não escrevia a URL.
 *
 * O comportamento correto já existia no Orçamento — clonar os params, trocar
 * só o do detalhe, `push` com `scroll: false`. Esta foundation generaliza
 * aquela ideia sem depender do módulo Budget.
 *
 * ── Só o ID ──
 *
 * A URL carrega identidade, nunca o objeto. Título, valor e status continuam
 * vindo do cache ou da API — serializá-los criaria uma segunda cópia dos
 * dados, que envelheceria em silêncio.
 */

/**
 * Todos os params que identificam um detalhe aberto.
 *
 * A lista existe para a EXCLUSIVIDADE: abrir um detalhe remove qualquer outro,
 * e nunca dois painéis empilhados por URL. `transactionId`, `invoiceId` e
 * `personId` já constam porque O4.2/O4.3 vão consumi-los — declarar agora
 * evita que a primeira migração seguinte esqueça de limpar os anteriores.
 *
 * `personId` merece cuidado: em Dívidas ele é FILTRO por pessoa, não detalhe.
 * Por isso a limpeza é sempre feita sobre esta lista explícita, e cada página
 * decide qual param ela própria usa — nada aqui adivinha semântica.
 */
export const DETAIL_PARAMS = [
  'debtId',
  'receivableId',
  'subscriptionId',
  'transactionId',
  'invoiceId',
] as const

export type DetailParam = (typeof DETAIL_PARAMS)[number]

/**
 * A query string com o detalhe aberto.
 *
 * Função pura: recebe os params atuais e devolve os novos. Todo o resto
 * sobrevive — período, filtros, busca, `highlight`, o `personId` de Dívidas.
 * Reconstruir a query do zero é como filtros somem sem ninguém notar.
 */
export function withDetailParam(
  current: URLSearchParams | string,
  key: DetailParam,
  id: string,
): URLSearchParams {
  const next = new URLSearchParams(current.toString())
  for (const param of DETAIL_PARAMS) next.delete(param)
  next.set(key, id)
  return next
}

/** A mesma query, sem NENHUM detalhe aberto. Os demais params ficam. */
export function withoutDetailParams(
  current: URLSearchParams | string,
): URLSearchParams {
  const next = new URLSearchParams(current.toString())
  for (const param of DETAIL_PARAMS) next.delete(param)
  return next
}

/** `/debts?a=1` ou `/debts` — nunca `/debts?` com a interrogação órfã. */
export function detailHref(
  pathname: string,
  params: URLSearchParams,
): string {
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

/**
 * Abrir e fechar o detalhe de uma página.
 *
 * ── Por que abrir é `push` e fechar é `replace` ──
 *
 * Abrir é uma navegação de verdade: o usuário foi para algum lugar, e o Back
 * precisa trazê-lo de volta. Isso exige uma entrada no histórico.
 *
 * Fechar pelo X não é "voltar": quem chegou por link direto não tem entrada
 * anterior no Cartero, e `router.back()` o mandaria para fora do app. Trocar a
 * entrada atual (`replace`) resolve os dois casos.
 *
 * E evita o pior caso: com `push` no fechar, o histórico ficaria
 * `[lista, detalhe, lista]` — o Back logo após fechar reabriria o detalhe que
 * o usuário acabou de dispensar. Com `replace`, a entrada do detalhe é
 * SUBSTITUÍDA, e o Back leva ao que havia antes dela.
 *
 * `scroll: false` nos dois: abrir e fechar não podem jogar a lista para o topo.
 */
export function useDetailNavigation(key: DetailParam) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const openId = searchParams.get(key)

  const open = (id: string) => {
    router.push(
      detailHref(pathname, withDetailParam(searchParams, key, id)),
      { scroll: false },
    )
  }

  /**
   * Fecha o detalhe. Idempotente de propósito: um `replace` sem nada a mudar
   * ainda assim reescreveria a entrada atual, e o fluxo de exclusão chama esta
   * função depois de a URL já ter sido limpa em alguns caminhos.
   */
  const close = () => {
    if (!openId) return
    router.replace(
      detailHref(pathname, withoutDetailParams(searchParams)),
      { scroll: false },
    )
  }

  return { openId, open, close }
}
