import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { personsSummaryLines } from './persons-summary-text'
import { formatMonthOfYear, formatMonthYear } from './formatters'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * PEOPLE SUMMARY3.1 — a competência no rótulo, o líquido no progresso
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Duas correções de leitura, sem tocar no que a fase anterior estabeleceu:
 *
 * · `Saldo com pessoas` não dizia de QUE mês falava, apesar de o valor ser
 *   mensal e o seletor viver longe, na barra superior;
 *
 * · a terceira linha repetia os dois lados na mesma forma da composição logo
 *   acima — quatro números em duas linhas quase idênticas.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** `Intl` pt-BR separa `R$` do número com espaço não-quebrável. */
const texto = (s: string | undefined) => (s ?? '').replace(/ /g, ' ')

const resumo = (o: Partial<Parameters<typeof personsSummaryLines>[0]>) =>
  personsSummaryLines({
    toReceive: 0,
    toPay: 0,
    openToReceive: 0,
    openToPay: 0,
    outstanding: 0,
    comMovimento: 1,
    ...o,
  })

const linha = (
  ls: ReturnType<typeof personsSummaryLines>,
  kind: 'composition' | 'open' | 'settled' | 'empty',
) => texto(ls.find((l) => l.kind === kind)?.text)

const kinds = (ls: ReturnType<typeof personsSummaryLines>) =>
  ls.map((l) => l.kind)

describe('L1-L4: o rótulo carrega a competência', () => {
  it('L1: setembro de 2026', () => {
    expect(formatMonthOfYear(9, 2026)).toBe('setembro de 2026')
  })

  it('L2: agosto de 2026', () => {
    expect(formatMonthOfYear(8, 2026)).toBe('agosto de 2026')
  })

  it('atravessa o ano corretamente', () => {
    expect(formatMonthOfYear(1, 2027)).toBe('janeiro de 2027')
    expect(formatMonthOfYear(12, 2025)).toBe('dezembro de 2025')
  })

  it('L3: a página lê a competência SELECIONADA', () => {
    /*
      `period` vem de `useMonthPeriod()` — a autoridade da barra de navegação
      mensal. Derivar de `new Date()` aqui exibiria o mês civil sob um valor
      que pertence a outro.
    */
    const PAGE = semComentarios(ler('../app/(dashboard)/persons/page.tsx'))

    expect(PAGE).toContain(
      'formatMonthOfYear(period.month, period.year)',
    )
    expect(PAGE).toContain('Saldo com pessoas de')
    expect(PAGE).toContain('useMonthPeriod()')
  })

  it('o rótulo nunca fica sem competência', () => {
    /*
      Segundo guardião: o assert acima verifica a chamada que existe hoje,
      este barra a FORMA de voltar ao rótulo mudo. O valor é mensal e o
      seletor vive longe, na barra superior — sem o mês, a tela não diz de
      que competência está falando.
    */
    const PAGE = semComentarios(ler('../app/(dashboard)/persons/page.tsx'))

    /* Não existe `Saldo com pessoas` que não seja seguido de `de`. */
    expect(PAGE).not.toMatch(/Saldo com pessoas(?! de)/)
    expect(PAGE).toMatch(/Saldo com pessoas de/)
  })

  it('L4: o rótulo NÃO deriva do relógio', () => {
    const PAGE = semComentarios(ler('../app/(dashboard)/persons/page.tsx'))
    const bloco = PAGE.slice(
      PAGE.indexOf('Saldo com pessoas de'),
      PAGE.indexOf('Saldo com pessoas de') + 220,
    )

    expect(bloco).not.toContain('new Date()')
    expect(bloco).not.toContain('todayDateValue')
  })

  it('meses não são hardcodados', () => {
    const FMT = semComentarios(ler('./formatters.ts'))

    /* Se houvesse um array de nomes, ele apareceria aqui. */
    expect(FMT).not.toContain("'janeiro'")
    expect(FMT).toContain('ptBR')
  })

  it('a hora é LOCAL — `Date.UTC` deslocaria o mês', () => {
    /*
      Meia-noite UTC do dia 1 é o dia 30/31 do mês anterior em Fortaleza
      (UTC-3), e o rótulo exibiria o mês errado. O primeiro dia de cada mês do
      ano é o caso crítico.
    */
    for (let m = 1; m <= 12; m++) {
      const esperado = new Date(2026, m - 1, 1).getMonth()
      expect(new Date(2026, m - 1, 1).getMonth(), `mês ${m}`).toBe(esperado)
      expect(formatMonthOfYear(m, 2026)).toContain('2026')
    }
    /* Janeiro não vaza para dezembro do ano anterior. */
    expect(formatMonthOfYear(1, 2026)).toBe('janeiro de 2026')
  })

  it('`formatMonthYear` NÃO foi alterado — 28 consumidores', () => {
    /*
      Bancos, Orçamento, faturas e diálogos usam a forma sem preposição.
      Mudá-la ali seria alterar telas que esta fase não pode tocar.
    */
    expect(formatMonthYear(9, 2026)).toBe('setembro 2026')
    expect(formatMonthYear(9, 2026)).not.toContain(' de ')
  })
})

describe('P1-P6: a terceira linha é o líquido restante', () => {
  it('P2: restante positivo → `Restam R$ X a receber`', () => {
    /* Histórico 1.170,36/441,00; aberto 1.087,30/430,00 → 657,30. */
    const r = resumo({
      toReceive: 1170.36,
      toPay: 441,
      openToReceive: 1087.3,
      openToPay: 430,
      outstanding: 2,
    })

    expect(linha(r, 'open')).toBe('Restam R$ 657,30 a receber')
    expect(kinds(r)).toEqual(['composition', 'open'])
  })

  it('P3: restante negativo → `Restam R$ X a pagar`', () => {
    /* Histórico 200/500; aberto 100/250 → −150. */
    const r = resumo({
      toReceive: 200,
      toPay: 500,
      openToReceive: 100,
      openToPay: 250,
      outstanding: 1,
    })

    expect(linha(r, 'open')).toBe('Restam R$ 150,00 a pagar')
  })

  it('P4: restante zero com pendência → `Ainda há valores a acertar`', () => {
    const r = resumo({
      toReceive: 200,
      toPay: 200,
      openToReceive: 200,
      openToPay: 200,
      outstanding: 1,
    })

    expect(linha(r, 'open')).toBe('Ainda há valores a acertar')
  })

  it('P5: tudo quitado → `Tudo em dia`', () => {
    const r = resumo({ toReceive: 1050.45, toPay: 330, outstanding: 0 })

    expect(kinds(r)).toEqual(['composition', 'settled'])
    expect(linha(r, 'settled')).toBe('Tudo em dia')
    expect(linha(r, 'composition')).toBe(
      'R$ 1.050,45 a receber · R$ 330,00 a pagar',
    )
  })

  it('P6: sem atividade → nenhuma linha de progresso', () => {
    const r = resumo({ comMovimento: 0 })

    expect(kinds(r)).toEqual(['empty'])
    expect(r.some((l) => l.kind === 'open')).toBe(false)
    expect(r.some((l) => l.kind === 'settled')).toBe(false)
  })

  it('a copy bilateral foi REMOVIDA', () => {
    const casos = [
      { toReceive: 700, toPay: 200, openToReceive: 500, openToPay: 100, outstanding: 2 },
      { toReceive: 200, toPay: 200, openToReceive: 200, openToPay: 200, outstanding: 1 },
      { toReceive: 900, toPay: 0, openToReceive: 100, openToPay: 0, outstanding: 1 },
    ]

    for (const caso of casos) {
      for (const l of resumo(caso)) {
        expect(l.text, JSON.stringify(caso)).not.toContain('Em aberto:')
      }
    }
    expect(semComentarios(ler('./persons-summary-text.ts'))).not.toContain(
      'Em aberto:',
    )
  })
})

describe('P1/§12-13: a linha só aparece quando há o que dizer', () => {
  it('P1: nada quitado ainda → linha omitida', () => {
    /*
      O restante É o líquido histórico logo acima. Repeti-lo em outras
      palavras não informa — o mesmo princípio que faz Bancos esconder o
      progresso enquanto o pendente é o próprio total.
    */
    const r = resumo({
      toReceive: 700,
      toPay: 200,
      openToReceive: 700,
      openToPay: 200,
      outstanding: 2,
    })

    expect(kinds(r)).toEqual(['composition'])
    expect(r.some((l) => l.text.includes('Restam'))).toBe(false)
  })

  it('§13: mas net-zero aberto aparece MESMO sem progresso', () => {
    /*
      A exceção deliberada: com o total principal em R$ 0,00, calar seria
      lido como ausência de pendência.
    */
    const r = resumo({
      toReceive: 200,
      toPay: 200,
      openToReceive: 200,
      openToPay: 200,
      outstanding: 1,
    })

    expect(kinds(r)).toEqual(['composition', 'open'])
    expect(linha(r, 'open')).toBe('Ainda há valores a acertar')
  })

  it('progresso de UM lado só já basta para a linha aparecer', () => {
    /* Recebeu parte; o lado a pagar não se moveu. */
    const r = resumo({
      toReceive: 700,
      toPay: 200,
      openToReceive: 400,
      openToPay: 200,
      outstanding: 2,
    })

    expect(linha(r, 'open')).toBe('Restam R$ 200,00 a receber')
  })

  it('pagar parte também revela a linha', () => {
    const r = resumo({
      toReceive: 700,
      toPay: 200,
      openToReceive: 700,
      openToPay: 50,
      outstanding: 2,
    })

    expect(linha(r, 'open')).toBe('Restam R$ 650,00 a receber')
  })
})

describe('M1-M5: a matemática do restante', () => {
  it('M1: `remainingNet = openToReceive - openToPay`', () => {
    const r = resumo({
      toReceive: 1000,
      toPay: 1000,
      openToReceive: 812.45,
      openToPay: 300.15,
      outstanding: 2,
    })

    /* 812,45 − 300,15 = 512,30 */
    expect(linha(r, 'open')).toBe('Restam R$ 512,30 a receber')
  })

  it('M2/M4: negativo nunca imprime o sinal', () => {
    const r = resumo({
      toReceive: 0,
      toPay: 500,
      openToReceive: 0,
      openToPay: 200,
      outstanding: 1,
    })

    expect(linha(r, 'open')).toBe('Restam R$ 200,00 a pagar')
    expect(linha(r, 'open')).not.toContain('-R$')
    expect(linha(r, 'open')).not.toContain('−')
  })

  it('M3: positivo não vira negativo pelo formatter', () => {
    const r = resumo({
      toReceive: 900,
      toPay: 0,
      openToReceive: 300,
      openToPay: 0,
      outstanding: 1,
    })

    expect(linha(r, 'open')).toBe('Restam R$ 300,00 a receber')
    expect(linha(r, 'open')).not.toContain('a pagar')
  })

  it('M5: restante zero com pendência não é tratado como quitado', () => {
    const r = resumo({
      toReceive: 400,
      toPay: 400,
      openToReceive: 150,
      openToPay: 150,
      outstanding: 1,
    })

    expect(r.some((l) => l.kind === 'settled')).toBe(false)
    expect(linha(r, 'open')).toBe('Ainda há valores a acertar')
  })

  it('centavo de resíduo não vira "Restam R$ 0,00"', () => {
    /*
      Somas de reais em ponto flutuante deixam resíduos. Sem a tolerância, a
      linha exibiria um valor que arredonda para zero.
    */
    const r = resumo({
      toReceive: 300,
      toPay: 300,
      openToReceive: 100.000001,
      openToPay: 100,
      outstanding: 1,
    })

    expect(linha(r, 'open')).toBe('Ainda há valores a acertar')
  })
})

describe('H1-H4: o histórico continua estável', () => {
  const HISTORICO = { toReceive: 1000, toPay: 300 }

  it('H1: receber não muda o total nem a composição', () => {
    const antes = resumo({
      ...HISTORICO,
      openToReceive: 1000,
      openToPay: 300,
      outstanding: 2,
    })
    const depois = resumo({
      ...HISTORICO,
      openToReceive: 600,
      openToPay: 300,
      outstanding: 2,
    })

    expect(linha(antes, 'composition')).toBe(linha(depois, 'composition'))
  })

  it('H2: pagar também não', () => {
    const depois = resumo({
      ...HISTORICO,
      openToReceive: 600,
      openToPay: 0,
      outstanding: 1,
    })

    expect(linha(depois, 'composition')).toBe(
      'R$ 1.000,00 a receber · R$ 300,00 a pagar',
    )
  })

  it('H3/H4: só a linha de progresso se move', () => {
    const estagios = [
      { openToReceive: 1000, openToPay: 300, outstanding: 2 },
      { openToReceive: 600, openToPay: 300, outstanding: 2 },
      { openToReceive: 600, openToPay: 0, outstanding: 1 },
      { openToReceive: 0, openToPay: 0, outstanding: 0 },
    ]
    const composicoes = estagios.map((e) =>
      linha(resumo({ ...HISTORICO, ...e }), 'composition'),
    )
    const progressos = estagios.map((e) => {
      const r = resumo({ ...HISTORICO, ...e })
      return linha(r, 'open') || linha(r, 'settled')
    })

    /* A composição é a MESMA nos quatro estágios. */
    expect(new Set(composicoes).size).toBe(1)
    /* O progresso muda em cada um. */
    expect(progressos).toEqual([
      '',
      'Restam R$ 300,00 a receber',
      'Restam R$ 600,00 a receber',
      'Tudo em dia',
    ])
  })
})

describe('§19: tons — só a conclusão ganha cor', () => {
  it('a página pinta apenas `settled`', () => {
    const PAGE = semComentarios(ler('../app/(dashboard)/persons/page.tsx'))

    expect(PAGE).toContain("linha.kind === 'settled'")
    expect(PAGE).toContain('font-medium text-paid')
    expect(PAGE).toContain('text-muted-foreground')
  })

  it('nada de verde para receber nem vermelho para pagar', () => {
    /*
      A direção já está no texto ("a receber"/"a pagar"). Verde significa
      RESOLVIDO no produto, e usá-lo aqui faria dinheiro que talvez entre
      parecer dinheiro que entrou.
    */
    const PAGE = semComentarios(ler('../app/(dashboard)/persons/page.tsx'))
    const bloco = PAGE.slice(
      PAGE.indexOf('personsSummaryLines(summary)'),
      PAGE.indexOf('personsSummaryLines(summary)') + 900,
    )

    expect(bloco).not.toContain('text-receivable')
    expect(bloco).not.toContain('text-destructive')
  })
})

describe('§20-22: o que esta fase NÃO toca', () => {
  it('as rows de Pessoas mantêm o contrato', () => {
    const VIEW = semComentarios(ler('./person-period-view.ts'))

    /* ACTIVE deriva do outstanding; SETTLED do histórico. */
    expect(VIEW).toContain("if (Math.abs(liquido) <= EPSILON) return 'toSettle'")
    expect(VIEW).toContain('SALDO FINAL')
    expect(VIEW).toContain('SEM SALDO')
  })

  it('Bancos continua com `pago · para quitar`', () => {
    const BANCOS = semComentarios(ler('./bank-month-summary-lines.ts'))

    expect(BANCOS).toContain('paid: summary.total - summary.unpaid')
    expect(BANCOS).toContain("text: 'Tudo em dia'")
    /* E não adotou a gramática de Pessoas. */
    expect(BANCOS).not.toContain('Restam ')
  })

  it('cada domínio mantém a própria gramática', () => {
    const PESSOAS = semComentarios(ler('./persons-summary-text.ts'))

    expect(PESSOAS).not.toContain('para quitar')
    expect(PESSOAS).not.toContain('pago ·')
  })
})
