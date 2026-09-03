import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Pessoas como visão mensal
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A página deixou de ser só uma lista de contatos: cada linha mostra o saldo
 * do mês, e um resumo agrega os três números.
 *
 * Duas propriedades importam mais que o visual:
 *
 *   1. o resumo sai das MESMAS linhas exibidas — se divergissem, o total
 *      contradiria a soma visível logo abaixo dele;
 *   2. a competência é UMA — a da página. O drawer tinha a sua, e página em
 *      agosto com detalhe em setembro era um estado alcançável.
 *
 * A agregação é testada de verdade (função pura reproduzida aqui, idêntica à
 * da página); o resto é composição, como nos outros specs.
 */

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8')

const PAGINA = ler('../app/(dashboard)/persons/page.tsx')
const DRAWER = ler('../components/person-statement-drawer.tsx')
const ORCAMENTO = ler('../app/(dashboard)/budget/page.tsx')
const SERVICE = ler('../services/persons.service.ts')
const LAYOUT = ler('../app/(dashboard)/layout.tsx')

const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * A regra do item 18, isolada: positivo entra em "a receber", negativo entra
 * em "a pagar" pelo valor absoluto, zero não move nada.
 */
function resumir(saldos: number[]) {
  let toReceive = 0
  let toPay = 0

  for (const netBalance of saldos) {
    if (netBalance > 0) toReceive += netBalance
    else if (netBalance < 0) toPay += Math.abs(netBalance)
  }

  return { toReceive, toPay, net: toReceive - toPay }
}

describe('itens 18 e 53: o resumo do mês', () => {
  it('o cenário da especificação fecha', () => {
    // Mariana +300, Rafael -50, Pessoa C +20.
    expect(resumir([300, -50, 20])).toEqual({
      toReceive: 320,
      toPay: 50,
      net: 270,
    })
  })

  it('saldo zero não move nenhum agregado', () => {
    /*
      Um contato sem movimento aparece na lista, mas não pode inflar nem
      "a receber" nem "a pagar" — senão o resumo contaria pessoas em vez de
      dinheiro.
    */
    expect(resumir([300, 0, 0, 0])).toEqual(resumir([300]))
  })

  it('o líquido pode ser negativo', () => {
    expect(resumir([100, -400]).net).toBe(-300)
  })

  it('lista vazia é zero em tudo, sem NaN', () => {
    expect(resumir([])).toEqual({ toReceive: 0, toPay: 0, net: 0 })
  })

  it('item 19: não há compensação entre pessoas', () => {
    /*
      +300 e -300 dão líquido zero, mas as duas obrigações continuam
      existindo e visíveis nos agregados. O líquido é INFORMAÇÃO: não quita,
      não cruza dívida de um com cobrança de outro.
    */
    const r = resumir([300, -300])

    expect(r.net).toBe(0)
    expect(r.toReceive).toBe(300)
    expect(r.toPay).toBe(300)
  })

  it('item 39: o resumo é derivado das rows, não de outro contrato', () => {
    // Mesma fonte: se viesse do backend, poderia discordar do que está na tela.
    expect(code(PAGINA)).toContain('for (const b of balances ?? [])')
    expect(code(PAGINA)).not.toContain('summaryFromApi')

    /*
      Passou a somar o PERÍODO, não o saldo aberto: somando `netBalance`, um
      mês inteiramente quitado exibia R$ 0,00 e a leitura histórica desaparecia
      junto com a pendência.
    */
    expect(code(PAGINA)).toContain('b.periodReceivableTotal')
    expect(code(PAGINA)).toContain('b.periodDebtTotal')
  })
})

describe('itens 2, 3 e 4: uma competência só', () => {
  it('o seletor vive na BARRA SUPERIOR, com o das outras páginas', () => {
    /*
      A primeira versão renderizava um `MonthNav` dentro do conteúdo, ao lado
      do resumo. Ficava fora do lugar em que o resto do app põe a competência,
      e — pior — vinha com estado próprio.

      Agora `/persons` está em `MONTH_SCOPED_ROUTES`, e quem desenha o seletor
      é o `HeaderMonthNav` do layout, o mesmo de Extrato e Orçamento.
    */
    /*
      Mira o ARRAY de rotas, não o arquivo inteiro: `'/persons'` também
      aparece no menu lateral, e casar com ele deixaria o teste passar mesmo
      com a rota fora do escopo mensal.
    */
    const rotas = LAYOUT.slice(
      LAYOUT.indexOf('const MONTH_SCOPED_ROUTES'),
      LAYOUT.indexOf('function HeaderMonthNav'),
    )
    expect(rotas).toContain("'/persons'")
    expect(code(PAGINA)).not.toContain('<MonthNav')
  })

  it('item 21: não existe competência local duplicada', () => {
    /*
      Nem `useState<MonthPeriod>`, nem cópia da global sincronizada por
      efeito. A página observa a fonte canônica direto.
    */
    expect(PAGINA).toContain('const { period, setPeriod } = useMonthPeriod()')
    expect(code(PAGINA)).not.toContain('useState<MonthPeriod>')
    expect(code(PAGINA)).not.toContain('currentPeriod()')
  })

  it('o drawer RECEBE a competência — não a escolhe', () => {
    /*
      Era `useState` interno com `MonthNav` próprio. Enquanto existisse, a
      página e o detalhe podiam apontar para meses diferentes.
    */
    const drawer = code(DRAWER)

    expect(drawer).toContain('period: MonthPeriod')
    expect(drawer).not.toContain('setPeriod')
    expect(drawer).not.toContain('<MonthNav')
  })

  it('o drawer não reposiciona pela `defaultCompetence`', () => {
    /*
      O backend ainda devolve o campo, mas aplicá-lo ao período seria o mesmo
      salto silencioso que removemos do Orçamento: o usuário escolhe agosto e
      a tela decide mostrar outro mês.
    */
    expect(code(DRAWER)).not.toContain('defaultApplied')
  })

  it('item 5: os dois consumers passam a própria competência', () => {
    expect(PAGINA).toContain('period={period}')
    expect(ORCAMENTO).toContain('period={{ month, year }}')

    for (const [nome, fonte] of [
      ['Pessoas', PAGINA],
      ['Orçamento', ORCAMENTO],
    ] as const) {
      expect(code(fonte), `${nome} não deveria mais usar initialPeriod`).not.toContain(
        'initialPeriod',
      )
    }
  })

  it('itens 15 e 16: a inicialização é a do mecanismo global', () => {
    /*
      A página não resolve mais o mês corrente: quem faz isso é o
      `MonthPeriodProvider`, uma vez, para o app inteiro.
    */
    expect(code(PAGINA)).not.toContain('currentPeriod')
  })

  it('`?period=` continua honrado, aplicado à fonte GLOBAL', () => {
    /*
      O Orçamento linka para cá levando a competência que o usuário estava
      analisando. Como o Provider não lê a URL, a página aplica o parâmetro —
      mas ao estado global, e só na chegada (`urlPeriodApplied`): reaplicar a
      cada render prenderia o usuário no mês da URL.

      Mesmo padrão do Extrato, que faz isso com `startDate`/`endDate`.
    */
    expect(PAGINA).toContain('const urlPeriodApplied = useRef(false)')
    expect(PAGINA).toContain('if (urlPeriodApplied.current) return')
    expect(PAGINA).toContain('setPeriod(next)')
  })
})

describe('itens 31 e 55: sem N+1', () => {
  it('uma requisição em lote para a lista inteira', () => {
    expect(SERVICE).toContain("'/persons/monthly-summary'")
    expect(SERVICE).toContain('PersonMonthlyBalance[]')
    expect(PAGINA).toContain('getPersonsMonthlySummary(period)')
  })

  it('a página NÃO chama o extrato por pessoa', () => {
    /*
      `getPersonStatement` é do drawer, para UMA pessoa por vez. Aparecer no
      corpo da listagem significaria uma requisição por linha.
    */
    expect(code(PAGINA)).not.toContain('getPersonStatement')
  })

  it('a chave inclui a competência', () => {
    // Trocar de mês busca o novo sem descartar o anterior do cache.
    expect(PAGINA).toContain("queryKey: ['persons', 'monthly-summary', period]")
  })

  it('item 41: as invalidações existentes já alcançam a nova query', () => {
    /*
      A chave começa com `persons`, e o React Query casa por prefixo — as
      nove invalidações `['persons']` que já existiam atualizam o saldo
      mensal sem nenhuma mudança.
    */
    expect(DRAWER).toContain("qc.invalidateQueries({ queryKey: ['persons'] })")
  })
})

describe('itens 13, 40 e 57: a página entrou no design system', () => {
  it('as rows usam o primitive compartilhado', () => {
    expect(PAGINA).toContain('<FinancialListRow')
    expect(PAGINA).toContain('ROW_ICON_CLASS')
    expect(PAGINA).toContain('ROW_AMOUNT_CLASS')
  })

  it('não recria a geometria da row', () => {
    expect(code(PAGINA)).not.toContain('py-3.5 text-left outline-none')
    // O avatar de 32px próprio deu lugar ao container canônico.
    expect(code(PAGINA)).not.toContain('size-8 shrink-0 items-center justify-center rounded-lg bg-muted')
  })

  it('item 40: o valor não pisca de R$ 0,00 para o real', () => {
    /*
      Mostrar zero e trocar depois afirmaria um fato que ainda não sabemos —
      o mesmo flicker corrigido em Bancos.
    */
    expect(PAGINA).toContain('balancesLoading ? (')
    expect(PAGINA).toContain('<Skeleton className="h-5 w-20" />')
  })

  it('itens 9, 10 e 11: três estados de saldo', () => {
    /*
      Os rótulos vivem em `person-period-view`, a fonte única — e são cinco
      agora: um mês quitado conserva o valor, então RECEBIDO/PAGO substituem o
      SEM SALDO que aparecia por engano.
    */
    expect(PAGINA).toContain('PERSON_ROW_LABEL[status]')

    const view = code(ler('./person-period-view.ts'))
    expect(view).toContain("'A RECEBER'")
    expect(view).toContain("'VOCÊ DEVE'")
    expect(view).toContain("'SEM SALDO'")
    /*
      Dois estados novos: `A ACERTAR` para líquido zero COM pendência, e
      `SALDO FINAL` para a competência liquidada — onde o número volta a ser o
      histórico e a mudança de base precisa estar dita.
    */
    expect(view).toContain("'A ACERTAR'")
    expect(view).toContain("'SALDO FINAL'")

    /*
      A COR deixou de dizer direção: verde colidia com o verde de "resolvido".
      Só a conclusão é colorida, como em `BANK_TRAILING_TONE`.
    */
    expect(view).toContain("receivable: 'text-muted-foreground'")
    expect(view).toContain("debt: 'text-muted-foreground'")
    /* `finalBalance` substituiu `received`/`paid` como estado resolvido. */
    expect(view).toContain('finalBalance: ROW_RESOLVED_TONE')

    /*
      Zero é neutro: nem verde nem vermelho. A cor vem de `ROW_AMOUNT_TONE`,
      a fonte única — as classes estavam escritas à mão em cada tela.
    */
    /*
      O valor deixou de ter tom direcional: `in`/`out` pintavam verde/vermelho
      pela direção, e o verde ficava indistinguível do verde de "resolvido".
      Zero segue muted; o resto é neutro, como o total de Bancos.
    */
    /*
      Os dois tons continuam em uso, agora escolhidos pelo MODO: só EMPTY é
      muted, porque só ela é ausência de relação.
    */
    expect(PAGINA).toContain('ROW_AMOUNT_TONE[personAmountTone(status)]')
    expect(code(ler('./person-period-view.ts'))).toContain(
      "status === 'empty' ? 'muted' : 'neutral'",
    )
    expect(PAGINA).not.toContain('ROW_AMOUNT_TONE.in')
    expect(PAGINA).not.toContain('ROW_AMOUNT_TONE.out')
    /*
      `muted` e `neutral` continuam sendo os dois tons — a escolha entre eles
      passou a ser indexada pelo MODO, não escrita à mão pelo valor.
    */
    expect(code(ler('./person-period-view.ts'))).toContain("'muted' : 'neutral'")
  })

  it('item 16: o kebab é IRMÃO da row, não filho', () => {
    /*
      `FinancialListRow` renderiza um `button`; aninhar outro dentro é HTML
      inválido e quebra teclado. É o mesmo arranjo já usado em Bancos.

      Editar/Excluir de Pessoa permanecem onde estavam — movê-los para um
      drawer não fazia parte desta tarefa.
    */
    expect(PAGINA).toContain('<div className="group relative border-b border-border last:border-b-0">')
    expect(PAGINA).toContain('absolute top-1/2 right-1')
    expect(PAGINA).toContain('Editar')
    expect(PAGINA).toContain('Remover')
  })
})

describe('itens 12, 43 e 44: a lista continua sendo de contatos', () => {
  it('todo contato é renderizado, com saldo ou sem', () => {
    /*
      A lista vem de `persons`, não dos saldos: quem não tem movimento no mês
      continua aparecendo. Iterar os saldos esconderia quem está em dia.
    */
    /*
      A lista renderizada deriva de `persons` — a de contatos —, agora
      ORDENADA. Ordenar não filtra: `orderedPersons` é um `map` sobre
      `persons`, então quem não tem movimento continua aparecendo (no fim,
      pela policy de prioridade).
    */
    expect(PAGINA).toContain('{orderedPersons.map((person, i) => {')
    expect(PAGINA).toContain('persons.map((person) => {')
    expect(PAGINA).toContain('balanceById.get(person.id)')
    /*
      Contato sem linha no lote resolve para um balanço neutro — some da lista
      seria pior: a página também é lista de contatos.
    */
    expect(PAGINA).toContain('balanceById.get(person.id) ?? VAZIO')
    /* Nenhum filtro entre a fonte e a renderização. */
    expect(code(PAGINA)).not.toContain('persons.filter(')
  })

  it('item 43: a ordem é por URGÊNCIA, nunca por saldo', () => {
    /*
      A lista passou a ser ordenada — a decisão que este teste dizia ser "de
      outra fase". O que continua barrado é ordenar por VALOR: R$ 1.000
      vencendo em 30 dias não é mais urgente que R$ 50 vencidos ontem.
    */
    /*
      A ordem passou a depender do mês: urgência no corrente/futuro, magnitude
      histórica no passado. O que este teste barra continua valendo — ordenar
      pelo SALDO EM ABERTO por valor, que faria R$ 1.000 vencendo em 30 dias
      passar na frente de R$ 50 vencidos ontem.
    */
    expect(code(PAGINA)).toContain('sortPersonRowsForMonth(')
    expect(code(PAGINA)).toContain('personRowsCycle(period)')
    expect(code(PAGINA)).not.toContain('sort((a, b) => b.netBalance')
    expect(code(PAGINA)).not.toContain('orderBy')
  })

  it('item 44: o vazio de contatos continua distinto do erro', () => {
    expect(PAGINA).toContain('Nenhuma pessoa cadastrada')
    expect(PAGINA).toContain('Não foi possível carregar as pessoas')
  })

  it('item 45: mês sem movimento tem frase própria', () => {
    /*
      A copy vive em `persons-summary-text`, a fonte única — e distingue "nada
      aconteceu" de "aconteceu e foi resolvido", que antes diziam a mesma
      coisa.
    */
    expect(PAGINA).toContain('personsSummaryLines(summary)')

    const resumo = code(ler('./persons-summary-text.ts'))
    expect(resumo).toContain('Nenhuma movimentação neste mês')
    expect(resumo).toContain('Tudo em dia')
  })
})
