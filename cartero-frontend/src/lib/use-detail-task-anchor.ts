'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A tarefa lembra de qual detalhe nasceu
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A O4.1.1 fez a tarefa parar de destruir a URL do detalhe. Ficou o inverso,
 * que a V1.1 observou nas três entidades: o Back apaga o `detailId`, o painel
 * fecha — e o formulário continua flutuando sobre a lista, ancorado a um item
 * que já não está aberto. Em A Receber apareceu também em "Alterar data do
 * recebimento", o que provou que o problema nunca foi específico de "Editar".
 *
 * ── Por que "se o id sumiu, feche tudo" não resolve ──
 *
 * Essa foi a primeira tentativa, e estava errada: a maioria das tarefas NÃO
 * nasce de um detalhe. "Nova dívida" abre o mesmo `sheetOpen` sem nenhum
 * `detailId`, e a regra fecharia o formulário de criação na cara do usuário.
 *
 * Falta a informação de ORIGEM. A pergunta certa não é "existe detalhe
 * aberto?", e sim:
 *
 *     "esta tarefa ainda pertence ao contexto de onde foi aberta?"
 *
 * ── O anchor NÃO é uma segunda fonte de verdade ──
 *
 * A URL continua sendo a única identidade do detalhe. O anchor nunca decide
 * qual detalhe abrir, nunca restaura um painel, nunca resolve entidade e
 * nunca vira href — ele só é COMPARADO com a URL para responder sim ou não.
 *
 * Se o anchor mandasse reabrir o detalhe que o Back removeu, ele derrotaria o
 * próprio Back. Por isso a única reação possível a um órfão é fechar a tarefa.
 *
 * ── Um anchor por página, não um por tarefa ──
 *
 * `editVeioDoDetalhe`, `deleteVeioDoDetalhe`, `settlementVeioDoDetalhe` seriam
 * a mesma semântica escrita N vezes, e a próxima tarefa criada esqueceria a
 * sua. As tarefas são mutuamente exclusivas na prática — e quando uma leva à
 * outra (escopo de parcelamento → formulário de edição), a cadeia inteira
 * pertence ao mesmo detalhe, então um anchor só é exatamente o que se quer.
 */

/** O que o anchor guarda: o detalhe de origem, ou nada. */
export type TaskAnchor = string | null

export type AnchorDecision =
  /** Nada a fazer — a tarefa segue válida (ou não há tarefa). */
  | { action: 'keep'; anchor: TaskAnchor }
  /** A tarefa terminou: zera para a próxima não herdar contexto. */
  | { action: 'clear'; anchor: null }
  /** O detalhe de origem sumiu ou trocou: fechar a tarefa. */
  | { action: 'orphan'; anchor: null }

/**
 * A decisão do ciclo de vida, isolada do React.
 *
 * Função pura de propósito: é aqui que mora a regra que a V1.1 provou estar
 * faltando, e testá-la exige apenas dados — sem jsdom, sem renderer, sem
 * depender dos internals do React. O hook abaixo só liga esta decisão aos
 * efeitos.
 */
export function decideAnchor({
  anchor,
  detailId,
  taskOpen,
}: {
  anchor: TaskAnchor
  detailId: string | null
  taskOpen: boolean
}): AnchorDecision {
  /*
    Nenhuma tarefa aberta: não há o que órfãr. Zera para a próxima não herdar
    contexto de uma que já terminou — cancelar, salvar, Escape, backdrop e
    falha de mutation caem todos aqui, sem cada um precisar lembrar de limpar.
  */
  if (!taskOpen) return { action: 'clear', anchor: null }

  /* Tarefa independente: a ausência de detalhe é o estado normal dela. */
  if (anchor === null) return { action: 'keep', anchor }

  /*
    O detalhe de origem deixou de ser o atual. Cobre os dois casos: o id sumiu
    (Back, fechamento explícito, exclusão bem-sucedida) e o id trocou por
    outro — uma edição de D1 não pode ficar aberta sobre o detalhe D2.
  */
  if (anchor !== detailId) return { action: 'orphan', anchor: null }

  return { action: 'keep', anchor }
}

/**
 * Liga a decisão acima ao ciclo de vida da página.
 *
 * ── `ref`, não `state` ──
 *
 * O anchor não é renderizado: nenhum pixel depende dele. Como `useState`,
 * marcar a origem provocaria um render a mais em cada abertura de tarefa, e
 * `begin*` chamado durante um handler competiria com o `setState` da própria
 * tarefa. Como `ref`, a marcação é síncrona e o efeito lê o valor já gravado.
 */
export function useDetailTaskAnchor({
  detailId,
  taskOpen,
  onOrphaned,
}: {
  /** A identidade do detalhe segundo a URL — a fonte de verdade. */
  detailId: string | null
  /** Se alguma tarefa transiente está aberta agora (derivado na página). */
  taskOpen: boolean
  /**
   * Fecha as tarefas transientes da página.
   *
   * Fica no consumidor de propósito: cada domínio tem os seus states, e um
   * cleanup genérico teria de conhecer todos eles. O hook sabe QUANDO; a
   * página sabe O QUÊ.
   */
  onOrphaned: () => void
}) {
  const anchor = useRef<TaskAnchor>(null)

  /*
    O cleanup mais recente, sem reexecutar a detecção a cada render.

    As páginas recriam `onOrphaned` a cada render (ele fecha sobre os setters
    de state), então colocá-lo nas dependências do efeito abaixo o faria rodar
    continuamente. A sincronização é feita em efeito próprio — escrever a ref
    durante o render é proibido, e com razão: o valor gravado poderia ser o de
    um render que o React descarta.
  */
  const onOrphanedRef = useRef(onOrphaned)
  useEffect(() => {
    onOrphanedRef.current = onOrphaned
  })

  /** A tarefa que vai abrir nasceu do detalhe aberto agora. */
  const beginFromDetail = useCallback(() => {
    anchor.current = detailId
  }, [detailId])

  /**
   * A tarefa que vai abrir não pertence a detalhe nenhum.
   *
   * Explícito mesmo com o cleanup normal já zerando o anchor: criar logo
   * depois de fechar uma edição não pode herdar o anchor da anterior, e
   * depender da ordem dos efeitos para isso seria frágil.
   */
  const beginStandalone = useCallback(() => {
    anchor.current = null
  }, [])

  useEffect(() => {
    const decisao = decideAnchor({
      anchor: anchor.current,
      detailId,
      taskOpen,
    })

    anchor.current = decisao.anchor

    /*
      Só fecha a UI transiente. A navegação já aconteceu: nada de
      `router.back()`, nada de reabrir o detalhe, e nenhuma mutation — Back
      durante uma confirmação é cancelamento, não confirmação.
    */
    if (decisao.action === 'orphan') onOrphanedRef.current()
  }, [detailId, taskOpen])

  return { beginFromDetail, beginStandalone }
}
