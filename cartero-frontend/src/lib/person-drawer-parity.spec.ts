import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { civilDayOf } from './date'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O drawer de Pessoas na anatomia do drawer de Fatura
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Três correções:
 *
 * · a seção "Em aberto" ganhou o cabeçalho de Fatura ("Transações · X" à
 *   esquerda, "+ Adicionar" à direita), e ele passou a ser CONSTANTE — antes
 *   sumia junto com a lista quando não havia itens;
 *
 * · a data de "Quitado em" divergia entre a lista e o drawer, porque um
 *   convertia para dia civil e o outro fatiava o ISO em UTC;
 *
 * · faltava `cursor-pointer` em alvos de clique que não são `<a href>`.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DRAWER = semComentarios(
  ler('../components/person-statement-drawer.tsx'),
)
const SETTLEMENT_VIEW = semComentarios(ler('./person-settlement-view.ts'))
const FATURA = semComentarios(
  ler('../components/invoice-details-drawer.tsx'),
)
const IDENTITY_HEADER = semComentarios(
  ler('../components/ui/drawer-identity-header.tsx'),
)
const DRAWER_SECTIONS = semComentarios(
  ler('../components/ui/drawer-section.tsx'),
)
const ROW_SURFACE = semComentarios(
  ler('../components/ui/financial-drawer-row-surface.ts'),
)
const FINANCIAL_LIST_ROW = semComentarios(
  ler('../components/ui/financial-list-row.tsx'),
)
const FINANCIAL_SETTLEMENT_ROW = semComentarios(
  ler('../components/ui/financial-settlement-row.tsx'),
)
const INCOME_PAGE = semComentarios(
  ler('../app/(dashboard)/recurring/income-panel.tsx'),
)
const BUDGET_ROW = semComentarios(
  ler('../components/budget-drilldown-item.tsx'),
)
const SECTION_TITLE = DRAWER_SECTIONS.slice(
  DRAWER_SECTIONS.indexOf('export function DrawerSectionTitle'),
  DRAWER_SECTIONS.indexOf('export function DrawerSectionEmpty'),
)

describe('objetivo 1: a seção "Em aberto" segue o padrão de Fatura', () => {
  it('o cabeçalho tem a mesma geometria', () => {
    /*
      `h-11` fixo, borda em cima e embaixo, título à esquerda e ação à direita.

      A faixa deixou de ser escrita em cada drawer: os dois consomem a MESMA
      primitive, que é onde a geometria vive agora. Duas cópias byte a byte
      passavam neste teste e ainda assim podiam divergir na edição seguinte.
    */
    expect(DRAWER).toContain('<DrawerIdentityHeader')
    expect(IDENTITY_HEADER).toContain('SheetHeader className="px-6 pb-0 pt-6"')
    expect(IDENTITY_HEADER).toContain('SheetTitle className="min-w-0 flex-1 break-words"')
    expect(FATURA).toContain('DrawerSectionHeader')
    expect(DRAWER).toContain('DrawerSectionHeader')
    expect(DRAWER_SECTIONS).toContain('flex h-11 items-center justify-between gap-2 border-y border-border pl-4 pr-2')
  })

  it('o título conta os itens, como em Fatura', () => {
    expect(DRAWER).toContain('title="Em aberto"')
    expect(DRAWER).toContain('count={monthSummary.itemCount}')
    expect(FATURA).toContain('title="Transações"')
    expect(SECTION_TITLE).toContain("{title}{' · '}{count}{suffix}")
    expect(SECTION_TITLE).not.toMatch(/(?:item|itens|text-muted-foreground|rounded-full)/i)
    expect(DRAWER).toContain('className="text-sm font-medium text-foreground"')
  })

  it('Adicionar abre o fluxo contextual diretamente, com as duas escolhas no drawer', () => {
    const flow = ler('../components/person-contextual-create-flow.tsx')
    expect(DRAWER).toContain('onClick={() => setPersonCreateOpen(true)}')
    expect(DRAWER).not.toContain('openNewReceivable')
    expect(DRAWER).not.toContain('openNewDebt')
    expect(flow).toContain('O que você quer registrar?')
    expect(flow).toContain('grid grid-cols-2 gap-2')
    expect(flow).toContain('Nova cobrança · ${personName}')
    expect(flow).toContain('Nova dívida · ${personName}')
    expect(flow).toContain('Adicionar movimentação · ${personName}')
    expect(flow).toContain('PROGRESSIVE_REVEAL_CLASS')
  })

  it('reutiliza os forms canônicos sem pedir pessoa novamente', () => {
    const flow = ler('../components/person-contextual-create-flow.tsx')
    expect(flow).toContain('<DebtSheet')
    expect(flow).toContain('<ReceivableSheet')
    expect(flow).toContain('initialPersonId={personId}')
    expect(flow).toContain('hidePersonSelector')
    expect(DRAWER).toContain('personId: person?.id')
  })

  it('o botão usa a escala de Fatura', () => {
    expect(DRAWER).toContain('className="h-7 cursor-pointer gap-1 px-2"')
    const addAction = FATURA.slice(FATURA.indexOf('title="Transações"'), FATURA.indexOf('title="Transações"') + 900)
    expect(addAction).toContain('size="sm"')
    expect(addAction).toContain('className="cursor-pointer gap-1 px-2"')
    expect(addAction).not.toContain('text-[11px]')
  })

  it('Quitar tudo e Adicionar consomem a mesma autoridade tipográfica', () => {
    expect(DRAWER).toContain('<Button\n                        size="sm"\n                        className="gap-1.5"')
    expect(DRAWER).toContain('<Button size="sm" className="h-7 cursor-pointer gap-1 px-2"')
  })

  it('mantém o menu compacto e os dois CTAs superiores em primary', () => {
    expect(DRAWER).toContain('variant="default"')
    expect(IDENTITY_HEADER).toContain('flex min-w-0 items-start gap-3')
    expect(IDENTITY_HEADER).toContain('ml-auto flex shrink-0 items-start gap-2')
    expect(DRAWER).toContain("buttonVariants({ variant: 'default', size: 'sm', className: 'shrink-0 gap-1.5' })")
    expect(DRAWER).toContain('Extrato')
    expect(DRAWER).not.toContain('Extrato em PDF')
    expect(DRAWER).not.toContain('absolute top-3 right-12')
    expect(DRAWER).toContain('showCloseButton={false}')
    expect(IDENTITY_HEADER).toContain('className="size-8 shrink-0 p-0"')
  })

  it('mantém os valores monetários neutros e o status de atraso', () => {
    expect(DRAWER).toContain('ROW_AMOUNT_CLASS')
    expect(DRAWER).not.toContain('text-receivable/80')
    expect(DRAWER).toContain("status === 'overdue' && 'font-medium text-destructive'")
  })

  it('mantém o card informacional limpo e os subtotais muted', () => {
    const card = DRAWER_SECTIONS.slice(
      DRAWER_SECTIONS.indexOf('mx-4 rounded-xl bg-muted/40 p-4'),
      DRAWER_SECTIONS.indexOf('mx-4 rounded-xl bg-muted/40 p-4') + 400,
    )

    expect(card).not.toContain('Quitar tudo')
    expect(card).not.toContain('border border-border')
    expect(DRAWER).toContain('font-medium text-muted-foreground')
    expect(DRAWER).toContain('<DrawerFinancialList inset>')
    expect(FATURA).toContain('<DrawerFinancialList inset>')
  })

  it('mantém o CTA curto no heading, sem alterar o comportamento', () => {
    const cabecalho = DRAWER.slice(
      DRAWER.indexOf('Quitar tudo') - 500,
      DRAWER.indexOf('Quitar tudo') + 250,
    )

    expect(cabecalho).toContain('onClick={() => setSettleOpen(true)}')
    expect(DRAWER).not.toContain('Quitar pendências')
  })
})

describe('sem itens em aberto, a seção continua existindo', () => {
  it('o cabeçalho fica FORA do condicional de lista vazia', () => {
    /*
      Antes ele sumia junto com os itens, e restava só a frase solta — com a
      ação de adicionar, que é a mais útil num mês vazio, longe dali.
    */
    const tituloIndex = DRAWER.indexOf('title="Em aberto"')
    const vazioIndex = DRAWER.indexOf('monthSummary.itemCount === 0')

    /* O cabeçalho vem ANTES do teste de vazio. */
    expect(tituloIndex).toBeGreaterThan(-1)
    expect(tituloIndex).toBeLessThan(vazioIndex)
    expect(DRAWER.slice(tituloIndex, vazioIndex)).toContain('Adicionar')
  })

  it('a contagem reflete zero de forma coerente', () => {
    /* A mesma autoridade interpola qualquer número, inclusive zero, sem sufixo de item. */
    expect(DRAWER).toContain('count={monthSummary.itemCount}')
    expect(DRAWER_SECTIONS).toContain("{title}{' · '}{count}{suffix}")
    expect(SECTION_TITLE).not.toMatch(/(?:item|itens|text-muted-foreground|rounded-full)/i)
  })

  it('a mensagem textual sobreviveu', () => {
    expect(DRAWER).toContain('Nenhum valor em aberto para esta competência.')
  })
})

describe('objetivo 2: uma única data canônica', () => {
  it('a causa: `slice(0, 10)` devolve o dia em UTC', () => {
    /*
      04/09 às 00h30 UTC é 03/09 às 21h30 em Fortaleza. A lista de Pessoas usa
      `civilDay` no backend e dizia 03/09; o drawer fatiava o ISO e dizia
      04/09 — o mesmo registro com dois dias na mesma tela.
    */
    const instante = '2026-09-04T00:30:00.000Z'

    expect(instante.slice(0, 10)).toBe('2026-09-04')
    expect(civilDayOf(instante)).toBe('2026-09-03')
  })

  it('`civilDayOf` espelha o `civilDay` do backend', () => {
    const backend = ler(
      '../../../cartero-backend/src/common/helpers/date-only.helper.ts',
    )

    /* A mesma subtração de 3h antes do corte. */
    expect(backend).toContain('3 * 60 * 60 * 1000')
    expect(ler('./date.ts')).toContain('3 * 60 * 60 * 1000')
  })

  it('o drawer usa o helper, não o slice', () => {
    expect(DRAWER).toContain('accountCivilDayOf(item.paidAt, user?.timeZone ?? null)')
    expect(DRAWER).not.toContain("item.paidAt?.slice(0, 10)")
  })

  it('nenhum lugar do drawer fatia um `paidAt` cru', () => {
    /*
      Segundo guardião da divergência: o assert anterior verifica a linha que
      existe hoje, este barra a FORMA de voltar a errar em qualquer ponto.
    */
    expect(DRAWER).not.toMatch(/paidAt[^\n]*\.slice\(0,\s*10\)/)
  })

  it('um valor que JA e dia civil passa intacto', () => {
    /*
      `paidAt` chega das duas formas: instante completo quando o backend gravou
      `new Date()`, e `YYYY-MM-DD` quando a data foi informada pelo usuario.

      Sem a guarda, o segundo caso perde um dia: `new Date('2026-05-01')` e
      meia-noite UTC, e a subtracao de 3h cai em 30/04. O erro e silencioso —
      um dia a menos continua sendo uma data plausivel.
    */
    expect(civilDayOf('2026-05-01')).toBe('2026-05-01')
    expect(civilDayOf('2026-01-01')).toBe('2026-01-01')
    expect(civilDayOf('2026-12-31')).toBe('2026-12-31')
  })

  it('e o instante do MESMO dia continua sendo convertido', () => {
    /* A guarda nao pode desligar a conversao que motivou o helper. */
    expect(civilDayOf('2026-05-01T00:30:00.000Z')).toBe('2026-04-30')
  })

  it('a conversão só vale para INSTANTES', () => {
    /*
      `dueDate` já é dia civil (`YYYY-MM-DD`); reconvertê-lo introduziria o
      deslocamento que o helper existe para remover.
    */
    const doc = ler('./date.ts')

    expect(doc).toContain('TIMESTAMP')
    expect(doc).toContain('dueDate')
  })

  it('a virada de dia é tratada nos dois sentidos', () => {
    /* Antes das 03h UTC pertence ao dia anterior; depois, ao mesmo dia. */
    expect(civilDayOf('2026-09-04T02:59:00.000Z')).toBe('2026-09-03')
    expect(civilDayOf('2026-09-04T03:00:00.000Z')).toBe('2026-09-04')
    expect(civilDayOf('2026-09-04T12:00:00.000Z')).toBe('2026-09-04')
  })

  it('aceita string e Date', () => {
    const iso = '2026-09-04T00:30:00.000Z'

    expect(civilDayOf(iso)).toBe(civilDayOf(new Date(iso)))
  })

  it('a regra é a MESMA dos dois lados: maior data, ou nenhuma', () => {
    /*
      O drawer replica `aggregateSettledAt`: a maior data entre os resolvidos,
      e `null` se algum não tiver `paidAt` — a data de outro item não pode
      falar pela conclusão que aquele registro não conhece.
    */
    expect(DRAWER).toContain('if (maior === null || dia > maior) maior = dia')
    expect(DRAWER).toContain('if (!dia) return null')
  })
})

describe('objetivo 3: cursor nos alvos de clique', () => {
  const primitive = (nome: string) =>
    semComentarios(ler(`../components/ui/${nome}`))

  it('as rows clicáveis mostram a mãozinha', () => {
    /*
      A row é um `button` ou um `Link`, e o navegador só mostra o cursor
      automaticamente em `<a href>` — num `button` fica de seta, e a
      affordance dependia só do fundo do hover.
    */
    expect(ROW_SURFACE).toContain("'group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg'")
    expect(ROW_SURFACE).toContain("'flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg'")
    expect(FINANCIAL_LIST_ROW).toContain("financialDrawerRowSurfaceClass('interactive')")
  })

  it('as rows do Orçamento já tinham', () => {
    expect(primitive('status-list-row.tsx')).toContain('cursor-pointer')
  })

  it('botões e gatilhos de menu vêm do primitive', () => {
    /*
      `Button` cobre WhatsApp, PDF, "+ Adicionar" e o fechar do Sheet — todos
      o usam, direto ou via `buttonVariants`.
    */
    expect(primitive('button.tsx')).toContain('cursor-pointer')
    expect(primitive('dropdown-menu.tsx')).toContain('cursor-pointer')
  })

  it('abas e selects também', () => {
    expect(primitive('tabs.tsx')).toContain('cursor-pointer')
    expect(primitive('select.tsx')).toContain('cursor-pointer')
  })

  it('o estado desabilitado é preservado', () => {
    /*
      `disabled:cursor-not-allowed` no botão, e `pointer-events-none` nos
      demais — o cursor de clique não sobrevive ao desabilitado.
    */
    expect(primitive('button.tsx')).toContain('disabled:cursor-not-allowed')
    expect(primitive('select.tsx')).toContain('disabled:cursor-not-allowed')
    expect(primitive('tabs.tsx')).toContain('disabled:pointer-events-none')
  })

  it('texto estático NÃO recebe cursor', () => {
    /*
      A row do drawer é uma `div` de leitura — só os controles internos agem, e
      eles são botões.
    */
    expect(DRAWER).toContain('ReceivableDetailDrawer')
    expect(DRAWER).toContain('DebtDetailDrawer')
    expect(DRAWER).toContain('FinancialSettlementRow')
    expect(FINANCIAL_SETTLEMENT_ROW).toContain('<FinancialListRow')
    expect(DRAWER).toContain('FinancialAvatar')
    expect(primitive('financial-avatar.tsx')).toContain('AVATAR_3D_CLASS')
    expect(FINANCIAL_LIST_ROW).toContain('DisclosureChevron')
    expect(DRAWER).toContain('onView={() => setDetailReceivable(r)}')
    expect(DRAWER).toContain('onView={() => setDetailDebt(d)}')
    expect(FINANCIAL_LIST_ROW).toContain("!interactive && 'cursor-default hover:bg-transparent'")
    expect(FINANCIAL_LIST_ROW).toContain(') : interactive && !inactive ? (')
    expect(FINANCIAL_LIST_ROW).toContain('aria-disabled={inactive || undefined}')
    expect(DRAWER).toContain('setDetailReceivable(null)')
    expect(DRAWER).toContain('setDetailDebt(null)')
  })

  it('Pessoa consome as authorities compartilhadas do drawer', () => {
    expect(DRAWER).toContain('<DrawerIdentityHeader')
    expect(DRAWER).toContain('<DrawerSummaryCard>')
    expect(DRAWER).toContain('<DrawerSummaryLabel>')
    expect(DRAWER).toContain('<DrawerSummaryValue tracking="tight">')
    expect(DRAWER).toContain('<DrawerCompletionStatus>')
    expect(DRAWER).toContain('<DrawerSectionHeader')
    expect(DRAWER).toContain('<DrawerSectionTitle')
    expect(DRAWER).toContain('<DrawerFinancialList inset>')
    expect(DRAWER).toContain('<FinancialSettlementRow')
  })

  it('usa a composição compartilhada para separar detalhe e alternância de status', () => {
    expect(DRAWER).toContain('onView={onView}')
    expect(DRAWER).toContain('onToggleStatus={onToggle}')
    expect(DRAWER).toContain('onToggle={() => handleReceivableToggle(r)}')
    expect(DRAWER).toContain('onToggle={() => handleDebtToggle(d)}')
    expect(DRAWER).toContain('onView={() => setDetailReceivable(r)}')
    expect(DRAWER).toContain('onView={() => setDetailDebt(d)}')
    expect(DRAWER).toContain('<FinancialSettlementRow')
    expect(FINANCIAL_SETTLEMENT_ROW).toContain('leadingAction={')
    expect(FINANCIAL_SETTLEMENT_ROW).toContain('onToggleStatus')
    expect(FINANCIAL_SETTLEMENT_ROW).toContain('statusActionLabel')
    expect(FINANCIAL_LIST_ROW).toContain('{leadingAction}')
    expect(FINANCIAL_LIST_ROW).toContain('<button')
    expect(FINANCIAL_LIST_ROW).toContain('onClick={onView}')
  })

})

describe('financial rows compartilham a autoridade de secondary text', () => {
  it('Invoice define meta, gaps e trailing secondary', () => {
    expect(FINANCIAL_LIST_ROW).toContain('flex min-w-0 flex-1 flex-col gap-1.5')
    expect(FINANCIAL_LIST_ROW).toContain(
      "'flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground",
    )
    expect(FINANCIAL_LIST_ROW).toContain('shrink-0 flex-col items-end gap-1')
    expect(FINANCIAL_LIST_ROW).toContain(
      'whitespace-nowrap text-[10px] uppercase tracking-[0.06em] text-muted-foreground/70',
    )
    expect(FATURA).toContain('<FinancialListRow')
    expect(FATURA).toContain('<FinancialRowTrailing')
  })

  it('consumidores usam a primitive ou as authorities compartilhadas', () => {
    expect(DRAWER).toContain('<FinancialSettlementRow')
    expect(DRAWER).toContain('ROW_AMOUNT_CLASS')
    expect(DRAWER).not.toContain('ROW_TRAILING_META_CLASS')
    expect(INCOME_PAGE).toContain('<FinancialSettlementRow')
    expect(INCOME_PAGE).toContain('ROW_TRAILING_META_CLASS')
    expect(BUDGET_ROW).toContain('<FinancialListRow')
    expect(BUDGET_ROW).toContain('<FinancialRowTrailing')
  })
})

describe('Person History não repete o vencimento no trailing', () => {
  it('future e overdue mantêm a data curta na meta esquerda', () => {
    const abertas = DRAWER.slice(
      DRAWER.indexOf('{monthReceivables.map'),
      DRAWER.indexOf('{historyReceivables.map'),
    )

    expect(abertas).toContain('dueLabel={dueContext(r, competence, today).text}')
    expect(abertas).toContain('dueLabel={dueContext(d, competence, today).text}')
    expect(SETTLEMENT_VIEW).toContain('text: `Vence em ${dueText}`')
    expect(SETTLEMENT_VIEW).toContain('text: `Venceu em ${dueText}`')
  })

  it('remove a data direita, preservando metadata esquerda e valor', () => {
    const history = DRAWER.slice(DRAWER.indexOf('{historyReceivables.map'))

    expect(DRAWER).toContain(
      "formatSignedCurrency(Number(item.amount), isReceivable ? 'in' : 'out')",
    )
    expect(history).not.toContain('formatDate(item.dueDate)')
    expect(history).not.toContain('ROW_TRAILING_META_CLASS')
    expect(history).toContain(
      "dueLabel={resolvedLabel(r, 'receivable', user?.timeZone ?? null)}",
    )
    expect(history).toContain(
      "dueLabel={resolvedLabel(d, 'debt', user?.timeZone ?? null)}",
    )
  })
})

describe('o que já estava bom foi preservado', () => {
  it('o card de saldo final do mês', () => {
    expect(DRAWER).toContain('competenceCard({')
    expect(DRAWER).toContain('cardCompetencia.label')
  })

  it('a separação entre Em aberto e Histórico', () => {
    expect(DRAWER).toContain('Em aberto')
    expect(DRAWER).toContain('count={monthSummary.itemCount}')
    expect(SECTION_TITLE).not.toMatch(/(?:item|itens)/i)
    expect(DRAWER).toContain('Histórico')
  })

  it('o histórico segue sem tachado', () => {
    expect(DRAWER).not.toContain('line-through')
  })

  it('as ações de WhatsApp e PDF continuam no topo', () => {
    /* Elas são sobre a PESSOA, não sobre a lista — o lugar delas não mudou. */
    expect(DRAWER).not.toContain('Enviar no WhatsApp')
    expect(DRAWER).toContain('Extrato')
    expect(DRAWER).toContain('onClick={downloadStatementPdf}')
    expect(DRAWER).toContain('onClick={shareStatementPdf}')
    expect(DRAWER).toContain('Baixar PDF')
    expect(DRAWER).toContain('Compartilhar PDF')
  })
})

describe('a data civil vale para TODA exibicao de `paidAt`', () => {
  /*
    O card do drawer foi o primeiro achado, mas a mesma divergencia vivia em
    mais tres lugares — todos lendo o instante como se fosse dia civil. A
    validacao em browser pegou a linha do historico dizendo "Recebido em
    04/09" logo abaixo de um card que dizia "Quitado em 03/09".
  */

  const VIEW = semComentarios(ler('./person-settlement-view.ts'))

  it('a linha do historico converte antes de formatar', () => {
    expect(VIEW).toContain('const settledDay = accountCivilDayOf(item.paidAt, timeZone)')
    expect(VIEW).not.toContain('fullDate(item.paidAt)')
  })

  it('a comparacao de ano le a MESMA string que a exibicao', () => {
    /*
      Senao 31/12 as 23h UTC compararia com 2027 e imprimiria 2026 — a linha
      escolheria o formato longo pelo ano errado.
    */
    expect(VIEW).toContain("due.slice(0, 4) !== settledDay.slice(0, 4)")
    expect(VIEW).not.toContain("item.paidAt.slice(0, 4)")
  })

  it('os drawers de detalhe de Divida e Cobranca tambem', () => {
    const debt = ler('../app/(dashboard)/debts/debt-detail-drawer.tsx')
    const recv = ler('../app/(dashboard)/receivables/receivable-detail-drawer.tsx')

    expect(debt).toContain('formatDate(accountCivilDayOf(debt.paidAt, user?.timeZone ?? null))')
    expect(recv).toContain('formatDate(accountCivilDayOf(receivable.paidAt, user?.timeZone ?? null))')
  })

  it('`formatDate` sozinho NAO resolve — ele fatia em UTC', () => {
    /*
      A razao de a conversao ser explicita em cada chamada: `formatDate`
      delega a `parseDateOnly`, que corta os 10 primeiros caracteres do ISO.
    */
    const fmt = ler('./formatters.ts')

    expect(fmt).toContain('parseDateOnly')
    expect(ler('./date.ts')).toContain("dateString.slice(0, 10).split('-')")
  })

  it('`settledAt` NAO passa por `civilDayOf` — ja e dia civil', () => {
    /*
      O backend o entrega por `civilDay`/`aggregateSettledAt`. Reconverter
      subtrairia 3h de uma data sem hora e voltaria o dia anterior.
    */
    for (const arquivo of [
      './person-competence-card.ts',
      './person-period-view.ts',
      './budget-settlement-meta.ts',
    ]) {
      const src = semComentarios(ler(arquivo))
      expect(src, arquivo).not.toContain('civilDayOf')
    }
  })
})
