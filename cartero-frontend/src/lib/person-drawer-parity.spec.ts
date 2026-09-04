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
const FATURA = semComentarios(
  ler('../components/invoice-details-drawer.tsx'),
)

describe('objetivo 1: a seção "Em aberto" segue o padrão de Fatura', () => {
  it('o cabeçalho tem a mesma geometria', () => {
    /*
      `h-11` fixo, borda em cima e embaixo, título à esquerda e ação à direita
      — a faixa que Fatura usa para "Transações · X".
    */
    const faixa =
      'flex h-11 items-center justify-between gap-2 border-y border-border pl-4 pr-2'

    expect(FATURA).toContain(faixa)
    expect(DRAWER).toContain(faixa)
  })

  it('o título conta os itens, como em Fatura', () => {
    expect(DRAWER).toContain('Em aberto · {monthSummary.itemCount}')
    expect(FATURA).toContain('Transações · {txs.length}')
  })

  it('a ação vive no cabeçalho, não no topo do painel', () => {
    /*
      Ela opera sobre a LISTA. No topo ocupava uma faixa inteira do painel
      para algo que a seção já contextualiza.
    */
    expect(DRAWER).not.toContain('Adicionar dívida ou cobrança')
    expect(DRAWER).toContain('Adicionar')

    const cabecalho = DRAWER.slice(
      DRAWER.indexOf('Em aberto · {monthSummary.itemCount}'),
      DRAWER.indexOf('Em aberto · {monthSummary.itemCount}') + 1400,
    )
    expect(cabecalho).toContain('Adicionar')
    expect(cabecalho).toContain('openNewReceivable')
    expect(cabecalho).toContain('openNewDebt')
  })

  it('as DUAS opções sobrevivem', () => {
    /*
      Diferente de Fatura, onde só existe transação: aqui a ação é ambígua por
      natureza, e um botão simples obrigaria a escolher um sentido por padrão.
    */
    expect(DRAWER).toContain('Nova cobrança')
    expect(DRAWER).toContain('Nova dívida')
  })

  it('o botão usa a escala de Fatura', () => {
    const escala = "h-7 cursor-pointer gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"

    expect(DRAWER).toContain(escala)
    /* Fatura usa a mesma, sem o cursor (o `Button` já o traz). */
    expect(FATURA).toContain(
      'h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground',
    )
  })
})

describe('sem itens em aberto, a seção continua existindo', () => {
  it('o cabeçalho fica FORA do condicional de lista vazia', () => {
    /*
      Antes ele sumia junto com os itens, e restava só a frase solta — com a
      ação de adicionar, que é a mais útil num mês vazio, longe dali.
    */
    const secao = DRAWER.slice(
      DRAWER.indexOf('Em aberto · {monthSummary.itemCount}'),
    )
    const ateOCondicional = secao.slice(
      0,
      secao.indexOf('monthSummary.itemCount === 0'),
    )

    /* O cabeçalho vem ANTES do teste de vazio. */
    expect(ateOCondicional).toContain('Adicionar')
    expect(secao).toContain('monthSummary.itemCount === 0')
  })

  it('a contagem reflete zero de forma coerente', () => {
    /* "Em aberto · 0 itens" — o plural é resolvido pela contagem. */
    expect(DRAWER).toContain(
      "{monthSummary.itemCount === 1 ? 'item' : 'itens'}",
    )
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
    expect(DRAWER).toContain('civilDayOf(item.paidAt)')
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
    const row = primitive('financial-list-row.tsx')

    expect(row).toContain('w-full min-w-0 cursor-pointer items-center')
    expect(row).toContain('flex-1 cursor-pointer items-center')
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
    const rowDoDrawer = DRAWER.slice(
      DRAWER.indexOf('function StatementRow'),
      DRAWER.indexOf('function ToggleButton'),
    )

    expect(rowDoDrawer).not.toContain('cursor-pointer')
  })
})

describe('o que já estava bom foi preservado', () => {
  it('o card de saldo final do mês', () => {
    expect(DRAWER).toContain('competenceCard({')
    expect(DRAWER).toContain('cardCompetencia.label')
  })

  it('a separação entre Em aberto e Histórico', () => {
    expect(DRAWER).toContain('Em aberto ·')
    expect(DRAWER).toContain('Histórico')
  })

  it('o histórico segue sem tachado', () => {
    expect(DRAWER).not.toContain('line-through')
  })

  it('as ações de WhatsApp e PDF continuam no topo', () => {
    /* Elas são sobre a PESSOA, não sobre a lista — o lugar delas não mudou. */
    expect(DRAWER).toContain('Enviar no WhatsApp')
    expect(DRAWER).toContain('Extrato em PDF')
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
    expect(VIEW).toContain('const settledDay = civilDayOf(item.paidAt)')
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

    expect(debt).toContain('formatDate(civilDayOf(debt.paidAt))')
    expect(recv).toContain('formatDate(civilDayOf(receivable.paidAt))')
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
