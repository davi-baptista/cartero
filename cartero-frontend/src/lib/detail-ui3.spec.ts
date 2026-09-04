import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nextItemLabel, type NextSettlementItem } from './person-next-item'
import { rowLabelDirection } from './person-period-view'
import {
  detailHref,
  withDetailParam,
  withoutDetailParams,
} from './detail-navigation'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * DETAIL UI3 — copy neutra, fechamento determinístico, geometria compartilhada
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Três defeitos independentes, com a mesma forma: uma decisão tomada num
 * lugar e contradita em outro.
 *
 * · a row dizia `A ACERTAR` e `Receber em 7d` lado a lado;
 * · o Orçamento fechava o drawer com `push`, e o Voltar o reabria;
 * · Pessoa e Fatura desenhavam a mesma faixa por caminhos separados, e as
 *   rows de Pessoa ficaram 48px mais estreitas.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const HOJE = '2026-09-03'
const item = (direction: 'receive' | 'pay', dueDate: string): NextSettlementItem => ({
  direction,
  dueDate,
})

describe('parte A: `A ACERTAR` não pode dizer `Pagar` nem `Receber`', () => {
  /*
    O caso legítimo: R$ 300 abertos de cada lado. O líquido é zero, mas há
    duas obrigações vivas — a row é ACTIVE, não quitada.
  */
  const neutro = (i: NextSettlementItem) =>
    nextItemLabel(i, HOJE, rowLabelDirection('toSettle', i))

  it('A1: futuro → `Acertar em Xd`', () => {
    expect(neutro(item('receive', '2026-09-10'))).toBe('Acertar em 7d')
  })

  it('A2: amanhã', () => {
    expect(neutro(item('pay', '2026-09-04'))).toBe('Acertar amanhã')
  })

  it('A3: hoje', () => {
    expect(neutro(item('receive', '2026-09-03'))).toBe('Acertar hoje')
  })

  it('A4: atraso', () => {
    expect(neutro(item('pay', '2026-08-31'))).toBe('Acertar atrasado 3d')
  })

  it('o LADO do item não vaza para a frase', () => {
    /*
      A propriedade central: o mesmo prazo, com direções opostas, produz
      texto idêntico. Se o verbo voltasse a sair do item, estas duas
      divergiriam.
    */
    expect(neutro(item('receive', '2026-09-10'))).toBe(
      neutro(item('pay', '2026-09-10')),
    )
  })

  it('A5: net positivo continua `Receber`', () => {
    const i = item('receive', '2026-09-10')

    expect(nextItemLabel(i, HOJE, rowLabelDirection('receivable', i))).toBe(
      'Receber em 7d',
    )
  })

  it('A6: net negativo continua `Pagar`', () => {
    const i = item('pay', '2026-09-10')

    expect(nextItemLabel(i, HOJE, rowLabelDirection('debt', i))).toBe(
      'Pagar em 7d',
    )
  })

  it('A7: resolvido não usa `Acertar` — usa `Quitado em`', () => {
    /*
      `rowSubtext` descarta o prazo quando o status é resolvido, então a
      direção nem chega a ser consultada. O teste fixa que `settled` e
      `toSettle` são estados distintos.
    */
    const i = item('receive', '2026-09-10')

    expect(rowLabelDirection('finalBalance', i)).not.toBe('settle')
    expect(rowLabelDirection('empty', i)).not.toBe('settle')
  })

  it('a DATA continua vindo do item, não é agregada', () => {
    /*
      Só a apresentação muda. Datas diferentes produzem prazos diferentes —
      nenhum "prazo médio" foi inventado.
    */
    expect(neutro(item('receive', '2026-09-10'))).toBe('Acertar em 7d')
    expect(neutro(item('receive', '2026-09-20'))).toBe('Acertar em 17d')
  })

  it('sem item não há frase', () => {
    expect(nextItemLabel(null, HOJE, 'settle')).toBeNull()
  })

  it('a direção sai do STATUS, não de um opcional no call site', () => {
    /*
      Um parâmetro opcional que a página precisa lembrar de passar é o mesmo
      bug esperando o próximo consumidor. `rowLabelDirection` deriva do status
      que a row já calculou.
    */
    const PERSONS = semComentarios(
      ler('../app/(dashboard)/persons/page.tsx'),
    )

    expect(PERSONS).toContain('rowLabelDirection(status, balance.nextItem)')
  })
})

describe('parte B: fechar não depende do histórico', () => {
  it('o fechamento remove SÓ a identidade do detalhe', () => {
    const atual = new URLSearchParams(
      'month=9&year=2026&highlight=abc&invoiceId=xyz',
    )
    const depois = withoutDetailParams(atual)

    expect(depois.get('invoiceId')).toBeNull()
    expect(depois.get('month')).toBe('9')
    expect(depois.get('year')).toBe('2026')
    expect(depois.get('highlight')).toBe('abc')
  })

  it('sem params restantes, a URL não fica com `?` órfão', () => {
    expect(detailHref('/budget', withoutDetailParams('invoiceId=xyz'))).toBe(
      '/budget',
    )
  })

  it('abrir um detalhe fecha o outro — exclusividade', () => {
    const depois = withDetailParam('invoiceId=antiga', 'debtId', 'nova')

    expect(depois.get('invoiceId')).toBeNull()
    expect(depois.get('debtId')).toBe('nova')
  })

  it('a foundation fecha com `replace`, nunca `router.back()`', () => {
    /*
      O X significa "fechar este detalhe", não "voltar para uma página
      anterior desconhecida". Quem colou a URL direto não tem entrada anterior
      no Cartero, e `back()` o mandaria para fora do app.
    */
    const NAV = semComentarios(ler('./detail-navigation.ts'))

    expect(NAV).toContain('router.replace(')
    expect(NAV).not.toContain('router.back()')
  })

  it('abrir continua sendo `push` — o Voltar precisa fechar', () => {
    const NAV = semComentarios(ler('./detail-navigation.ts'))

    expect(NAV).toContain('router.push(')
  })

  it('o Orçamento abre com `push` e fecha com `replace`', () => {
    /*
      O defeito desta fase: fechava com `push`, e o histórico virava
      `[orçamento, detalhe, orçamento]` — o Voltar logo após fechar reabria o
      drawer que o usuário acabara de dispensar.
    */
    const BUDGET = semComentarios(ler('../app/(dashboard)/budget/page.tsx'))

    expect(BUDGET).toContain('router.push(detailHref(pathname, next)')
    expect(BUDGET).toContain('router.replace(detailHref(atual.path, limpo)')
    expect(BUDGET).not.toContain('router.back()')
    /* E o fechamento lê a URL do navegador, não a do render. */
    expect(BUDGET).toContain('liveLocation({')
  })

  it('o Orçamento usa `detailHref`, não concatenação crua', () => {
    /*
      `${pathname}?${next}` deixa `/budget?` quando não sobra param — uma URL
      diferente da base para o mesmo estado.
    */
    const BUDGET = semComentarios(ler('../app/(dashboard)/budget/page.tsx'))

    expect(BUDGET).toContain('detailHref(pathname, next)')
    expect(BUDGET).not.toContain('`${pathname}?${next.toString()}`')
  })

  it('Pessoas também fecha com `replace` e preserva o resto', () => {
    const PERSONS = semComentarios(
      ler('../app/(dashboard)/persons/page.tsx'),
    )

    expect(PERSONS).toContain('router.replace(detailHref(atual.path, next)')
    expect(PERSONS).not.toContain('router.back()')
    expect(PERSONS).toContain('liveLocation({')
    /* Só o `personId` sai — o mês e os demais params sobrevivem. */
    expect(PERSONS).toContain("next.delete('personId')")
  })

  it('`personId` fica FORA de `DETAIL_PARAMS`, e isso é deliberado', () => {
    /*
      O mesmo nome tem dois significados: em `/persons` identifica o extrato
      aberto, em `/debts` FILTRA a lista por contraparte. Na lista global, a
      foundation o apagaria ao abrir uma dívida — e o filtro sumiria sozinho.
    */
    const NAV = ler('./detail-navigation.ts')
    const params = NAV.slice(
      NAV.indexOf('DETAIL_PARAMS = ['),
      NAV.indexOf('] as const'),
    )

    expect(params).not.toContain('personId')
    expect(params).toContain('invoiceId')
  })
})

describe('parte C: a geometria das seções tem uma autoridade', () => {
  const PRIMITIVE = semComentarios(
    ler('../components/ui/drawer-section.tsx'),
  )
  const PESSOA = semComentarios(
    ler('../components/person-statement-drawer.tsx'),
  )
  const FATURA = semComentarios(
    ler('../components/invoice-details-drawer.tsx'),
  )

  it('os dois drawers consomem a MESMA primitive', () => {
    expect(PESSOA).toContain('DrawerSectionHeader')
    expect(FATURA).toContain('DrawerSectionHeader')
  })

  it('a faixa existe uma vez só', () => {
    const faixa =
      'flex h-11 items-center justify-between gap-2 border-y border-border pl-4 pr-2'

    expect(PRIMITIVE).toContain(faixa)
    /* Nenhuma cópia local sobreviveu. */
    expect(PESSOA).not.toContain(faixa)
    expect(FATURA).not.toContain(faixa)
  })

  it('`Em aberto` e `Histórico` usam a mesma geometria', () => {
    /*
      `Histórico` era um `<p>` solto com `mb-2`: sem altura fixa, sem bordas e
      com outro recuo. A diferença aparecia como um degrau no meio do drawer.
    */
    expect(PESSOA).toContain('<DrawerSectionHeader title="Histórico" />')
    expect(PESSOA).not.toContain(
      'mb-2 text-[11px] font-medium text-muted-foreground',
    )
  })

  it('o scroller de Pessoa NÃO tem padding horizontal', () => {
    /*
      A causa raiz da divergência: `px-6` no container de scroll estreitava
      tudo, e a faixa da seção nascia recuada — 320px contra os 368px de
      Fatura, em 390px de viewport.
    */
    expect(PESSOA).toContain(
      'flex flex-1 flex-col gap-5 overflow-y-auto pt-4 pb-5',
    )
    expect(PESSOA).not.toContain('overflow-y-auto px-6')
  })

  it('nenhuma seção de Pessoa escreve a própria tipografia de título', () => {
    /*
      Segundo guardião: o assert acima cobre o `Histórico` de hoje, este barra
      a FORMA de reintroduzir uma faixa artesanal em qualquer seção nova.
    */
    expect(PESSOA).not.toMatch(/text-\[11px\] font-medium text-muted-foreground/)
  })

  it('nenhum drawer redefine o recuo com outro valor', () => {
    /*
      `px-6`/`px-8` locais eram exatamente como a divergência nasceu: cada
      drawer com o seu número, e a diferença invisível em revisão de diff.
    */
    for (const arquivo of [PESSOA, FATURA]) {
      expect(arquivo).not.toMatch(/overflow-y-auto[^"']*px-[0-9]/)
    }
  })

  it('o recuo do conteúdo é um token, não um número solto', () => {
    expect(PRIMITIVE).toContain("DRAWER_SECTION_INSET = 'px-4'")
    expect(PESSOA).toContain('DRAWER_SECTION_INSET')
  })

  it('o vazio respeita o mesmo recuo das rows', () => {
    /*
      Alinhada com o cabeçalho e não com as linhas, a frase pareceria legenda
      do título em vez de conteúdo da seção.
    */
    expect(PRIMITIVE).toContain('DRAWER_SECTION_INSET')
    expect(PESSOA).toContain('DrawerSectionEmpty')
  })

  it('a mensagem de vazio sobreviveu à migração', () => {
    expect(PESSOA).toContain('Nenhum valor em aberto para esta competência.')
    expect(PESSOA).toContain('Nenhum item resolvido neste período.')
  })

  it('o card do resumo mantém identidade de card', () => {
    /* Continua `rounded-xl`, agora com a margem do mesmo token de recuo. */
    expect(PESSOA).toContain(
      'mx-4 rounded-xl border border-border bg-muted/30 px-4 py-4',
    )
  })

  it('não virou um mega-component', () => {
    /*
      A primitive compartilha o RETÂNGULO, não a tela: nenhuma noção de
      fatura, pessoa, valor ou status atravessa esse limite.
    */
    for (const proibido of [
      'invoice',
      'Invoice',
      'person',
      'Person',
      'amount',
      'status',
    ]) {
      expect(PRIMITIVE, proibido).not.toContain(proibido)
    }
  })

  it('nenhum scroll aninhado novo em Pessoa', () => {
    const scrollers = PESSOA.match(/overflow-y-auto/g) ?? []

    expect(scrollers.length).toBe(1)
  })

  it('o `+ Adicionar` preserva o cursor', () => {
    expect(PESSOA).toContain('cursor-pointer')
  })
})

describe('competência sem atividade diz cada coisa UMA vez', () => {
  /*
    O contrato do zero-activity. A tela dizia o mesmo fato três vezes:

      Nada a acertar · R$ 0,00                     (summary)
      Nenhum valor em aberto para esta competência. (seção)
      Nenhum valor em aberto com C6.                (global, redundante)

    A terceira também respondia a pergunta errada no lugar errado:
    `isFullySettled` é ALL-TIME, e a frase aparecia logo abaixo de um
    Histórico que fala de UM mês.
  */

  const PESSOA = semComentarios(
    ler('../components/person-statement-drawer.tsx'),
  )

  /* Contagem por `split`: nada de regex, nada de escapar pontuação. */
  const ocorrencias = (texto: string) => PESSOA.split(texto).length - 1

  it('o vazio de `Em aberto` existe exatamente uma vez', () => {
    expect(ocorrencias('Nenhum valor em aberto para esta competência.')).toBe(1)
  })

  it('o vazio de `Histórico` existe exatamente uma vez', () => {
    expect(ocorrencias('Nenhum item resolvido neste período.')).toBe(1)
  })

  it('o fallback global foi removido', () => {
    expect(PESSOA).not.toContain('Nenhum valor em aberto com ')
  })

  it('nenhum vazio é renderizado a partir do consolidado all-time', () => {
    /*
      `isFullySettled` continua existindo — o WhatsApp fala da relação
      inteira e precisa dele. O que não pode voltar é ele governar um vazio
      VISUAL abaixo das seções mensais.
    */
    const usos = PESSOA.match(/summary\.isFullySettled/g) ?? []

    expect(usos.length).toBe(1)
    expect(PESSOA).toContain('if (requirePhone && summary.isFullySettled)')
  })

  it('cada seção mantém o vazio próprio — nada foi apagado a mais', () => {
    expect(PESSOA).toContain('DrawerSectionEmpty')
    expect(PESSOA).toContain('Nenhum valor em aberto para esta competência.')
    expect(PESSOA).toContain('Nenhum item resolvido neste período.')
  })

  it('o summary de competência vazia sobrevive', () => {
    const CARD = semComentarios(ler('./person-competence-card.ts'))

    expect(CARD).toContain("label: 'Nada a acertar'")
    expect(CARD).toContain("mode: 'empty'")
  })

  it('`+ Adicionar` continua no cabeçalho de uma competência vazia', () => {
    /*
      A ação é a mais útil justamente num mês sem nada, e o cabeçalho é
      constante — fica fora do condicional de lista vazia.
    */
    const secao = PESSOA.slice(PESSOA.indexOf('Em aberto · {monthSummary.itemCount}'))
    const antesDoCondicional = secao.slice(0, secao.indexOf('monthSummary.itemCount === 0'))

    expect(antesDoCondicional).toContain('Adicionar')
  })

  it('nenhum texto de vazio aparece duplicado no arquivo', () => {
    const vazios = [
      'Nenhum valor em aberto para esta competência.',
      'Nenhum item resolvido neste período.',
      'Nenhuma pessoa cadastrada',
    ]

    for (const texto of vazios) {
      expect(ocorrencias(texto), texto).toBeLessThanOrEqual(1)
    }
  })
})

describe('HOTFIX: rota estática descarta `router.replace` de query', () => {
  /*
    O bug de produção. Colar `/banks?invoiceId=…` numa aba nova abria o
    drawer, e o X não fechava — nem no segundo clique.

    `/banks`, `/budget` e `/persons` são rotas ESTÁTICAS (prerenderizadas).
    Um `router.replace` que muda SÓ a query aponta para a mesma entrada do
    cache do App Router, e o Next descarta a atualização: a URL não muda, o
    `searchParams` não muda, e o drawer nunca fecha.

    Em desenvolvimento não aparecia — sem rota prerenderizada, o mesmo
    `replace` era processado. Foi por isso que passou por vários ciclos de
    validação local.

    Provado no browser: `onOpenChange` era chamado com `false` (o handler
    disparava), e `history.replaceState` nativo fechava na hora — enquanto o
    `router.replace` não produzia efeito nenhum.
  */

  const NAV = semComentarios(ler('./detail-navigation.ts'))
  const BANKS = semComentarios(ler('../app/(dashboard)/banks/page.tsx'))
  const BUDGET = semComentarios(ler('../app/(dashboard)/budget/page.tsx'))
  const PERSONS = semComentarios(ler('../app/(dashboard)/persons/page.tsx'))

  it('o fechamento usa `history.replaceState`, não o router', () => {
    expect(NAV).toContain('window.history.replaceState')
  })

  it('as três superfícies aplicam a mesma correção', () => {
    /* `/banks` pelo hook; `/budget` e `/persons` têm cópias locais. */
    expect(BANKS).toContain('useDetailNavigation')
    expect(BUDGET).toContain('window.history.replaceState')
    expect(PERSONS).toContain('window.history.replaceState')
  })

  it('abrir continua sendo `router.push` — o Back precisa fechar', () => {
    /*
      Só o FECHAMENTO trocou de mecanismo. Abrir é navegação de verdade e
      precisa da entrada no histórico.
    */
    expect(NAV).toContain('router.push(')
    expect(PERSONS).toContain('router.push(detailHref(pathname, next)')
  })

  it('`replaceState` preserva o state do histórico', () => {
    /*
      Passar `null` faria o Next perder a própria bookkeeping de rota, e o
      Back seguinte poderia cair numa entrada sem contexto.
    */
    expect(NAV).toContain('window.history.state')
    expect(BUDGET).toContain('window.history.state')
    expect(PERSONS).toContain('window.history.state')
  })

  it('a UI fecha sem esperar a navegação', () => {
    /*
      O espelho local é o que torna o X determinístico: se o Next descartar a
      atualização de rota, o `searchParams` não muda — e sem o espelho a UI
      continuaria lendo o param antigo.
    */
    expect(NAV).toContain('closedSearch')
    expect(BUDGET).toContain('queryFechada')
    expect(PERSONS).toContain('queryFechada')
  })

  it('o espelho guarda a QUERY, não o id', () => {
    /*
      Guardar a query inteira faz o espelho se invalidar por construção:
      qualquer navegação posterior muda a string e o detalhe volta a ser lido
      da URL. Com o id, abrir a MESMA entidade de novo continuaria fechado.
    */
    expect(NAV).toContain('currentSearch === closedSearch')
    expect(NAV).toContain('setClosedSearch(atual.search)')
  })

  it('nenhum `useEffect` foi introduzido para limpar o espelho', () => {
    /*
      Um efeito que zerasse o espelho poderia reabrir o detalhe que o usuário
      dispensou — e no Orçamento há a garantia explícita de não haver
      `useEffect`, para que nada dê snap-back no mês selecionado.
    */
    expect(BUDGET).not.toContain('useEffect')
    expect(NAV).not.toContain('useEffect')
  })

  it('o SSR mantém o fallback pelo router', () => {
    /* `window` não existe no servidor; lançar ali seria pior que navegar. */
    expect(NAV).toContain("typeof window !== 'undefined'")
    expect(NAV).toContain('router.replace(detailHref(atual.path, limpo)')
  })

  it('`router.back()` continua fora do fechamento', () => {
    for (const [nome, src] of [
      ['nav', NAV],
      ['banks', BANKS],
      ['budget', BUDGET],
      ['persons', PERSONS],
    ] as const) {
      expect(src, nome).not.toContain('router.back()')
    }
  })
})
