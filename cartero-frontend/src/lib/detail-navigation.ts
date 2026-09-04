'use client'

import { useState } from 'react'
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

/**
 * A URL do NAVEGADOR neste instante — não a do render.
 *
 * Fechar um detalhe é uma ação, e ela precisa da URL que vale no momento do
 * clique. `useSearchParams()`/`usePathname()` devolvem o valor do render que
 * criou o closure, e no build de produção o handler do `Sheet` pode ser
 * anterior à última sincronização do router: o param aparece ausente, o
 * fechamento é abortado, e o drawer fica preso.
 *
 * No servidor não há `window`; quem chama passa o fallback do render.
 */
export function liveLocation(fallback: {
  path: string
  search: string
}): { path: string; search: string } {
  if (typeof window === 'undefined') return fallback
  return {
    path: window.location.pathname,
    search: window.location.search.replace(/^\?/, ''),
  }
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
 * ── Por que abrir é `push` e fechar NÃO usa o router ──
 *
 * Abrir é uma navegação de verdade: o usuário foi para algum lugar, e o Back
 * precisa trazê-lo de volta. Isso exige uma entrada no histórico, e `push` a
 * cria.
 *
 * Fechar era `router.replace(...)`, e em PRODUÇÃO isso não fazia nada.
 *
 * `/banks`, `/budget` e `/persons` são rotas ESTÁTICAS (prerenderizadas). Um
 * `replace` que muda apenas a query da rota atual aponta para a mesma entrada
 * do cache do App Router, e o Next descarta a atualização: a URL fica igual,
 * o `searchParams` não muda, e o drawer nunca fecha. Bastava colar
 * `/banks?invoiceId=…` numa aba nova para o X ficar inerte.
 *
 * Em desenvolvimento o bug não aparecia — sem rota prerenderizada, o mesmo
 * `replace` era processado normalmente. Foi por isso que ele passou por vários
 * ciclos de validação local.
 *
 * A correção tem duas partes:
 *
 *   1. `window.history.replaceState` reescreve a URL de fato, sem passar pelo
 *      cache de rota. É a mesma primitive que o router usa por baixo;
 *   2. o `openId` ganha estado próprio, para a UI não depender de o
 *      `useSearchParams` reagir a uma navegação que o Next pode engolir.
 *
 * O histórico continua correto: `replaceState` SUBSTITUI a entrada atual, sem
 * empilhar. O Back logo após fechar leva ao que havia antes do detalhe, nunca
 * de volta a ele.
 *
 * `router.back()` continua fora: quem chegou por link direto não tem entrada
 * anterior no Cartero, e o mandaria para fora do app.
 */
export function useDetailNavigation(key: DetailParam) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const paramId = searchParams.get(key)

  /*
    ── Espelho local da URL, SEM effect ──

    A fonte continua sendo a URL: este estado só existe para o fechamento não
    depender de o router propagar a mudança.

    Guardar a QUERY fechada (não só o id) faz o espelho se invalidar por
    construção: qualquer navegação posterior — abrir outro detalhe, Back,
    Forward, colar um link novo — muda a string, o espelho deixa de casar, e
    o detalhe volta a ser lido da URL. Nenhum efeito precisa limpá-lo, o que
    evita o risco de um snap-back reabrir o que o usuário dispensou.
  */
  const [closedSearch, setClosedSearch] = useState<string | null>(null)
  const currentSearch = searchParams.toString()
  const openId = currentSearch === closedSearch ? null : paramId

  const open = (id: string) => {
    setClosedSearch(null)
    router.push(
      detailHref(pathname, withDetailParam(searchParams, key, id)),
      { scroll: false },
    )
  }

  /**
   * Fecha o detalhe.
   *
   * Idempotente: o fluxo de exclusão chama esta função depois de a URL já ter
   * sido limpa em alguns caminhos, e aí não há nada a fazer.
   */
  const close = () => {
    /*
      A URL do NAVEGADOR, não a do render: o handler do `Sheet` pode ter sido
      criado antes da última sincronização, e a query capturada estaria velha.
    */
    const atual = liveLocation({
      path: pathname,
      search: searchParams.toString(),
    })
    if (new URLSearchParams(atual.search).get(key) === null) return

    /*
      A UI fecha AGORA, sem esperar navegação — é o que torna o X
      determinístico mesmo quando o Next descarta a atualização de rota.
    */
    setClosedSearch(atual.search)

    const limpo = withoutDetailParams(atual.search)

    if (typeof window !== 'undefined') {
      /*
        `replaceState` em vez de `router.replace`: numa rota estática o router
        trata a troca de query como a mesma entrada de cache e não reescreve a
        URL. Esta primitive reescreve.
      */
      window.history.replaceState(
        window.history.state,
        '',
        detailHref(atual.path, limpo),
      )
    } else {
      router.replace(detailHref(atual.path, limpo), { scroll: false })
    }
  }

  return { openId, open, close }
}
