import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DETAIL_PARAMS,
  detailHref,
  withDetailParam,
  withoutDetailParams,
} from './detail-navigation'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A URL do detalhe preserva tudo o mais
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O risco desta migração não é o param do detalhe funcionar — é ele levar
 * junto o que já estava lá. Reconstruir a query do zero é exatamente como
 * filtros e período somem sem ninguém notar, e a página volta ao estado
 * inicial ao abrir um painel.
 *
 * As funções são puras de propósito: o comportamento de histórico depende do
 * router, mas ESTE contrato — o que sobrevive — pode ser fixado sem navegador.
 */

describe('item 38: abrir preserva o resto da query', () => {
  it('mantém período, filtro e busca', () => {
    const antes = 'period=2026-08&personId=p1&search=uber'
    const depois = withDetailParam(antes, 'debtId', 'd1')

    expect(depois.get('period')).toBe('2026-08')
    expect(depois.get('personId')).toBe('p1')
    expect(depois.get('search')).toBe('uber')
    expect(depois.get('debtId')).toBe('d1')
  })

  it('itens 20 e 29: o `personId` de Dívidas é FILTRO, não detalhe', () => {
    /*
      A colisão que a auditoria encontrou. Em Dívidas, `personId` recorta a
      lista por pessoa; em Pessoas, identifica o extrato aberto. Abrir uma
      dívida não pode limpar o filtro.

      `/debts?personId=p1&debtId=d1` = lista filtrada por p1, detalhe d1.
    */
    const depois = withDetailParam('personId=p1', 'debtId', 'd1')

    expect(depois.get('personId')).toBe('p1')
    expect(depois.get('debtId')).toBe('d1')
  })

  it('itens 26 e 27: `highlight` sobrevive', () => {
    /*
      Ênfase na lista é outra dimensão: `highlight` rola e destaca uma linha,
      `receivableId` diz qual painel está aberto. Os dois podem coexistir.
    */
    const depois = withDetailParam('highlight=r1', 'receivableId', 'r2')

    expect(depois.get('highlight')).toBe('r1')
    expect(depois.get('receivableId')).toBe('r2')
  })

  it('item 6: abrir um detalhe fecha qualquer outro', () => {
    /*
      Nunca dois painéis empilhados por URL. A limpeza é sobre a lista
      explícita de params de detalhe — nada é adivinhado por sufixo.
    */
    const depois = withDetailParam(
      'debtId=d1&receivableId=r1&period=2026-08',
      'subscriptionId',
      's1',
    )

    expect(depois.get('subscriptionId')).toBe('s1')
    expect(depois.get('debtId')).toBeNull()
    expect(depois.get('receivableId')).toBeNull()
    expect(depois.get('period')).toBe('2026-08')
  })

  it('trocar de detalhe substitui, não acumula', () => {
    const depois = withDetailParam('debtId=d1', 'debtId', 'd2')
    expect(depois.getAll('debtId')).toEqual(['d2'])
  })
})

describe('item 41: fechar remove só o detalhe', () => {
  it('preserva período, filtro e highlight', () => {
    const depois = withoutDetailParams(
      'period=2026-08&personId=p1&highlight=d9&debtId=d1',
    )

    expect(depois.get('debtId')).toBeNull()
    expect(depois.get('period')).toBe('2026-08')
    expect(depois.get('personId')).toBe('p1')
    expect(depois.get('highlight')).toBe('d9')
  })

  it('limpa qualquer param de detalhe, não só o da própria página', () => {
    /*
      Estado inválido herdado de uma URL montada à mão não pode sobreviver ao
      fechar.
    */
    const depois = withoutDetailParams('debtId=d1&invoiceId=i1&transactionId=t1')
    for (const param of DETAIL_PARAMS) expect(depois.get(param)).toBeNull()
  })
})

describe('a URL final', () => {
  it('não deixa interrogação órfã quando nada sobra', () => {
    const params = withoutDetailParams('debtId=d1')
    expect(detailHref('/debts', params)).toBe('/debts')
  })

  it('mantém a query quando algo sobra', () => {
    const params = withoutDetailParams('period=2026-08&debtId=d1')
    expect(detailHref('/debts', params)).toBe('/debts?period=2026-08')
  })

  it('não toca no pathname', () => {
    const params = withDetailParam('', 'debtId', 'd1')
    expect(detailHref('/debts', params)).toBe('/debts?debtId=d1')
  })
})

describe('itens 34 e 5: os params declarados', () => {
  it('cobre as três entidades desta fase e as futuras', () => {
    /*
      `transactionId`, `invoiceId` e `personId` constam desde já para que a
      exclusividade funcione quando O4.2/O4.3 chegarem — senão a primeira
      migração seguinte esqueceria de limpar as anteriores.
    */
    expect(DETAIL_PARAMS).toContain('debtId')
    expect(DETAIL_PARAMS).toContain('receivableId')
    expect(DETAIL_PARAMS).toContain('subscriptionId')
    expect(DETAIL_PARAMS).toContain('transactionId')
    expect(DETAIL_PARAMS).toContain('invoiceId')
  })

  it('nenhum param genérico', () => {
    /* `id` não diz de que entidade, e colidiria entre páginas. */
    expect(DETAIL_PARAMS).not.toContain('id')
    expect(DETAIL_PARAMS).not.toContain('highlight')
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════
 * As três páginas migradas
 * ══════════════════════════════════════════════════════════════════════════
 */
describe('itens 8 e 50: a identidade vem da URL', () => {
  const ler = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), 'utf-8')

  const code = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const PAGINAS = {
    Dívidas: { fonte: ler('../app/(dashboard)/debts/page.tsx'), param: 'debtId' },
    'A Receber': {
      fonte: ler('../app/(dashboard)/receivables/page.tsx'),
      param: 'receivableId',
    },
    Assinaturas: {
      fonte: ler('../app/(dashboard)/subscriptions/page.tsx'),
      param: 'subscriptionId',
    },
  }

  it('cada página usa o seu param canônico', () => {
    for (const [nome, { fonte, param }] of Object.entries(PAGINAS)) {
      expect(fonte, `${nome} deveria usar ${param}`).toContain(
        `useDetailNavigation('${param}')`,
      )
    }
  })

  it('não sobrou state local guardando a entidade aberta', () => {
    /*
      Duas fontes de verdade para "o que está aberto" divergem: o state diria
      aberto enquanto a URL diz fechado, e o Back não teria efeito.
    */
    for (const [nome, { fonte }] of Object.entries(PAGINAS)) {
      expect(code(fonte), `${nome} manteve state de detalhe`).not.toContain(
        'setDetailTarget',
      )
    }
  })

  it('item 4: os primitives visuais continuam sem router', () => {
    const PRIMITIVE = ler('../components/ui/financial-list-row.tsx')
    const SHELL = ler('../components/ui/detail-drawer.tsx')

    for (const [nome, fonte] of [
      ['FinancialListRow', PRIMITIVE],
      ['DetailDrawer', SHELL],
    ] as const) {
      for (const proibido of ['useRouter', 'useSearchParams', 'usePathname']) {
        expect(code(fonte), `${nome} conhece ${proibido}`).not.toContain(
          proibido,
        )
      }
    }
  })

  it('itens 15 e 17: a lista resolve antes de buscar por id', () => {
    /*
      Clicar numa linha não pode disparar requisição para algo que já está na
      tela. A busca por id é fallback de link direto e refresh.
    */
    for (const [nome, { fonte }] of Object.entries(PAGINAS)) {
      expect(fonte, `${nome} deveria resolver pela lista`).toContain('fromList:')
      expect(fonte, `${nome} precisa do fallback`).toContain('fetchById:')
      expect(fonte, `${nome} precisa tratar id inválido`).toContain(
        'onNotFound: detail.close',
      )
    }
  })
})

describe('itens 9, 10 e 47: abrir empurra, fechar substitui', () => {
  /*
    Sem comentários: a prosa da foundation cita `router.back()` e `push` para
    explicar por que NÃO os usa, e a asserção casaria com a explicação.
  */
  const FOUNDATION = readFileSync(
    new URL('./detail-navigation.ts', import.meta.url),
    'utf-8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  it('abrir cria entrada no histórico', () => {
    expect(FOUNDATION).toContain('router.push(')
  })

  it('fechar SUBSTITUI em vez de empurrar', () => {
    /*
      A sequência que decide a estratégia: lista → abrir → X → Back.

      Com `push` no fechar, o histórico ficaria [lista, detalhe, lista] e o
      Back reabriria o painel que o usuário acabou de dispensar. Com
      `replace`, a entrada do detalhe é substituída e o Back leva ao que havia
      antes dela.

      `router.back()` também não serve: quem chega por link direto não tem
      entrada anterior no Cartero e sairia do app.
    */
    expect(FOUNDATION).toContain('router.replace(')
    expect(FOUNDATION).not.toContain('router.back()')
  })

  it('item 31: nem abrir nem fechar rola a página', () => {
    const ocorrencias = FOUNDATION.match(/scroll: false/g) ?? []
    expect(ocorrencias.length).toBe(2)
  })
})
