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
  const RENDA = semComentarios(
    ler('../app/(dashboard)/income/page.tsx'),
  )
  const FINANCIAL_ROW = semComentarios(
    ler('../components/ui/financial-list-row.tsx'),
  )
  const ROW_SURFACE = semComentarios(
    ler('../components/ui/financial-drawer-row-surface.ts'),
  )
  const LAYOUT = semComentarios(
    ler('../components/ui/drawer-layout.ts'),
  )
  const INVOICE_API = semComentarios(
    ler('../../../cartero-backend/src/invoices/invoices.service.ts'),
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
    expect(PESSOA).toContain(
      'DRAWER_WIDE_VERTICAL_RHYTHM.sectionHeadingPadding',
    )
    expect(PESSOA).toContain(
      'title={<span className="text-sm font-medium text-foreground">Histórico</span>}',
    )
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
    expect(PESSOA).toContain('DRAWER_WIDE_VERTICAL_RHYTHM.headerContentGap')
    expect(PESSOA).not.toContain('DRAWER_WIDE_VERTICAL_RHYTHM.contentStart')
    expect(PESSOA).toContain('DRAWER_WIDE_VERTICAL_RHYTHM.sectionTopGap')
    expect(PESSOA).not.toContain('overflow-y-auto px-6')
  })

  it('os drawers wide compartilham as relações verticais aprovadas', () => {
    expect(LAYOUT).toContain("headerContentGap: 'gap-5'")
    expect(LAYOUT).toContain("sectionTopGap: 'gap-5'")
    expect(LAYOUT).toContain("sectionContentGap: 'gap-2'")
    expect(LAYOUT).toContain("sectionHeadingPadding: 'pt-2.5 pb-0'")
    expect(PESSOA).toContain('DRAWER_WIDE_VERTICAL_RHYTHM.sectionTopGap')
    expect(PESSOA).toContain('DRAWER_WIDE_VERTICAL_RHYTHM.headerContentGap')
    expect(FATURA).toContain('DRAWER_WIDE_VERTICAL_RHYTHM.sectionTopGap')
    expect(FATURA).toContain('DRAWER_WIDE_VERTICAL_RHYTHM.headerContentGap')
    expect(FATURA).not.toContain('my-4')
    expect(FATURA).not.toContain('py-2.5')
    expect(RENDA).toContain('DRAWER_WIDE_VERTICAL_RHYTHM.headerContentGap')
    expect(RENDA).not.toContain('DRAWER_WIDE_VERTICAL_RHYTHM.contentStart')
    expect(RENDA).toContain('DRAWER_WIDE_VERTICAL_RHYTHM.sectionTopGap')
    expect(RENDA).toContain('<DrawerSectionHeading>')
    expect(PRIMITIVE).toContain('DRAWER_WIDE_VERTICAL_RHYTHM.sectionHeadingPadding')
    expect(RENDA).not.toContain('mt-3 flex gap-2')
    expect(RENDA).not.toContain('mt-4 rounded-lg border border-border bg-muted/30')
    expect(RENDA).not.toContain('<div className="mt-8">')
  })

  it('o section group é a única autoridade heading → conteúdo', () => {
    expect(LAYOUT).toContain("sectionContentGap: 'gap-2'")
    expect(PRIMITIVE).toContain('export function DrawerSectionGroup')
    expect(PRIMITIVE).toContain('DRAWER_WIDE_VERTICAL_RHYTHM.sectionContentGap')
    expect(PRIMITIVE).not.toContain('mt-2 divide-y')

    for (const drawer of [FATURA, RENDA, PESSOA]) {
      expect(drawer).toContain('<DrawerSectionGroup>')
      expect(drawer).not.toContain('DrawerFinancialList inset className=')
      expect(drawer).not.toContain('DrawerFinancialList className=')
    }
    expect(PESSOA.match(/<DrawerSectionGroup>/g)).toHaveLength(2)
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
    expect(LAYOUT).toContain("DRAWER_WIDE_CONTENT_INSET = 'px-4'")
    expect(PRIMITIVE).toContain('DRAWER_WIDE_CONTENT_INSET')
    expect(PRIMITIVE).toContain('DrawerFinancialList')
    expect(FATURA).toContain('DrawerFinancialList')
  })

  it('o vazio respeita o mesmo recuo das rows', () => {
    /*
      Alinhada com o cabeçalho e não com as linhas, a frase pareceria legenda
      do título em vez de conteúdo da seção.
    */
    expect(PRIMITIVE).toContain('DRAWER_WIDE_CONTENT_INSET')
    expect(PESSOA).toContain('DrawerSectionEmpty')
  })

  it('a mensagem de vazio sobreviveu à migração', () => {
    expect(PESSOA).toContain('Nenhum valor em aberto para esta competência.')
    expect(PESSOA).toContain('Nenhum item resolvido neste período.')
  })

  it('o card do resumo mantém identidade de card', () => {
    /* O resumo usa a mesma superfície limpa aprovada no drawer de Renda. */
    expect(PRIMITIVE).toContain('DRAWER_WIDE_CONTENT_GUTTER')
    expect(PRIMITIVE).toContain('rounded-xl bg-muted/40 p-4')
    expect(PESSOA).toContain('DrawerSummaryCard')
    expect(FATURA).toContain('DrawerSummaryCard')
  })

  it('as rows usam o inset e o ritmo do drawer de Renda', () => {
    expect(RENDA).toContain('<DrawerSectionGroup>')
    expect(PESSOA).toContain('DrawerFinancialList')
    expect(FATURA).toContain('DrawerFinancialList')
    expect(PRIMITIVE).toContain("'divide-y divide-border/60'")
    expect(PRIMITIVE).not.toContain('mt-2 divide-y')
    expect(ROW_SURFACE).toContain('financialDrawerRowSurfaceClass')
    expect(ROW_SURFACE).toContain('sm:gap-4 sm:px-2 sm:py-4')
    expect(FINANCIAL_ROW).toContain("financialDrawerRowSurfaceClass('interactive')")
    expect(PESSOA).not.toContain('rounded-none px-0 py-2.5')
    expect(FATURA).not.toContain('rounded-none px-0 py-2.5')
  })

  it('a borda da lista de Invoice e o radius compartilham o mesmo root', () => {
    const lista = FATURA.slice(FATURA.indexOf('<DrawerFinancialList inset'))

    expect(lista).toContain('<motion.div')
    expect(lista).toContain("className={financialDrawerRowSurfaceClass('animatedWrapper')}")
  })

  it('as larguras atuais são variantes compartilhadas, sem alterar seus valores', () => {
    expect(LAYOUT).toContain("DRAWER_WIDTH_COMPACT = 'sm:max-w-md'")
    expect(LAYOUT).toContain("DRAWER_WIDTH_WIDE = 'sm:max-w-lg'")
    expect(PESSOA).toContain('DRAWER_WIDTH_WIDE')
    expect(FATURA).toContain('DRAWER_WIDTH_WIDE')
    expect(RENDA).toContain('DRAWER_WIDTH_WIDE')
  })

  it('o header usa o banco da Invoice e o endpoint inclui essa relação', () => {
    expect(FATURA).toContain("invoice.bank?.isSystem ? 'Cartão' : bankDisplayName(invoice.bank, 'Cartão')")
    expect(FATURA).toContain('Fatura · {monthYear}')
    expect(INVOICE_API).toContain('bank: { select: { id: true, name: true, isSystem: true } }')
    expect(INVOICE_API).toContain('settlement: { select: { paidAt: true } }')
    expect(FATURA).toContain('accountCivilDayOf(invoice.settlement.paidAt, user?.timeZone ?? null)')
    expect(FATURA).toContain('<DrawerCompletionStatus variant="success">Paga em {paidAtLabel}</DrawerCompletionStatus>')
    expect(FATURA).toContain('DrawerCompletionStatus')
    expect(PESSOA).toContain('<DrawerCompletionStatus>{cardCompetencia.settledNote}</DrawerCompletionStatus>')
  })

  it('valores da Invoice são neutros e o sinal permanece na transação', () => {
    expect(FATURA).toContain("expense ? '−' : '+'")
    expect(FATURA).toContain('<FinancialRowTrailing amount={<>')
    expect(FATURA).not.toContain('amountTone=')
    expect(FINANCIAL_ROW).toContain('amountTone = ROW_AMOUNT_TONE.neutral')
    expect(FATURA).toContain('<DrawerSummaryValue tracking="tight" className="text-foreground">')
  })

  it('Invoice overdue usa linha temporal destructive e a data civil dueDate', () => {
    expect(FATURA).toContain('const isOverdue = invoice?.status === InvoiceStatus.OVERDUE')
    expect(FATURA).toContain('const overdueDateLabel = invoice && isOverdue ? formatDate(invoice.dueDate) : null')
    expect(FATURA).toContain('{isPaid || isOverdue ? null : (() => {')
    expect(FATURA).toContain('isPaid && paidAtLabel &&')
    expect(FATURA).toContain('overdueDateLabel &&')
    expect(FATURA).toContain('variant="destructive"')
    expect(FATURA).toContain('Vencida desde {overdueDateLabel}')
    expect(PRIMITIVE).toContain("variant?: 'success' | 'destructive'")
    expect(PRIMITIVE).toContain('CircleAlert')
    expect(PRIMITIVE).toContain('variant === \'success\' ? \'text-paid\' : \'text-destructive\'')
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
    const secao = PESSOA.slice(
      PESSOA.indexOf('className={cn(\'h-auto flex-wrap border-0 px-4\''),
    )
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

  it('abrir continua sendo `router.push` — o Back precisa fechar', () => {
    /*
      Só o FECHAMENTO trocou de mecanismo. Abrir é navegação de verdade e
      precisa da entrada no histórico.
    */
    expect(NAV).toContain('router.push(')
    expect(PERSONS).toContain('router.push(detailHref(pathname, next)')
  })

  it('o espelho conta INTENÇÕES, não a query fechada', () => {
    /*
      Guardar a query fechada parecia se invalidar sozinho — "qualquer
      navegação posterior muda a string". Falso no caso mais comum: reabrir a
      MESMA entidade produz uma query byte a byte idêntica, o espelho voltava
      a casar e o drawer não abria. Abrir OUTRA funcionava, o que fazia o bug
      parecer aleatório.

      O que distingue um fechamento é o MOMENTO, não o endereço.
    */
    expect(NAV).toContain('dispensa.id === paramId')
    expect(NAV).toContain('setDispensa({')
    expect(NAV).toContain('setPedidos((n) => n + 1)')

    /* A comparação por query não pode voltar. */
    for (const src of [NAV, BUDGET, PERSONS]) {
      expect(src).not.toContain('closedSearch')
      expect(src).not.toContain('queryFechada')
    }
  })

  it('link direto e primeira montagem não são tratados como dispensados', () => {
    /*
      `dispensas > 0` na guarda: sem isso, `0 >= 0` marcaria o estado inicial
      como dispensado e nenhum detalhe abriria por URL colada.
    */
    expect(NAV).toContain('dispensa !== null && dispensa.id === paramId')
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

describe('REOPEN: a mesma entidade reabre depois do X', () => {
  /*
    ══════════════════════════════════════════════════════════════════════════
    O bug que o espelho por query introduziu
    ══════════════════════════════════════════════════════════════════════════

    Reproduzido em `/budget` e `/persons`: clicar numa Pessoa abria o drawer,
    o X fechava, e clicar NA MESMA Pessoa mudava a URL de volta para
    `?personId=<mesmo-id>` sem abrir nada. Abrir OUTRA pessoa funcionava.

    A causa: o espelho guardava a query fechada. Reabrir a mesma entidade
    produz uma query idêntica à guardada, ela volta a casar, e o derivado
    devolve `null`.

    Este bloco fixa o CICLO, não a implementação: as asserções abaixo rodam a
    mesma máquina de estados que as três superfícies usam.
  */

  /** A derivação compartilhada, como as três superfícies a aplicam. */
  const criarCiclo = () => {
    let pedidos = 0
    let dispensa: { id: string | null; geracao: number } | null = null
    return {
      abrir: () => {
        pedidos += 1
      },
      /** `idNaUrl` é o detalhe que estava aberto — o que o `close` real lê. */
      fechar: (idNaUrl: string | null = 'A') => {
        dispensa = { id: idNaUrl, geracao: pedidos }
      },
      aberto: (param: string | null) =>
        dispensa !== null &&
        dispensa.id === param &&
        pedidos <= dispensa.geracao
          ? null
          : param,
    }
  }

  it('open → close → reopen MESMA entidade', () => {
    const c = criarCiclo()

    c.abrir()
    expect(c.aberto('A'), 'primeiro open').toBe('A')

    c.fechar()
    expect(c.aberto(null), 'depois do X').toBeNull()

    c.abrir()
    expect(c.aberto('A'), 'reopen da MESMA — era aqui que falhava').toBe('A')
  })

  it('open → close → OUTRA entidade continua funcionando', () => {
    /* Este caminho nunca quebrou; o teste impede uma correção que o rompa. */
    const c = criarCiclo()

    c.abrir()
    c.fechar()
    c.abrir()

    expect(c.aberto('B')).toBe('B')
  })

  it('o ciclo aguenta repetição indefinida', () => {
    /*
      Abrir e fechar a mesma entidade cinco vezes. Um espelho que só
      alternasse uma vez passaria no teste acima e falharia aqui.
    */
    const c = criarCiclo()

    for (let i = 1; i <= 5; i++) {
      c.abrir()
      expect(c.aberto('A'), `abertura ${i}`).toBe('A')
      c.fechar()
      expect(c.aberto(null), `fechamento ${i}`).toBeNull()
    }
  })

  it('link direto abre sem ninguém ter pedido', () => {
    /*
      Ninguém clicou: `pedidos` e `dispensas` são zero, e a URL manda sozinha.
      Uma guarda `dispensas >= pedidos` sem o `dispensas > 0` marcaria o
      estado inicial como dispensado e nenhum link direto abriria.
    */
    const c = criarCiclo()

    expect(c.aberto('A')).toBe('A')
  })

  it('dois fechamentos seguidos não bloqueiam a reabertura', () => {
    /*
      `close` é idempotente por contrato — o fluxo de exclusão o chama depois
      de a URL já ter sido limpa.

      Com um CONTADOR global, duas dispensas contra duas aberturas mantinham o
      drawer fechado. O espelho por id não tem esse problema: a segunda
      dispensa sobrescreve a primeira em vez de somar.
    */
    const c = criarCiclo()

    c.abrir()
    c.fechar('A')
    c.fechar('A')
    c.abrir()

    expect(c.aberto('A')).toBe('A')
  })

  it('R7: id inválido é limpo sem bloquear a próxima abertura válida', () => {
    /*
      O caso que um contador global quebrava. `onNotFound` chama `close()`
      para limpar um id inexistente, SEM abertura correspondente — e o
      contador ficava desequilibrado, engolindo o clique seguinte.

      O espelho por id não alcança outra entidade.
    */
    const c = criarCiclo()

    /* Link direto com id inválido: a URL manda, o drawer tenta abrir. */
    expect(c.aberto('INVALIDO')).toBe('INVALIDO')

    /* `onNotFound` limpa. */
    c.fechar('INVALIDO')
    expect(c.aberto(null)).toBeNull()

    /* E clicar numa entidade válida abre. */
    c.abrir()
    expect(c.aberto('A')).toBe('A')
  })

  it('R8: fechar durante o carregamento não suprime o reopen', () => {
    /*
      O espelho é sincrono e não consulta dados: fechar com a entidade ainda
      carregando é o mesmo fechamento de sempre, e o pedido seguinte vale.
    */
    const c = criarCiclo()

    c.abrir()
    c.fechar('A')
    c.abrir()

    expect(c.aberto('A')).toBe('A')
  })

  it('R5: alternar TIPOS e voltar', () => {
    /* Pessoa → fatura → a mesma pessoa. */
    const c = criarCiclo()

    c.abrir()
    expect(c.aberto('pessoa-A')).toBe('pessoa-A')
    c.fechar('pessoa-A')

    c.abrir()
    expect(c.aberto('fatura-A')).toBe('fatura-A')
    c.fechar('fatura-A')

    c.abrir()
    expect(c.aberto('pessoa-A')).toBe('pessoa-A')
  })

  it('R10: URL com id válido nunca fica estável com o drawer fechado', () => {
    /*
      O invariante do §8: o estado "param na URL + drawer fechado" só existe
      no instante do fechamento, e o próprio fechamento remove o param. Sem um
      pedido novo, a dispensa vale; com ele, a URL manda.
    */
    const c = criarCiclo()

    c.abrir()
    c.fechar('A')
    /* A URL já não tem o param — este é o único estado fechado legítimo. */
    expect(c.aberto(null)).toBeNull()

    /* Qualquer pedido posterior devolve a autoridade à URL. */
    c.abrir()
    expect(c.aberto('A')).toBe('A')
  })

  it('o `close` real aborta quando não há o que fechar', () => {
    /* Idempotência: sem param na URL, nenhuma dispensa é registrada. */
    const NAV_FONTE = ler('./detail-navigation.ts')
    const inicio = NAV_FONTE.indexOf('const close = ()')
    const corpoClose = NAV_FONTE.slice(
      inicio,
      NAV_FONTE.indexOf('setDispensa(', inicio),
    )

    expect(corpoClose).toContain('const idNaUrl = new URLSearchParams(atual.search).get(key)')
    expect(corpoClose).toContain('const idDispensado = aberturaPendente?.id ?? idNaUrl')
    expect(corpoClose).toContain('if (idDispensado === null) return')
  })

  it('o espelho registra QUEM foi dispensado, não uma contagem', () => {
    /*
      A diferença que o R7 exige: um contador global é afetado por qualquer
      fechamento, inclusive o cleanup de um id inválido. O espelho por id só
      alcança a entidade que foi realmente dispensada.
    */
    const FONTE = semComentarios(ler('./detail-navigation.ts'))

    expect(FONTE).toContain('dispensa.id === paramId')
    expect(FONTE).toContain('pedidos <= dispensa.geracao')
    /* O contador global não pode voltar. */
    expect(FONTE).not.toContain('setDispensas')
  })
})
