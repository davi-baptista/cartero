import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { withDetailParam, withoutDetailParams } from './detail-navigation'
import { decideAnchor } from './use-detail-task-anchor'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O detalhe da Transação também vive na URL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A O4.2 traz o Extrato para a arquitetura que as outras três já usam:
 * DETALHE é navegação, TAREFA é estado transitório, e a tarefa nascida do
 * detalhe carrega uma âncora.
 *
 * A foundation (`detail-navigation`, `use-detail-entity`,
 * `use-detail-task-anchor`) já tem suíte própria e foi validada em navegador.
 * Aqui só se protege o que é DESTE consumidor — e o Extrato tem duas coisas
 * que as outras páginas não tinham:
 *
 * 1. `highlight`, que aponta para uma transação SEM abrir painel nenhum;
 * 2. a cadeia Detalhe → Escopo de parcelamento → Edição/Exclusão, onde a
 *    âncora precisa sobreviver à transição entre duas tarefas.
 */

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8')

/** Sem comentários: a prosa explica o bug e casaria com as asserções. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const EXTRATO = code(ler('../app/(dashboard)/transactions/page.tsx'))

/*
  Recorta um bloco até a próxima linha em branco.

  Os arquivos do projeto estão em CRLF, e `indexOf('\n\n')` devolve -1 neles —
  `slice` a partir daí arrastaria o ARQUIVO INTEIRO, e a asserção passaria a
  casar com qualquer nome escrito em qualquer lugar da página. Foi assim que a
  mutação de `taskOpen` sobreviveu à primeira rodada de probes: o `scopeDialog`
  havia saído da derivação, mas continuava escrito no diálogo logo abaixo.
*/
const bloco = (fonte: string, inicio: number) => {
  expect(inicio, 'âncora do bloco não encontrada').toBeGreaterThan(-1)
  const fim = fonte.slice(inicio).search(/\r?\n[ \t]*\r?\n/)
  expect(fim, 'bloco sem fim delimitado').toBeGreaterThan(-1)
  return fonte.slice(inicio, inicio + fim)
}

describe('a identidade do detalhe vem da URL', () => {
  it('a linha pede a abertura pelo id, não guarda a entidade', () => {
    expect(EXTRATO).toContain("useDetailNavigation('transactionId')")

    /*
      AMBAS as superfícies de linha precisam abrir pela URL: a transação
      avulsa e a parcela dentro de um grupo de parcelamento. Uma asserção
      solta de `toContain` passaria com metade migrada — a parcela abriria
      um painel sem endereço, e só o parcelamento perderia link direto,
      refresh e Back.
    */
    const aberturas = EXTRATO.match(/onView=\{\(tx\) => detail\.open\(tx\.id\)\}/g) ?? []
    expect(aberturas).toHaveLength(2)

    /* Nenhuma linha pode continuar entregando a entidade a um setState. */
    expect(EXTRATO).not.toMatch(/onView=\{set[A-Z]/)
  })

  it('não sobrou state local como segunda fonte de identidade', () => {
    /*
      `detailsTx` era o `useState<Transaction | null>` que guardava a
      transação aberta. Duas fontes discordariam: a URL diria uma coisa, o
      state outra, e o refresh mostraria a terceira (nada).

      A busca é pelo nome do state, não por "useState" — `editTx`,
      `deleteTarget`, `scopeDialog` e `pendingEdit` continuam legítimos: são
      ALVOS DE TAREFA, não identidade de detalhe.
    */
    expect(EXTRATO).not.toContain('detailsTx')
    expect(EXTRATO).not.toContain('setDetailsTx')
  })

  it('o painel é alimentado pela entidade resolvida, não por state', () => {
    expect(EXTRATO).toContain('transaction={taskOpen ? null : detailEntity}')
  })

  it('link direto e refresh resolvem por id; o clique usa a lista', () => {
    expect(EXTRATO).toContain('fetchById: getTransaction')
    expect(EXTRATO).toContain('fromList: transactions?.find((t) => t.id === detail.openId)')
  })

  it('id que não resolve limpa o param em vez de deixar o painel girando', () => {
    expect(EXTRATO).toContain('onNotFound: detail.close')
  })

  it('fechar o painel usa o fechamento explícito da foundation', () => {
    expect(EXTRATO).toContain('if (!open) detail.close()')
  })
})

describe('highlight é outra semântica, e continua sendo', () => {
  /*
    O Extrato já recebia `highlight=<id>` de "Ver a compra" (Fase 8B): a lista
    rola até a linha e a realça por 2,6s. Isso NÃO é identidade de detalhe.

    Confundir os dois quebraria o fluxo de origem de uma cobrança automática:
    clicar em "Compra no cartão" passaria a abrir o painel sozinho, coisa que
    o usuário não pediu.
  */

  it('highlight não abre painel: ele não alimenta a navegação do detalhe', () => {
    expect(EXTRATO).toContain("useHighlight(")
    expect(EXTRATO).toContain("searchParams.get('highlight')")
    /* O que abre o detalhe é `transactionId`, e só ele. */
    expect(EXTRATO).not.toContain("useDetailNavigation('highlight')")
    expect(EXTRATO).not.toContain("detail.open(searchParams.get('highlight')")
  })

  it('abrir o detalhe preserva highlight — e os dois podem ser ids diferentes', () => {
    const params = new URLSearchParams('highlight=T1&startDate=2026-08-01')
    const aberto = withDetailParam(params, 'transactionId', 'T2')

    expect(aberto.get('transactionId')).toBe('T2')
    expect(aberto.get('highlight')).toBe('T1')
    expect(aberto.get('startDate')).toBe('2026-08-01')
  })

  it('fechar o detalhe remove só o transactionId; highlight fica', () => {
    const params = new URLSearchParams('highlight=T1&transactionId=T2&endDate=2026-08-31')
    const fechado = withoutDetailParams(params)

    expect(fechado.has('transactionId')).toBe(false)
    expect(fechado.get('highlight')).toBe('T1')
    expect(fechado.get('endDate')).toBe('2026-08-31')
  })

  it('highlight e transactionId no MESMO id é válido e não se anulam', () => {
    /*
      Chegar destacando uma compra e abrir o detalhe dela é um fluxo legítimo.
      Remover o highlight só porque o painel abriu apagaria a pista visual de
      onde a linha está quando o painel fechar.
    */
    const aberto = withDetailParam(new URLSearchParams('highlight=T1'), 'transactionId', 'T1')

    expect(aberto.get('transactionId')).toBe('T1')
    expect(aberto.get('highlight')).toBe('T1')
  })
})

describe('período e filtros sobrevivem à navegação do detalhe', () => {
  it('abrir e fechar preservam o recorte temporal e os filtros', () => {
    const original = 'startDate=2026-08-01&endDate=2026-08-31&categoryId=C1&invoicePeriod=true&group=direct'

    const aberto = withDetailParam(new URLSearchParams(original), 'transactionId', 'T1')
    const fechado = withoutDetailParams(aberto)

    for (const [chave, valor] of new URLSearchParams(original)) {
      expect(aberto.get(chave), `abrir perdeu ${chave}`).toBe(valor)
      expect(fechado.get(chave), `fechar perdeu ${chave}`).toBe(valor)
    }
  })

  it('abrir a Transação remove outros detalhes canônicos', () => {
    /* Exclusividade: nunca dois painéis empilhados por URL. */
    const aberto = withDetailParam(
      new URLSearchParams('debtId=D1&invoiceId=I1'),
      'transactionId',
      'T1',
    )

    expect(aberto.get('transactionId')).toBe('T1')
    expect(aberto.has('debtId')).toBe(false)
    expect(aberto.has('invoiceId')).toBe(false)
  })
})

describe('a tarefa nascida do detalhe carrega âncora', () => {
  it('editar e excluir ancoram — e NÃO fecham o detalhe', () => {
    /*
      Recorta CADA handler até o seu próprio fim. Uma asserção sobre o resto
      do arquivo passaria com um dos dois quebrado, já que o vizinho contém a
      mesma chamada — e a V1 mostrou que basta um handler esquecido para a
      tarefa ficar órfã.
    */
    const handler = (nome: string) => {
      const inicio = EXTRATO.indexOf(`function ${nome}(`)
      expect(inicio, `${nome} não encontrado`).toBeGreaterThan(-1)
      const fim = EXTRATO.indexOf('\n  }', inicio)
      expect(fim, `${nome} sem fim delimitado`).toBeGreaterThan(inicio)
      return EXTRATO.slice(inicio, fim)
    }

    for (const nome of ['handleEdit', 'handleDelete']) {
      const corpo = handler(nome)
      expect(corpo, `${nome} não ancorou a tarefa`).toContain(
        'taskAnchor.beginFromDetail()',
      )
      /*
        O gesto que a V1 flagrou nas outras três páginas: um `close` no
        começo do handler, herdado da O1. Ali era state local; aqui seria a
        URL — e cancelar devolveria o usuário à lista.
      */
      expect(corpo, `${nome} destrói a URL do detalhe`).not.toContain('detail.close()')
    }
  })

  it('criar é standalone, e é o próprio botão de criar que declara isso', () => {
    /*
      A regra ingênua "sumiu o detailId, feche tudo" fecharia "Nova transação"
      na cara do usuário — foi o motivo de a O4.1.2 precisar da âncora.

      Verifica que a marcação está JUNTO da abertura do formulário vazio
      (`setEditTx(null)`), não apenas presente em algum lugar do arquivo:
      trocar o standalone por `beginFromDetail` reintroduziria exatamente o
      bug que a âncora existe para evitar.
    */
    const abrirCriacao = /setEditTx\(null\)\s*setSheetOpen\(true\)/g
    const pontosDeCriacao = EXTRATO.match(abrirCriacao) ?? []
    expect(pontosDeCriacao.length, 'nenhum ponto de criação encontrado')
      .toBeGreaterThan(0)

    /* Cada um deles precisa declarar standalone imediatamente antes. */
    const standalone =
      EXTRATO.match(
        /taskAnchor\.beginStandalone\(\)\s*setEditTx\(null\)\s*setSheetOpen\(true\)/g,
      ) ?? []
    expect(
      standalone.length,
      'algum ponto de criação não foi marcado como standalone',
    ).toBe(pontosDeCriacao.length)

    /* E nenhum pode ancorar num detalhe. */
    expect(EXTRATO).not.toMatch(
      /taskAnchor\.beginFromDetail\(\)\s*setEditTx\(null\)\s*setSheetOpen\(true\)/,
    )
  })

  it('a âncora é ligada ao id da URL, e o cleanup só toca em tarefa', () => {
    expect(EXTRATO).toContain('detailId: detail.openId')
    expect(EXTRATO).toContain('onOrphaned: closeTransientTasks')

    const inicio = EXTRATO.indexOf('const closeTransientTasks')
    const fim = EXTRATO.slice(inicio).search(/\r?\n {2}\}/)
    expect(fim, 'cleanup sem fim delimitado').toBeGreaterThan(-1)
    const corpo = EXTRATO.slice(inicio, inicio + fim)

    /* Fecha tarefa. Não mexe em URL, filtro, período nem cache. */
    expect(corpo).toContain('setSheetOpen(false)')
    expect(corpo).toContain('setScopeDialog(null)')
    expect(corpo).toContain('setDeleteTarget(null)')
    expect(corpo).not.toContain('detail.')
    expect(corpo).not.toContain('router.')
    expect(corpo).not.toContain('setFilters')
  })
})

describe('taskOpen cobre a cadeia inteira do parcelamento', () => {
  /*
    O Extrato é a única das quatro páginas com uma cadeia de DUAS tarefas:

        Detalhe → Editar → (submit) → Escopo → salvar
        Detalhe → Excluir → Escopo → confirmar

    Se `taskOpen` esquecesse o escopo, ele ficaria falso no instante entre
    fechar o formulário e abrir o diálogo. `decideAnchor` leria "nenhuma
    tarefa aberta", zeraria a âncora — e o escopo seguiria adiante órfão,
    imune ao Back.
  */

  it('a derivação inclui formulário, escopo e confirmação', () => {
    const derivacao = bloco(EXTRATO, EXTRATO.indexOf('const taskOpen'))

    expect(derivacao).toContain('sheetOpen')
    expect(derivacao, 'o escopo de parcelamento ficou fora de taskOpen')
      .toContain('scopeDialog !== null')
    expect(derivacao, 'a confirmação de exclusão ficou fora de taskOpen')
      .toContain('deleteTarget !== null')
  })

  it('a âncora sobrevive à transição formulário → escopo', () => {
    /*
      Durante a cadeia o `transactionId` não muda, então a âncora continua
      casando. O que a mataria seria `taskOpen` piscar para falso no meio.
    */
    const noMeioDaCadeia = decideAnchor({
      anchor: 'T1',
      detailId: 'T1',
      taskOpen: true,
    })

    expect(noMeioDaCadeia).toEqual({ action: 'keep', anchor: 'T1' })
  })

  it('se taskOpen piscasse falso no meio, a âncora seria perdida', () => {
    /*
      Testa a PROPRIEDADE que a derivação acima protege — é por isso que o
      escopo precisa estar em `taskOpen`, e não por gosto de completude.
    */
    const piscou = decideAnchor({
      anchor: 'T1',
      detailId: 'T1',
      taskOpen: false,
    })

    expect(piscou.anchor).toBeNull()
  })
})

describe('o Back durante a tarefa fecha a tarefa', () => {
  it('detailId sumiu com tarefa aberta: órfã', () => {
    expect(decideAnchor({ anchor: 'T1', detailId: null, taskOpen: true })).toEqual({
      action: 'orphan',
      anchor: null,
    })
  })

  it('detailId trocou de T1 para T2: a tarefa de T1 fecha', () => {
    expect(decideAnchor({ anchor: 'T1', detailId: 'T2', taskOpen: true })).toEqual({
      action: 'orphan',
      anchor: null,
    })
  })

  it('criação não é órfã quando não há detalhe algum', () => {
    expect(decideAnchor({ anchor: null, detailId: null, taskOpen: true })).toEqual({
      action: 'keep',
      anchor: null,
    })
  })
})

describe('a exclusão só limpa a URL quando dá certo', () => {
  it('o sucesso fecha o detalhe; o erro não toca no param', () => {
    const inicio = EXTRATO.indexOf('const deleteMut')
    const mutation = EXTRATO.slice(inicio, EXTRATO.indexOf('const filteredTransactions', inicio))

    const sucesso = mutation.slice(
      mutation.indexOf('onSuccess'),
      mutation.indexOf('onError'),
    )
    const erro = mutation.slice(mutation.indexOf('onError'))

    expect(sucesso).toContain('detail.close()')
    /*
      Recusa por fatura paga ou por recebível já liquidado é o caso comum
      aqui: a transação continua existindo, e o usuário precisa voltar ao
      detalhe dela — não a uma lista sem contexto.
    */
    expect(erro).not.toContain('detail.close()')
  })
})

describe('os primitivos continuam sem saber de rota', () => {
  it('o painel recebe a transação por prop', () => {
    const dialog = EXTRATO.slice(EXTRATO.indexOf('function TransactionDetailsDialog'))
    const assinatura = dialog.slice(0, dialog.indexOf('}) {'))

    expect(assinatura).toContain('transaction: Transaction | null')
    expect(assinatura).not.toContain('transactionId')
    expect(assinatura).not.toContain('useRouter')
  })

  it('a navegação fica no consumidor, nunca no primitivo de linha', () => {
    const row = code(ler('../components/ui/financial-list-row.tsx'))

    expect(row).not.toContain('useRouter')
    expect(row).not.toContain('useSearchParams')
    expect(row).not.toContain('transactionId')
  })
})
