import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decideAnchor, type TaskAnchor } from './use-detail-task-anchor'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O ciclo de vida da tarefa ancorada
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A O4.1.1 fez a tarefa parar de destruir a URL. Sobrou o inverso, que a V1.1
 * observou nas três entidades: o Back apaga o `detailId`, o painel fecha, e o
 * formulário continua flutuando sobre a lista — ancorado a um item que já não
 * está aberto. Em A Receber apareceu também em "Alterar data do recebimento",
 * o que provou que o problema nunca foi específico de "Editar".
 *
 * ── Por que a regra ingênua não serve ──
 *
 * "Se o `detailId` sumiu, feche as tarefas" foi tentado e removido: a maioria
 * das tarefas NÃO nasce de um detalhe. "Nova dívida" abre o mesmo `sheetOpen`
 * sem id nenhum, e a regra fecharia o formulário de criação na cara do
 * usuário. Falta a informação de ORIGEM — é o que o anchor carrega.
 *
 * ── Por que a decisão é uma função pura ──
 *
 * O projeto não tem jsdom nem renderer (decisão da Fase 10), e simular o
 * dispatcher do React para exercitar o hook testaria os internals do React,
 * não a regra. A decisão foi extraída para `decideAnchor`, e é ela que carrega
 * a lógica que a V1.1 provou estar faltando.
 */

/**
 * Reproduz a sequência de commits que o React produziria.
 *
 * Cada passo é um estado de `(detailId, taskOpen)`; o anchor atravessa os
 * passos como o `ref` atravessa os renders. É a mesma máquina que o hook roda,
 * sem precisar do React para girá-la.
 */
function sequencia(
  inicial: TaskAnchor,
  passos: Array<{ detailId: string | null; taskOpen: boolean }>,
) {
  let anchor = inicial
  let orfaos = 0

  for (const passo of passos) {
    const decisao = decideAnchor({ anchor, ...passo })
    anchor = decisao.anchor
    if (decisao.action === 'orphan') orfaos++
  }

  return { anchor, orfaos }
}

describe('item 39: o contrato da decisão', () => {
  it('A · tarefa independente sem detalhe não é órfã', () => {
    /*
      A regressão do efeito rejeitado. "Nova dívida" vive com `detailId: null`
      do começo ao fim, e nada pode fechá-la por isso.
    */
    const r = sequencia(null, [{ detailId: null, taskOpen: true }])

    expect(r.orfaos).toBe(0)
  })

  it('B · tarefa ancorada ao detalhe atual continua válida', () => {
    const r = sequencia('D', [{ detailId: 'D', taskOpen: true }])

    expect(r.orfaos).toBe(0)
    expect(r.anchor).toBe('D')
  })

  it('C · o detalhe SOME e a tarefa ancorada fecha', () => {
    /* O Back: `?debtId=D` sai da URL enquanto a edição está aberta. */
    const r = sequencia('D', [
      { detailId: 'D', taskOpen: true },
      { detailId: null, taskOpen: true },
    ])

    expect(r.orfaos).toBe(1)
    expect(r.anchor).toBeNull()
  })

  it('D · o detalhe TROCA e a tarefa ancorada fecha', () => {
    /* Editar D1 não pode ficar aberto sobre o detalhe D2. */
    const r = sequencia('D1', [
      { detailId: 'D1', taskOpen: true },
      { detailId: 'D2', taskOpen: true },
    ])

    expect(r.orfaos).toBe(1)
  })

  it('E · fechar a tarefa normalmente limpa o anchor', () => {
    /*
      Cancelar, salvar, Escape e backdrop caem todos aqui: o anchor é zerado
      por `taskOpen` virar false, sem cada saída precisar lembrar disso.
    */
    const r = sequencia('D', [
      { detailId: 'D', taskOpen: true },
      { detailId: 'D', taskOpen: false },
      { detailId: null, taskOpen: false },
    ])

    expect(r.orfaos).toBe(0)
    expect(r.anchor).toBeNull()
  })

  it('F · anchor limpo não reage a mudança posterior do detalhe', () => {
    /*
      Item 47: Back fecha a tarefa, Forward reabre o DETALHE — e a tarefa não
      volta. Ela é transiente; nada dela é serializado.
    */
    const r = sequencia('D', [
      { detailId: 'D', taskOpen: true },
      /* Back: órfã aqui, e só aqui. */
      { detailId: null, taskOpen: true },
      { detailId: null, taskOpen: false },
      /* Forward: o detalhe volta, a tarefa não. */
      { detailId: 'D', taskOpen: false },
    ])

    expect(r.orfaos).toBe(1)
  })
})

describe('itens 20, 21 e 40: origem da tarefa', () => {
  it('item 40 · Create sem detalhe permanece aberta', () => {
    /*
      OBRIGATÓRIO: é exatamente a regressão que o efeito genérico rejeitado
      teria causado. O usuário abre "Nova dívida" numa lista sem detalhe
      nenhum, e o formulário tem de sobreviver a todos os commits seguintes.
    */
    const r = sequencia(null, [
      { detailId: null, taskOpen: true },
      { detailId: null, taskOpen: true },
      { detailId: null, taskOpen: true },
    ])

    expect(r.orfaos).toBe(0)
  })

  it('Create aberta ENQUANTO um detalhe existe também não é órfã', () => {
    /*
      Caso menos óbvio: nada impede a lista de ter um `?debtId=` na URL quando
      o usuário clica em "Nova dívida". A tarefa não nasceu daquele detalhe, e
      fechar o painel depois não pode levar o formulário junto.
    */
    const r = sequencia(null, [
      { detailId: 'D', taskOpen: true },
      { detailId: null, taskOpen: true },
    ])

    expect(r.orfaos).toBe(0)
  })

  it('item 21 · criar logo após editar não herda o anchor anterior', () => {
    const depoisDaEdicao = sequencia('D', [
      { detailId: 'D', taskOpen: true },
      { detailId: 'D', taskOpen: false },
    ])
    expect(depoisDaEdicao.anchor).toBeNull()

    /* `beginStandalone` reafirma o `null`; a criação segue independente. */
    const criacao = sequencia(null, [{ detailId: null, taskOpen: true }])
    expect(criacao.orfaos).toBe(0)
  })

  it('item 11 · uma tarefa que leva a outra mantém o anchor', () => {
    /*
      Fluxo real: escopo de parcelamento → formulário de edição. A cadeia
      inteira pertence ao mesmo detalhe, e `taskOpen` nunca chega a false
      entre as duas — então o anchor atravessa intacto e o Back ainda fecha.
    */
    const r = sequencia('D', [
      /* Diálogo de escopo aberto. */
      { detailId: 'D', taskOpen: true },
      /* Escopo fecha e o sheet abre no mesmo commit: `taskOpen` não oscila. */
      { detailId: 'D', taskOpen: true },
      { detailId: null, taskOpen: true },
    ])

    expect(r.orfaos).toBe(1)
  })
})

describe('itens 34 e 36: órfã não se confunde com exclusão bem-sucedida', () => {
  it('delete com sucesso não dispara cleanup de órfã', () => {
    /*
      O diálogo zera o próprio alvo ANTES de o `detail.close()` chegar à URL,
      então o commit em que o id some já tem `taskOpen: false`. O resultado é
      o mesmo — lista sem tarefa e sem `detailId` — mas por "clear", não por
      "orphan": nenhum cleanup destrutivo extra roda.
    */
    const r = sequencia('D', [
      { detailId: 'D', taskOpen: true },
      { detailId: 'D', taskOpen: false },
      { detailId: null, taskOpen: false },
    ])

    expect(r.orfaos).toBe(0)
    expect(r.anchor).toBeNull()
  })

  it('itens 33 e 48 · falha ao salvar mantém a tarefa e o anchor', () => {
    /*
      A mutation terminou, mas a tarefa não: o erro continua na tela e o
      `detailId` continua o mesmo. Tratar "mutation completou" como fim de
      tarefa fecharia o formulário com o erro ainda por resolver.
    */
    const r = sequencia('D', [
      { detailId: 'D', taskOpen: true },
      { detailId: 'D', taskOpen: true },
    ])

    expect(r.orfaos).toBe(0)
    expect(r.anchor).toBe('D')
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O anchor não é uma segunda fonte de verdade
 * ══════════════════════════════════════════════════════════════════════════
 */
describe('itens 3, 26, 27, 28 e 50: os limites do anchor', () => {
  const FONTE = readFileSync(
    new URL('./use-detail-task-anchor.ts', import.meta.url),
    'utf-8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  it('não conhece o router', () => {
    /*
      Reabrir o detalhe a partir do anchor derrotaria o próprio Back, e fechar
      a tarefa com `router.back()` mexeria num histórico que já avançou. A
      única reação legítima é limpar state local.
    */
    for (const proibido of [
      'useRouter',
      'usePathname',
      'useSearchParams',
      'router.',
      'next/navigation',
    ]) {
      expect(FONTE, `o hook conhece ${proibido}`).not.toContain(proibido)
    }
  })

  it('item 26 · a tarefa não vai para a URL', () => {
    for (const proibido of ['URLSearchParams', 'searchParams', 'history.']) {
      expect(FONTE, `a tarefa vazou para a URL via ${proibido}`).not.toContain(
        proibido,
      )
    }
  })

  it('item 31 · o anchor não é persistido', () => {
    /*
      Depois do reload, a URL restaura o detalhe e a tarefa simplesmente não
      existe mais. Persistir o anchor ressuscitaria contexto de uma tarefa que
      ninguém pediu de volta.
    */
    for (const proibido of ['localStorage', 'sessionStorage', 'document.cookie']) {
      expect(FONTE, `o anchor é persistido via ${proibido}`).not.toContain(
        proibido,
      )
    }
  })

  it('item 23 · o hook não executa mutation nenhuma', () => {
    /*
      Back durante uma confirmação é CANCELAMENTO. O hook só fecha UI — quem
      apagaria algo é o `onOrphaned` da página, e ele também não muta.
    */
    for (const proibido of ['mutate', 'useMutation', 'fetch(']) {
      expect(FONTE, `o hook executa ${proibido}`).not.toContain(proibido)
    }
  })
})
