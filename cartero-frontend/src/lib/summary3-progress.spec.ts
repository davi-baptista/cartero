import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { personsSummaryLines } from './persons-summary-text'
import { bankMonthSummaryLines } from './bank-month-summary-lines'
import { personRowStatus, PERSON_ROW_LABEL } from './person-period-view'
import { InvoiceStatus } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * SUMMARY3 — o total do mês para de encolher quando se quita
 * ══════════════════════════════════════════════════════════════════════════
 *
 * As duas telas passam a seguir o mesmo princípio:
 *
 *   TOTAL      o que o mês movimentou — estável
 *   PROGRESSO  o que ainda falta — linha própria
 *
 * O progresso respeita o domínio, e é aqui que as duas divergem de propósito:
 *
 *   BANCOS   unidirecional  → "R$ X pago · R$ Y para quitar"
 *   PESSOAS  bilateral      → "Em aberto: R$ X a receber · R$ Y a pagar"
 *
 * Forçar Pessoas na gramática de Bancos exigiria um líquido, e o líquido é
 * exatamente o que mente aqui: R$ 200 abertos de cada lado dão zero com
 * R$ 400 em obrigações vivas.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** `Intl` pt-BR usa espaço não-quebrável depois de `R$`. */
const texto = (s: string | undefined) => (s ?? '').replace(/ /g, ' ')

// ─── Pessoas ─────────────────────────────────────────────────────────────

const pessoas = (o: Partial<Parameters<typeof personsSummaryLines>[0]>) =>
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

describe('P1-P4: o cenário canônico da fase', () => {
  /*
    Histórico: R$ 1.050,45 a receber · R$ 330,00 a pagar → líquido 720,45.
    Aberto:    R$ 437,64 a receber · R$ 330,00 a pagar.
  */
  const CENARIO = {
    toReceive: 1050.45,
    toPay: 330,
    openToReceive: 437.64,
    openToPay: 330,
    outstanding: 2,
  }

  it('P3: a composição usa os totais HISTÓRICOS', () => {
    expect(linha(pessoas(CENARIO), 'composition')).toBe(
      'R$ 1.050,45 a receber · R$ 330,00 a pagar',
    )
  })

  it('P4: a terceira linha usa os totais ABERTOS', () => {
    expect(linha(pessoas(CENARIO), 'open')).toBe(
      'Em aberto: R$ 437,64 a receber · R$ 330,00 a pagar',
    )
  })

  it('as duas linhas coexistem, nessa ordem', () => {
    expect(pessoas(CENARIO).map((l) => l.kind)).toEqual([
      'composition',
      'open',
    ])
  })

  it('P1: a composição não muda ao quitar', () => {
    /*
      A propriedade central da fase. Mesmo histórico, três estágios de
      settlement — a linha de cima é byte a byte a mesma.
    */
    const estagios = [
      { openToReceive: 1000, openToPay: 300, outstanding: 2 },
      { openToReceive: 600, openToPay: 300, outstanding: 2 },
      { openToReceive: 600, openToPay: 0, outstanding: 1 },
    ]
    const composicoes = estagios.map((e) =>
      linha(pessoas({ toReceive: 1000, toPay: 300, ...e }), 'composition'),
    )

    expect(new Set(composicoes).size).toBe(1)
    expect(composicoes[0]).toBe('R$ 1.000,00 a receber · R$ 300,00 a pagar')
  })

  it('P5: receber muda SÓ o lado de receber', () => {
    const antes = pessoas({
      toReceive: 1000,
      toPay: 300,
      openToReceive: 1000,
      openToPay: 300,
      outstanding: 2,
    })
    const depois = pessoas({
      toReceive: 1000,
      toPay: 300,
      openToReceive: 600,
      openToPay: 300,
      outstanding: 2,
    })

    expect(linha(antes, 'composition')).toBe(linha(depois, 'composition'))
    expect(linha(depois, 'open')).toBe(
      'Em aberto: R$ 600,00 a receber · R$ 300,00 a pagar',
    )
  })

  it('P6: pagar muda SÓ o lado de pagar', () => {
    const depois = pessoas({
      toReceive: 1000,
      toPay: 300,
      openToReceive: 600,
      openToPay: 0,
      outstanding: 1,
    })

    expect(linha(depois, 'composition')).toBe(
      'R$ 1.000,00 a receber · R$ 300,00 a pagar',
    )
    expect(linha(depois, 'open')).toBe(
      'Em aberto: R$ 600,00 a receber · R$ 0,00 a pagar',
    )
  })

  it('P2: o total principal é histórico — a página o calcula assim', () => {
    const PAGE = semComentarios(ler('../app/(dashboard)/persons/page.tsx'))

    expect(PAGE).toContain('const toReceive = historicoReceber')
    expect(PAGE).toContain('const toPay = historicoPagar')
    expect(PAGE).toContain('net: toReceive - toPay')
    /* A alternância que a fase remove. */
    expect(PAGE).not.toContain('const ativo = comPendencia > 0')
  })
})

describe('P7: net-zero aberto mostra os DOIS lados', () => {
  const NET_ZERO = {
    toReceive: 200,
    toPay: 200,
    openToReceive: 200,
    openToPay: 200,
    outstanding: 1,
  }

  it('nunca reduz a um líquido', () => {
    /*
      R$ 0 anunciaria trabalho concluído com R$ 400 em obrigações vivas — e é
      o mesmo caso que protege o estado `A ACERTAR` das rows.
    */
    expect(linha(pessoas(NET_ZERO), 'open')).toBe(
      'Em aberto: R$ 200,00 a receber · R$ 200,00 a pagar',
    )
  })

  it('P4/P7: net-zero aberto NÃO diz "Tudo em dia"', () => {
    expect(pessoas(NET_ZERO).some((l) => l.kind === 'settled')).toBe(false)
    expect(pessoas(NET_ZERO).map((l) => l.kind)).toEqual([
      'composition',
      'open',
    ])
  })

  it('o estado bilateral da row concorda com o resumo', () => {
    /* A mesma verdade nas duas superfícies: há o que acertar. */
    const status = personRowStatus({
      receivablePending: 200,
      debtPending: 200,
      periodReceivableTotal: 200,
      periodDebtTotal: 200,
      netBalance: 0,
      settledReceivablesCount: 0,
      settledDebtsCount: 0,
    })

    expect(status).toBe('toSettle')
    expect(PERSON_ROW_LABEL[status]).toBe('A ACERTAR')
  })
})

describe('P8-P9: resolvido e vazio', () => {
  it('P8: tudo quitado troca "Em aberto" por "Tudo em dia"', () => {
    const r = pessoas({ toReceive: 1000, toPay: 300, outstanding: 0 })

    expect(r.map((l) => l.kind)).toEqual(['composition', 'settled'])
    expect(linha(r, 'settled')).toBe('Tudo em dia')
    /* A composição histórica SOBREVIVE — o saldo não fica sem origem. */
    expect(linha(r, 'composition')).toBe(
      'R$ 1.000,00 a receber · R$ 300,00 a pagar',
    )
  })

  it('P9: mês sem atividade não diz "Tudo em dia"', () => {
    const r = pessoas({ comMovimento: 0 })

    expect(r.map((l) => l.kind)).toEqual(['empty'])
    expect(r.some((l) => l.kind === 'settled')).toBe(false)
  })

  it('mês vazio não emite "Em aberto: R$ 0 · R$ 0"', () => {
    expect(pessoas({ comMovimento: 0 }).some((l) => l.kind === 'open')).toBe(
      false,
    )
  })

  it('mês passado com pendência mantém composição e NÃO conclui', () => {
    const r = pessoas({
      toReceive: 900,
      toPay: 100,
      openToReceive: 0,
      openToPay: 100,
      outstanding: 1,
    })

    expect(r.map((l) => l.kind)).toEqual(['composition', 'open'])
  })

  it('a pendência é medida por CONTAGEM, não por soma', () => {
    /*
      `outstanding` é quantas pessoas têm algo aberto. Um total somado daria
      zero no caso net-zero e liberaria "Tudo em dia" indevidamente.
    */
    const r = pessoas({
      toReceive: 200,
      toPay: 200,
      openToReceive: 200,
      openToPay: 200,
      outstanding: 1,
    })

    expect(r.some((l) => l.kind === 'settled')).toBe(false)
  })
})

describe('P10: as ROWS não mudaram de contrato', () => {
  /*
    A divergência entre resumo e row é INTENCIONAL:

      resumo      "quanto aconteceu no mês, e quanto ainda está aberto?"
      row ACTIVE  "quanto ainda falta acertar com esta pessoa?"
  */
  const bal = (o: Record<string, number>) => ({
    receivablePending: 0,
    debtPending: 0,
    periodReceivableTotal: 0,
    periodDebtTotal: 0,
    netBalance: 0,
    settledReceivablesCount: 0,
    settledDebtsCount: 0,
    ...o,
  })

  it('ACTIVE continua derivando do outstanding', () => {
    expect(
      personRowStatus(bal({ receivablePending: 300, periodReceivableTotal: 900 })),
    ).toBe('receivable')
    expect(
      personRowStatus(bal({ debtPending: 300, periodDebtTotal: 900 })),
    ).toBe('debt')
  })

  it('SETTLED continua dizendo SALDO FINAL', () => {
    const status = personRowStatus(bal({ periodReceivableTotal: 900 }))

    expect(status).toBe('finalBalance')
    expect(PERSON_ROW_LABEL[status]).toBe('SALDO FINAL')
  })

  it('EMPTY continua dizendo SEM SALDO', () => {
    const status = personRowStatus(bal({}))

    expect(status).toBe('empty')
    expect(PERSON_ROW_LABEL[status]).toBe('SEM SALDO')
  })
})

describe('cores do resumo de Pessoas', () => {
  const PAGE = semComentarios(ler('../app/(dashboard)/persons/page.tsx'))

  it('só a conclusão ganha cor', () => {
    expect(PAGE).toContain("linha.kind === 'settled'")
    expect(PAGE).toContain('font-medium text-paid')
    expect(PAGE).toContain('text-muted-foreground')
  })

  it('nada de verde para receber nem vermelho para pagar', () => {
    /*
      Verde significa RESOLVIDO no produto. Usá-lo para "a receber" fazia
      dinheiro que talvez entre parecer dinheiro que entrou.
    */
    const resumo = PAGE.slice(
      PAGE.indexOf('personsSummaryLines(summary)'),
      PAGE.indexOf('personsSummaryLines(summary)') + 900,
    )

    expect(resumo).not.toContain('text-receivable')
    expect(resumo).not.toContain('text-destructive')
  })
})

// ─── Bancos ──────────────────────────────────────────────────────────────

const inv = (
  id: string,
  amount: number,
  status: InvoiceStatus = InvoiceStatus.OPEN,
  thirdParty = 0,
) => ({
  /* Só `status` importa para a agregação; o resto do shape não é lido. */
  invoice: { id, status } as unknown as { id: string; status: InvoiceStatus },
  amount,
  own: amount - thirdParty,
  thirdParty,
})

const resumoBanco = (linhas: ReturnType<typeof inv>[]) => {
  const total = linhas.reduce((a, l) => a + l.amount, 0)
  return {
    total,
    invoiceCount: linhas.length,
    openCount: 0,
    closedCount: 0,
    overdueCount: 0,
    paidCount: linhas.filter((l) => l.invoice.status === InvoiceStatus.PAID)
      .length,
    unpaid: linhas
      .filter((l) => l.invoice.status !== InvoiceStatus.PAID)
      .reduce((a, l) => a + l.amount, 0),
    own: linhas.reduce((a, l) => a + l.own, 0),
    thirdParty: linhas.reduce((a, l) => a + l.thirdParty, 0),
  }
}

describe('B1-B9: o progresso de Bancos', () => {
  it('B1: nada pago não renderiza linha de progresso', () => {
    /*
      O pendente É o total exibido logo acima; repeti-lo não acrescenta fato.
    */
    const linhas = bankMonthSummaryLines(resumoBanco([inv('b1', 1463.49)]))

    expect(linhas.some((l) => l.kind === 'cycle')).toBe(false)
  })

  it('B1: e não inventa "R$ 0,00 pago"', () => {
    const linhas = bankMonthSummaryLines(resumoBanco([inv('b1', 1000)]))

    expect(JSON.stringify(linhas)).not.toContain('"paid":0')
  })

  it('B2/B3/B4: parcial informa pago E restante', () => {
    const linhas = bankMonthSummaryLines(
      resumoBanco([
        inv('b1', 300, InvoiceStatus.PAID),
        inv('b2', 1163.49),
      ]),
    )
    const progresso = linhas.find((l) => l.kind === 'cycle')

    expect(progresso).toMatchObject({ paid: 300, remaining: 1163.49 })
  })

  it('B5: pago + restante reconcilia com o total, sempre', () => {
    /*
      Estrutural, não coincidência: os dois saem da mesma soma, separados por
      `InvoiceStatus.PAID`.
    */
    const casos = [
      [inv('a', 300, InvoiceStatus.PAID), inv('b', 1163.49)],
      [inv('a', 0.01, InvoiceStatus.PAID), inv('b', 0.02)],
      [
        inv('a', 800, InvoiceStatus.PAID),
        inv('b', 1200),
        inv('c', 45.67, InvoiceStatus.PAID),
      ],
    ]

    for (const linhasInv of casos) {
      const resumo = resumoBanco(linhasInv)
      const progresso = bankMonthSummaryLines(resumo).find(
        (l) => l.kind === 'cycle',
      )

      expect(progresso, JSON.stringify(resumo)).toBeDefined()
      if (progresso?.kind === 'cycle') {
        expect(progresso.paid + progresso.remaining).toBeCloseTo(
          resumo.total,
          2,
        )
      }
    }
  })

  it('B6: tudo pago usa "Tudo em dia"', () => {
    const linhas = bankMonthSummaryLines(
      resumoBanco([inv('b1', 1463.49, InvoiceStatus.PAID)]),
    )

    expect(linhas.map((l) => l.kind)).toEqual(['settled'])
    expect(linhas.some((l) => l.kind === 'cycle')).toBe(false)
  })

  it('B7: mês sem fatura não diz "Tudo em dia"', () => {
    const linhas = bankMonthSummaryLines(resumoBanco([]))

    expect(linhas.map((l) => l.kind)).toEqual(['empty'])
    expect(JSON.stringify(linhas)).not.toContain('Tudo em dia')
  })

  it('B8/B9: os rótulos de ciclo continuam ausentes', () => {
    /*
      Comentários fora — inclusive os de JSX, que o helper genérico não
      alcança. Os nomes aparecem no comentário que EXPLICA a remoção, e
      barrá-los ali impediria de registrar por que saíram.
    */
    const PAGE = semComentarios(
      ler('../app/(dashboard)/banks/page.tsx'),
    ).replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')

    expect(PAGE).not.toContain('Faturas atuais')
    expect(PAGE).not.toContain('Faturas futuras')
    expect(PAGE).not.toContain('Faturas passadas')
  })

  it('o mês passado usa a MESMA regra, sem copy própria', () => {
    const parcial = bankMonthSummaryLines(
      resumoBanco([inv('a', 300, InvoiceStatus.PAID), inv('b', 700)]),
      'past',
    )

    expect(parcial.find((l) => l.kind === 'cycle')).toMatchObject({
      paid: 300,
      remaining: 700,
      cycle: 'past',
    })
  })

  it('o mês futuro também — nenhuma regra especial por ciclo', () => {
    const nadaPago = bankMonthSummaryLines(
      resumoBanco([inv('a', 500)]),
      'future',
    )
    expect(nadaPago.some((l) => l.kind === 'cycle')).toBe(false)

    /* Futuro com fatura já paga segue o contrato normal. */
    const parcial = bankMonthSummaryLines(
      resumoBanco([inv('a', 200, InvoiceStatus.PAID), inv('b', 300)]),
      'future',
    )
    expect(parcial.find((l) => l.kind === 'cycle')).toMatchObject({
      paid: 200,
      remaining: 300,
    })
  })

  it('a autoridade é `InvoiceStatus.PAID`, não texto', () => {
    const FONTE = semComentarios(ler('./bank-invoice-selection.ts'))

    expect(FONTE).toContain('row.invoice.status !== InvoiceStatus.PAID')
  })

  it('a página pinta só o pago de verde', () => {
    const PAGE = semComentarios(ler('../app/(dashboard)/banks/page.tsx'))
    const inicio = PAGE.indexOf('linha.paid')
    const bloco = PAGE.slice(inicio - 120, inicio + 260)

    /* O pago é a parte concluída. */
    expect(bloco).toContain('text-paid')
    expect(bloco).toContain('formatCurrency(linha.paid)')
    /*
      O restante fica neutro: pendência é o estado normal de um mês em curso,
      e pintar os dois faria a linha inteira parecer conclusão.
    */
    const doRestante = bloco.slice(bloco.indexOf('linha.remaining') - 90)
    expect(doRestante).not.toContain('text-paid')
  })
})

describe('Parte C: o princípio é comum, a gramática não', () => {
  it('cada domínio mantém a própria forma de progresso', () => {
    const banco = bankMonthSummaryLines(
      resumoBanco([inv('a', 300, InvoiceStatus.PAID), inv('b', 700)]),
    ).find((l) => l.kind === 'cycle')

    const pessoa = linha(
      pessoas({
        toReceive: 1000,
        toPay: 300,
        openToReceive: 700,
        openToPay: 300,
        outstanding: 2,
      }),
      'open',
    )

    /* Bancos: unidirecional, com pago e restante. */
    expect(banco).toMatchObject({ paid: 300, remaining: 700 })
    /* Pessoas: bilateral, sem líquido. */
    expect(pessoa).toContain('a receber')
    expect(pessoa).toContain('a pagar')
  })

  it('não existe um mega-helper unificando os dois', () => {
    /*
      Forçar Pessoas na gramática de Bancos exigiria um líquido — e o líquido
      é justamente o que mente no caso bilateral.
    */
    const PESSOAS = semComentarios(ler('./persons-summary-text.ts'))
    const BANCOS = semComentarios(ler('./bank-month-summary-lines.ts'))

    expect(PESSOAS).not.toContain('para quitar')
    expect(BANCOS).not.toContain('Em aberto:')
  })
})
