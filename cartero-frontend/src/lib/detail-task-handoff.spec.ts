import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { withDetailParam, withoutDetailParams } from './detail-navigation'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A tarefa esconde o detalhe; só o sucesso o dispensa
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A O4.1 pôs a identidade do detalhe na URL. As páginas, porém, já tinham um
 * `closeDetail()` herdado da O1, chamado no começo de cada handler de tarefa —
 * ali ele apenas limpava um `useState` e era inofensivo.
 *
 * Repontado para a URL, o mesmo gesto virou destruição de navegação: abrir
 * "Editar" a partir de `/debts?debtId=x` reescrevia o endereço para `/debts`.
 * Cancelar devolvia o usuário a uma lista sem contexto, o Back não voltava ao
 * detalhe, e o refresh no meio da edição perdia o item.
 *
 * ── A correção é DERIVAR, não sinalizar ──
 *
 * Um `taskOpen` próprio precisaria ser limpo em cada saída — cancelar, salvar,
 * erro, Escape, backdrop, clique fora. Esquecer UMA delas deixaria o painel
 * invisível para sempre, com a URL ainda dizendo que ele está aberto: um
 * estado do qual o usuário não sai nem recarregando.
 *
 * Derivando dos states de tarefa que já existem, fechar a tarefa reexibe o
 * painel por construção.
 *
 * ── O que este arquivo protege ──
 *
 * O comportamento de histórico depende do router, mas o CONTRATO — quem pode
 * mexer na URL, e em que momento — é legível na fonte. É o que se fixa aqui.
 */

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8')

/** Sem comentários: a prosa explica o bug e casaria com as asserções. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/*
  Recorta um bloco até a próxima linha em branco.

  Os arquivos do projeto estão em CRLF, e a primeira versão deste recorte
  usava `indexOf('\n\n')` — que devolve -1 num arquivo CRLF. `slice(inicio, -1)`
  corta o arquivo INTEIRO menos um caractere, então a asserção passava a ler a
  página toda e casava com qualquer nome escrito em qualquer lugar dela.

  Foi exatamente assim que a mutação de `sourceDeleteTarget` sobreviveu à
  primeira rodada: o state havia saído da derivação, mas continuava escrito no
  ConfirmDialog logo abaixo, dentro do trecho que o recorte defeituoso
  arrastava junto.
*/
const bloco = (fonte: string, inicio: number) => {
  const fim = fonte.slice(inicio).search(/\r?\n[ \t]*\r?\n/)
  expect(fim, 'bloco sem fim delimitado').toBeGreaterThan(-1)
  return fonte.slice(inicio, inicio + fim)
}

/**
 * O corpo de uma função de topo do componente, até a chave que a fecha.
 *
 * Uma janela de tamanho fixo não serve: 500 caracteres a partir de
 * `handleEdit` atravessam para dentro de `handleDelete`, e uma asserção sobre
 * o primeiro passa lendo a chamada do segundo. Foi assim que a probe P1 —
 * remover o anchor de `handleEdit` — sobreviveu à primeira rodada.
 *
 * As funções são declaradas com dois espaços de indentação, então `\n  }`
 * fecha exatamente esta função e nenhum bloco aninhado dentro dela.
 */
const corpoDaFuncao = (fonte: string, nome: string) => {
  const inicio = fonte.indexOf(`function ${nome}(`)
  expect(inicio, `${nome} não encontrado`).toBeGreaterThan(-1)

  const fim = fonte.slice(inicio).search(/\r?\n {2}\}/)
  expect(fim, `${nome} sem fim delimitado`).toBeGreaterThan(-1)
  return code(fonte.slice(inicio, inicio + fim))
}

const PAGINAS = {
  Dívidas: {
    fonte: ler('../app/(dashboard)/debts/page.tsx'),
    param: 'debtId',
    tarefas: ['handleEdit', 'handleDelete', 'handleTogglePaid'],
  },
  'A Receber': {
    fonte: ler('../app/(dashboard)/receivables/page.tsx'),
    param: 'receivableId',
    tarefas: ['handleEdit', 'handleDelete', 'handleToggleReceived'],
  },
  Assinaturas: {
    fonte: ler('../app/(dashboard)/subscriptions/page.tsx'),
    param: 'subscriptionId',
    tarefas: [],
  },
}

describe('itens 1 a 5: abrir uma tarefa preserva a identidade do detalhe', () => {
  it('nenhum handler de tarefa navega', () => {
    /*
      A asserção precisa ser POR HANDLER. Contar ocorrências no arquivo
      inteiro passava com o delete quebrado, desde que editar estivesse certo
      — e o delete é onde o prejuízo é maior.
    */
    for (const [tela, { fonte, tarefas }] of Object.entries(PAGINAS)) {
      for (const handler of tarefas) {
        expect(
          corpoDaFuncao(fonte, handler),
          `${tela}: ${handler} apaga a identidade da URL`,
        ).not.toContain('detail.close()')
      }
    }
  })

  it('o helper que apagava a URL não voltou', () => {
    /*
      `closeDetail` e `suspendDetail` foram removidos em vez de corrigidos: um
      nome que diz "fecha o detalhe" convida a chamada seguinte a repetir o
      erro. Esconder é responsabilidade da derivação, não de um helper.
    */
    for (const [tela, { fonte }] of Object.entries(PAGINAS)) {
      expect(code(fonte), `${tela}: helper de volta`).not.toContain(
        'function closeDetail(',
      )
      expect(code(fonte), `${tela}: helper de volta`).not.toContain(
        'function suspendDetail(',
      )
    }
  })

  it('item 3: a data de quitação também é tarefa', () => {
    /*
      Este handoff mora inline nas props do drawer, não num `handleX` — foi o
      que sobrou depois da primeira limpeza, e some da busca por handler.
    */
    for (const tela of ['Dívidas', 'A Receber'] as const) {
      const { fonte } = PAGINAS[tela]
      const inicio = fonte.indexOf('onEditSettlementDate={')
      expect(inicio, `${tela}: handoff de data sumiu`).toBeGreaterThan(-1)

      const corpo = fonte.slice(inicio, fonte.indexOf('/>', inicio))
      expect(corpo, `${tela}: a data de quitação navega`).not.toContain(
        'detail.close()',
      )
    }
  })

  it('itens 8 e 12: o painel cede a vez sem ceder o endereço', () => {
    /*
      O drawer recebe `null` enquanto a tarefa está aberta — some da tela,
      permanece na URL. Cancelar traz o mesmo item de volta.
    */
    for (const [tela, { fonte }] of Object.entries(PAGINAS)) {
      expect(code(fonte), `${tela}: painel não cede a vez`).toContain(
        'taskOpen ? null : detailEntity',
      )
    }
  })
})

describe('itens 9 e 10: `taskOpen` é derivado, nunca um flag', () => {
  it('não existe setter de tarefa aberta', () => {
    /*
      Um flag próprio depende de ser limpo em cada saída. Escape e backdrop
      fecham por caminhos que não passam pelos botões, e a saída esquecida
      deixaria o painel invisível com a URL dizendo o contrário.
    */
    for (const [tela, { fonte }] of Object.entries(PAGINAS)) {
      expect(code(fonte), `${tela}: virou flag`).not.toContain('setTaskOpen')
    }
  })

  it('a derivação cobre TODAS as tarefas de cada página', () => {
    /*
      Uma tarefa fora da conta abre por baixo do painel — dois overlays
      empilhados, o de baixo com o estado velho.

      `sourceDeleteTarget` é a que mais escapa: nasceu na O3.1, só existe em A
      Receber, e é a confirmação de excluir a compra de ORIGEM. O item 19 pede
      que o `receivableId` sobreviva a ela até o sucesso.
    */
    const ESPERADO = {
      Dívidas: [
        'sheetOpen',
        'scopeDialog',
        'deleteTarget',
        'markPaidTarget',
        'unmarkPaidTarget',
        'linkedWarningTarget',
        'settlementDateItem',
      ],
      'A Receber': [
        'sheetOpen',
        'scopeDialog',
        'deleteTarget',
        'linkedWarningTarget',
        'sourceDeleteTarget',
        'markPaidTarget',
        'unmarkPaidTarget',
        'settlementDateItem',
      ],
      Assinaturas: ['sheetOpen', 'deleteTarget'],
    }

    for (const [tela, states] of Object.entries(ESPERADO)) {
      const { fonte } = PAGINAS[tela as keyof typeof PAGINAS]
      const inicio = fonte.indexOf('const taskOpen')
      expect(inicio, `${tela}: derivação ausente`).toBeGreaterThan(-1)

      const expressao = bloco(fonte, inicio)
      for (const state of states) {
        expect(expressao, `${tela}: ${state} fora da conta`).toContain(state)
      }
    }
  })

  it('nenhum state de tarefa ficou de fora da derivação', () => {
    /*
      O inverso do teste acima, e o que sobrevive à próxima tarefa criada: em
      vez de conferir uma lista escrita à mão, descobre os states pelo próprio
      arquivo. Uma tarefa nova não coberta falha aqui sem ninguém lembrar de
      atualizar o espelho.
    */
    const IGNORAR = new Set([
      /*
        Alvos de EDIÇÃO, não tarefas: guardam qual item o formulário carrega, e
        continuam preenchidos enquanto ele fecha (a animação de saída leria
        `null` e piscaria vazio). Quem representa a tarefa aberta é `sheetOpen`,
        que já está na conta.
      */
      'editDebt',
      'editReceivable',
      'editTarget',
      'editScope',
    ])

    for (const [tela, { fonte }] of Object.entries(PAGINAS)) {
      const declarados = [
        ...fonte.matchAll(/const \[(\w+), set\w+\] = useState/g),
      ]
        .map((m) => m[1])
        .filter((n) => /Target$|Dialog$|Item$|^sheetOpen$/.test(n))
        .filter((n) => !IGNORAR.has(n))

      /* Descobriu alguma coisa? Senão o teste não está protegendo nada. */
      expect(declarados.length, `${tela}: nenhum state descoberto`).toBeGreaterThan(1)

      const expressao = bloco(fonte, fonte.indexOf('const taskOpen'))
      for (const state of declarados) {
        expect(expressao, `${tela}: ${state} não entra em taskOpen`).toContain(
          state,
        )
      }
    }
  })
})

describe('itens 6 e 7: quem PODE apagar o param', () => {
  it('só o sucesso da exclusão limpa a URL', () => {
    /*
      O registro deixou de existir: manter `?debtId=` faria a busca por id
      devolver 404 e piscar um erro por algo que o usuário mandou apagar.

      Falha NÃO limpa. O registro continua lá, e o usuário volta ao detalhe
      dele em vez de a uma lista sem contexto.
    */
    for (const [tela, { fonte }] of Object.entries(PAGINAS)) {
      const inicio = fonte.indexOf('const deleteMut')
      expect(inicio, `${tela}: deleteMut sumiu`).toBeGreaterThan(-1)

      const fimOnError = fonte.indexOf('onError', inicio)
      expect(fimOnError, `${tela}: onError sumiu`).toBeGreaterThan(inicio)

      const sucesso = code(fonte.slice(inicio, fimOnError))
      expect(sucesso, `${tela}: sucesso não limpa a URL`).toContain(
        'detail.close()',
      )

      const erro = code(bloco(fonte, fimOnError))
      expect(erro, `${tela}: falha não pode limpar a URL`).not.toContain(
        'detail.close()',
      )
    }
  })

  it('fechar de verdade continua sendo X, Escape e backdrop', () => {
    for (const [tela, { fonte }] of Object.entries(PAGINAS)) {
      expect(code(fonte), `${tela}: perdeu o fechar`).toContain(
        'onOpenChange={(open) => !open && detail.close()}',
      )
    }
  })
})

describe('Back durante uma tarefa: o efeito genérico não volta', () => {
  it('nenhuma página fecha tarefa só porque o detalhe sumiu', () => {
    /*
      Houve uma tentativa de fechar as tarefas quando `detail.openId`
      desaparecesse. Ela estava ERRADA, por um motivo que o lint não pegaria:
      a maioria das tarefas não nasce de um detalhe. "Nova dívida" abre o
      mesmo `sheetOpen` SEM `detail.openId`, e o efeito rodaria na montagem —
      fechando o formulário de criação na cara do usuário.

      A O4.1.2 resolve o mesmo problema pela informação que faltava: de qual
      detalhe a tarefa nasceu. A condição crua permanece proibida.
    */
    for (const [tela, { fonte }] of Object.entries(PAGINAS)) {
      expect(code(fonte), `${tela}: condição crua de volta`).not.toContain(
        'if (detail.openId) return',
      )
    }
  })
})

describe('a garantia, em termos de URL', () => {
  /*
    As páginas não são montadas aqui, mas a propriedade que a correção entrega
    é aritmética de query string, e pode ser fixada sem navegador.
  */
  it('cancelar uma tarefa devolve exatamente o mesmo detalhe', () => {
    /*
      Antes: `/receivables?personId=p1&receivableId=r1` → Editar → Cancelar
      caía em `/receivables`, sem detalhe E sem o filtro por pessoa.
    */
    const url = withDetailParam('personId=p1', 'receivableId', 'r1')

    expect(url.get('receivableId')).toBe('r1')
    expect(url.get('personId')).toBe('p1')
  })

  it('só a exclusão bem-sucedida devolve a lista', () => {
    const url = withoutDetailParams(
      withDetailParam('period=2026-08', 'debtId', 'd1').toString(),
    )

    expect(url.get('debtId')).toBeNull()
    /* E o período em que o usuário estava continua de pé. */
    expect(url.get('period')).toBe('2026-08')
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O4.1.2 — a tarefa fecha quando a navegação abandona o detalhe
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A V1.1 confirmou que a O4.1.1 resolveu o sentido "tarefa destrói a URL", e
 * encontrou o inverso: `Detail → Editar → Back` deixava o formulário aberto
 * sobre a lista nas TRÊS entidades, e em A Receber também via "Alterar data do
 * recebimento" — prova de que nunca foi específico de "Editar".
 *
 * A regra do ciclo de vida mora em `decideAnchor` e é testada lá. O que se fixa
 * aqui é a LIGAÇÃO: cada launcher marca a origem certa, e o cleanup de cada
 * página fecha os states que ela realmente tem.
 */
describe('itens 18 e 20: toda tarefa lançada do detalhe é ancorada', () => {
  const LAUNCHERS = {
    'Dívidas': ['handleEdit', 'handleDelete', 'handleTogglePaid'],
    'A Receber': ['handleEdit', 'handleDelete', 'handleToggleReceived'],
  }

  it('itens 41 a 43 · os handlers de tarefa marcam a origem', () => {
    for (const [tela, nomes] of Object.entries(LAUNCHERS)) {
      const { fonte } = PAGINAS[tela as keyof typeof PAGINAS]

      for (const handler of nomes) {
        expect(
          corpoDaFuncao(fonte, handler),
          `${tela}: ${handler} abre tarefa sem ancorar ao detalhe`,
        ).toContain('taskAnchor.beginFromDetail()')
      }
    }
  })

  it('item 44 · a data de quitação é ancorada (FAIL observado na V1.1)', () => {
    /*
      Este launcher mora inline nas props do drawer. Tratar só "Editar" teria
      deixado exatamente o bug que a V1.1 viu em A Receber.
    */
    for (const tela of ['Dívidas', 'A Receber'] as const) {
      const { fonte } = PAGINAS[tela]
      const inicio = fonte.indexOf('onEditSettlementDate={')
      expect(inicio, `${tela}: handoff de data sumiu`).toBeGreaterThan(-1)

      const corpo = fonte.slice(inicio, fonte.indexOf('/>', inicio))
      expect(corpo, `${tela}: settlement não ancorada`).toContain(
        'taskAnchor.beginFromDetail()',
      )
    }
  })

  it('itens 22 e 43 · Assinaturas ancora Editar e Excluir', () => {
    const { fonte } = PAGINAS.Assinaturas

    for (const handler of ['onEdit', 'onDelete']) {
      const inicio = fonte.indexOf(`${handler}={(s) => {`)
      expect(inicio, `${handler} sumiu`).toBeGreaterThan(-1)

      const corpo = fonte.slice(inicio, fonte.indexOf('}}', inicio))
      expect(corpo, `${handler} não ancorada`).toContain(
        'taskAnchor.beginFromDetail()',
      )
    }
  })
})

describe('itens 19, 21 e 40: a tarefa independente NÃO é ancorada', () => {
  it('todo launcher de criação declara-se standalone', () => {
    /*
      OBRIGATÓRIO: é a regressão do efeito genérico rejeitado. Sem a marcação
      explícita, criar logo depois de editar herdaria o anchor da tarefa
      anterior, e o formulário de criação fecharia sozinho.

      Assinaturas tem DOIS botões (cabeçalho e estado vazio) — contar garante
      que nenhum ficou de fora.
    */
    const ESPERADO = { 'Dívidas': 1, 'A Receber': 1, 'Assinaturas': 2 }

    for (const [tela, quantos] of Object.entries(ESPERADO)) {
      const { fonte } = PAGINAS[tela as keyof typeof PAGINAS]
      const marcas = code(fonte).match(/taskAnchor\.beginStandalone\(\)/g) ?? []

      expect(marcas.length, `${tela}: launcher de criação sem marca`).toBe(
        quantos,
      )
    }
  })
})

describe('itens 22, 45 e 46: o cleanup fecha as tarefas reais de cada página', () => {
  const ESPERADO = {
    'Dívidas': [
      'setSheetOpen(false)',
      'setEditDebt(null)',
      'setScopeDialog(null)',
      'setDeleteTarget(null)',
      'setMarkPaidTarget(null)',
      'setUnmarkPaidTarget(null)',
      'setLinkedWarningTarget(null)',
      'setSettlementDateItem(null)',
    ],
    'A Receber': [
      'setSheetOpen(false)',
      'setEditReceivable(null)',
      'setScopeDialog(null)',
      'setDeleteTarget(null)',
      'setLinkedWarningTarget(null)',
      'setSourceDeleteTarget(null)',
      'setMarkPaidTarget(null)',
      'setUnmarkPaidTarget(null)',
      'setSettlementDateItem(null)',
    ],
    'Assinaturas': [
      'setSheetOpen(false)',
      'setEditTarget(null)',
      'setDeleteTarget(null)',
    ],
  }

  it('toda tarefa transiente da página é fechada', () => {
    /*
      Item 46 em especial: `sourceDeleteTarget` é a confirmação de excluir a
      compra de origem. Ficar aberta sobre a lista ofereceria uma exclusão
      destrutiva sem o contexto que a justificava.
    */
    for (const [tela, setters] of Object.entries(ESPERADO)) {
      const { fonte } = PAGINAS[tela as keyof typeof PAGINAS]
      const inicio = fonte.indexOf('const closeTransientTasks')
      expect(inicio, `${tela}: cleanup ausente`).toBeGreaterThan(-1)

      const corpo = bloco(fonte, inicio)
      for (const setter of setters) {
        expect(corpo, `${tela}: ${setter} fora do cleanup`).toContain(setter)
      }
    }
  })

  it('itens 22, 23, 25 e 27 · o cleanup não navega, não filtra e não muta', () => {
    /*
      Órfã é um problema de UI transiente. Mexer em filtro, período, busca ou
      URL puniria o usuário duas vezes pelo mesmo Back — e disparar mutation
      transformaria um cancelamento em confirmação.
    */
    const PROIBIDO = [
      'detail.close()',
      'router.',
      'setPersonFilter',
      'setSearch',
      'setPeriod',
      'setTab',
      'invalidateQueries',
      '.mutate(',
    ]

    for (const [tela, { fonte }] of Object.entries(PAGINAS)) {
      const corpo = code(bloco(fonte, fonte.indexOf('const closeTransientTasks')))

      for (const proibido of PROIBIDO) {
        expect(corpo, `${tela}: cleanup executa ${proibido}`).not.toContain(
          proibido,
        )
      }
    }
  })

  it('item 37 · a detecção é compartilhada, o cleanup é de cada página', () => {
    /*
      Reimplementar a detecção por página é exatamente como as três voltariam
      a divergir — foi assim que A Receber chegou à O4.1.1 com o mesmo defeito
      que a V1 só reproduziu em Dívidas.
    */
    for (const [tela, { fonte }] of Object.entries(PAGINAS)) {
      expect(code(fonte), `${tela}: não usa o hook`).toContain(
        'useDetailTaskAnchor({',
      )
      expect(code(fonte), `${tela}: cleanup desligado do hook`).toContain(
        'onOrphaned: closeTransientTasks',
      )
      expect(code(fonte), `${tela}: anchor não observa a URL`).toContain(
        'detailId: detail.openId',
      )
    }
  })
})

describe('itens 1 e 38: a foundation não virou framework de tarefas', () => {
  it('nenhuma das duas conhece tarefa ou anchor', () => {
    /*
      A V1 e a V1.1 provaram as duas corretas. O ciclo de vida de tarefa vive
      em arquivo separado justamente para não contaminá-las.
    */
    const FOUNDATION = [
      ['detail-navigation', ler('./detail-navigation.ts')],
      ['use-detail-entity', ler('./use-detail-entity.ts')],
    ] as const

    for (const [nome, fonte] of FOUNDATION) {
      const limpo = code(fonte)
      for (const proibido of ['taskAnchor', 'taskOpen', 'Transient']) {
        expect(limpo, `${nome} conhece ${proibido}`).not.toContain(proibido)
      }
    }
  })
})
