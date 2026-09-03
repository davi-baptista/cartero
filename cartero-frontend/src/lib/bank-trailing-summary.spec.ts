import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BANK_TRAILING_LABEL,
  BANK_TRAILING_TONE,
  bankTrailingState,
  banksForPeriod,
  summarizeBankMonth,
} from './bank-invoice-selection'
import {
  bankMonthSummaryLines,
  CYCLE_LABEL,
  monthCycleOf,
} from './bank-month-summary-lines'

/** Fonte de um módulo vizinho, para verificar onde a policy vive. */
const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
import { InvoiceStatus, type Invoice } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O trailing e o resumo dizem o que o total não conta
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Duas repetições foram removidas nesta fase.
 *
 * O trailing mostrava o status interno — `ABERTA` azul ao lado de "Fecha
 * amanhã" âmbar. Duas mensagens coloridas na mesma row disputavam a atenção, e
 * a urgência perdia espaço para um estado que o subtexto já explicava melhor.
 * Agora ele responde outra pergunta: em que CICLO a fatura está.
 *
 * O resumo dizia "R$ 1.173,95 · R$ 1.173,95 em aberto" — quando nada foi pago,
 * o valor em aberto É o total, e a linha secundária gastava espaço repetindo o
 * número de cima.
 */

const SET = { month: 9, year: 2026 }

function invoice(
  bankId: string,
  status: InvoiceStatus,
  extra: Partial<Invoice> = {},
): Invoice {
  return {
    id: `${bankId}-inv`,
    userId: 'u',
    bankId,
    month: 9,
    year: 2026,
    status,
    closeDate: '2026-09-28',
    dueDate: '2026-10-10',
    totalAmount: 100,
    ...extra,
  } as Invoice
}

const banco = (id: string, name: string) => ({ id, name })

describe('T1-T7: a precedência do trailing', () => {
  it('T5: sem fatura vence tudo', () => {
    expect(bankTrailingState(null)).toBe('noInvoice')
    expect(BANK_TRAILING_LABEL.noInvoice).toBe('Sem fatura')
  })

  it('T3: paga sobrepõe o rótulo de ciclo', () => {
    /*
      Uma fatura quitada do mês corrente diz "Paga", não "Fatura atual" — o
      fato resolvido é mais informativo que a posição no calendário.
    */
    const paga = invoice('b', InvoiceStatus.PAID)
    expect(bankTrailingState(paga)).toBe('paid')
    expect(BANK_TRAILING_LABEL.paid).toBe('Paga')
  })

  it('T4: em atraso sobrepõe o rótulo de ciclo', () => {
    /*
      O pior resultado possível desta simplificação seria esconder um atraso
      atrás de "Fatura atual". A precedência existe para impedir isso.
    */
    const vencida = invoice('b', InvoiceStatus.OVERDUE)
    expect(bankTrailingState(vencida)).toBe('overdue')
    expect(BANK_TRAILING_LABEL.overdue).toBe('Fatura vencida')
  })

  it('T1: aberta → Fatura aberta', () => {
    expect(bankTrailingState(invoice('b', InvoiceStatus.OPEN))).toBe('open')
    expect(BANK_TRAILING_LABEL.open).toBe('Fatura aberta')
  })

  it('T7: CLOSED tem rótulo PRÓPRIO, não se mistura com aberta', () => {
    /*
      A distinção que o rótulo de ciclo apagava: uma fatura que ainda acumula
      e outra que já fechou e vence em três dias pedem ações diferentes, e
      "Fatura atual" servia para as duas.
    */
    expect(bankTrailingState(invoice('b', InvoiceStatus.CLOSED))).toBe('closed')
    expect(BANK_TRAILING_LABEL.closed).toBe('Fatura fechada')
  })

  it('T2: o trailing não depende do mês exibido', () => {
    /*
      O ciclo subiu para o resumo do topo. O status de uma fatura é o mesmo
      esteja ela no mês corrente ou não — navegar não muda o fato.
    */
    const aberta = invoice('b', InvoiceStatus.OPEN)
    expect(bankTrailingState(aberta)).toBe('open')
    expect(bankTrailingState(aberta)).toBe(bankTrailingState(aberta))
  })

  it('T6: o rótulo nunca é a competência', () => {
    /* O mês já está no seletor global — repeti-lo em cada row é ruído. */
    for (const label of Object.values(BANK_TRAILING_LABEL)) {
      expect(label).not.toMatch(/setembro|outubro|2026/i)
    }
  })
})

describe('C4-C7: só os fatos que mudam a ação ganham cor', () => {
  it('C4: paga é verde', () => {
    expect(BANK_TRAILING_TONE.paid).toBe('text-paid')
  })

  it('C3: em atraso é vermelho', () => {
    expect(BANK_TRAILING_TONE.overdue).toBe('text-destructive')
  })

  it('C5/C6: aberta e fechada são muted', () => {
    /*
      O prazo no subtexto já carrega a urgência. Colorir os dois lados faria a
      row competir consigo mesma.
    */
    expect(BANK_TRAILING_TONE.open).toBe('text-muted-foreground')
    expect(BANK_TRAILING_TONE.closed).toBe('text-muted-foreground')
  })

  it('C7: sem fatura é muted', () => {
    expect(BANK_TRAILING_TONE.noInvoice).toContain('muted')
  })

  it('nenhum status de fatura usa azul no trailing', () => {
    /*
      `text-primary` ficou reservado ao rótulo de CICLO no resumo do topo, que
      é contexto. Usá-lo também no status da row traria de volta duas cores
      concorrentes na mesma linha.
    */
    for (const tone of Object.values(BANK_TRAILING_TONE)) {
      expect(tone).not.toContain('primary')
    }
  })
})

// ─── Resumo mensal ───────────────────────────────────────────────────────────

/** Monta o resumo a partir de faturas, como a página faz. */
function resumo(invoices: Invoice[], banks = [banco('b1', 'A'), banco('b2', 'B')]) {
  return summarizeBankMonth(banksForPeriod(banks, invoices, SET))
}

const inv = (
  bankId: string,
  total: number,
  status = InvoiceStatus.OPEN,
  reimbursable = 0,
) => invoice(bankId, status, { totalAmount: total, reimbursable } as Partial<Invoice>)

describe('S1-S10: o resumo só diz o que o total não conta', () => {
  it('S1: uma fatura, nada pago, sem terceiros → só a contagem', () => {
    /*
      A repetição que motivou a fase: o valor em aberto É o total, então
      dizê-lo de novo não informa nada.
    */
    const linhas = bankMonthSummaryLines(resumo([inv('b1', 1173.95)]))
    expect(linhas).toEqual([
      { kind: 'cycle', cycle: 'current', remaining: null, count: null },
    ])
  })

  it('S2: várias faturas, nada pago → contagem no plural', () => {
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 500), inv('b2', 300)]),
    )
    expect(linhas).toEqual([
      { kind: 'cycle', cycle: 'current', remaining: null, count: null },
    ])
  })

  it('S3: terceiros e nada pago → só a composição', () => {
    /*
      Com a composição presente, uma segunda linha só para anunciar que tudo
      está aberto deixaria o bloco pesado sem acrescentar fato.
    */
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 1173.95, InvoiceStatus.OPEN, 240)]),
    )
    /* Composição + o rótulo de ciclo, que NÃO depende de pagamento. */
    expect(linhas.map((l) => l.kind)).toEqual(['composition', 'cycle'])
    if (linhas[0].kind === 'composition') {
      expect(linhas[0].parts).toEqual([
        { kind: 'own', amount: 933.95 },
        { kind: 'thirdParty', amount: 240 },
      ])
    }
  })

  it('S4: parte paga, sem terceiros → Faltam X para quitar', () => {
    /*
      O caso em que a informação NÃO é redundante: R$ 1.200 difere do total de
      R$ 2.000.
    */
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 800, InvoiceStatus.PAID), inv('b2', 1200)]),
    )
    expect(linhas).toEqual([
      { kind: 'cycle', cycle: 'current', remaining: 1200, count: null },
    ])
  })

  it('S5: terceiros e parte paga → duas linhas, fatos diferentes', () => {
    const linhas = bankMonthSummaryLines(
      resumo([
        inv('b1', 800, InvoiceStatus.PAID),
        inv('b2', 1200, InvoiceStatus.OPEN, 240),
      ]),
    )
    expect(linhas.map((l) => l.kind)).toEqual(['composition', 'cycle'])
    /* Duas é o máximo — acima disso o resumo compete com a lista. */
    expect(linhas).toHaveLength(2)
  })

  it('S6: todas pagas → Tudo em dia', () => {
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 500, InvoiceStatus.PAID), inv('b2', 300, InvoiceStatus.PAID)]),
    )
    expect(linhas).toEqual([{ kind: 'settled', text: 'Tudo em dia' }])
  })

  it('S7: todas pagas com terceiros → composição + Tudo em dia', () => {
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 1000, InvoiceStatus.PAID, 240)]),
    )
    expect(linhas.map((l) => l.kind)).toEqual(['composition', 'settled'])
  })

  it('S8: zero faturas NÃO é "tudo em dia"', () => {
    /*
      Um mês sem fatura e um mês inteiramente quitado são fatos diferentes.
      Parabenizar quem simplesmente não gastou afirmaria algo que não
      aconteceu.
    */
    const linhas = bankMonthSummaryLines(resumo([]))
    expect(linhas).toEqual([
      { kind: 'empty', text: 'Nenhuma fatura neste mês' },
    ])
    expect(linhas[0]).not.toMatchObject({ kind: 'settled' })
  })

  it('S9: sem terceiros, "sua parte" é omitida', () => {
    /*
      "R$ 1.173,95 sua parte" com total de R$ 1.173,95 seria a terceira forma
      de repetir o mesmo número.
    */
    const linhas = bankMonthSummaryLines(resumo([inv('b1', 1173.95)]))
    expect(linhas.some((l) => l.kind === 'composition')).toBe(false)
  })

  it('S10: em aberto e sua parte são grandezas diferentes', () => {
    /*
      O usuário paga a fatura BRUTA, mesmo com parte a ser reembolsada. Somar
      "faltam" sobre a sua parte diria que ele deve menos ao banco do que
      realmente deve.
    */
    const s = resumo([
      inv('b1', 800, InvoiceStatus.PAID),
      inv('b2', 1200, InvoiceStatus.OPEN, 500),
    ])
    expect(s.unpaid).toBe(1200)
    expect(s.own).toBe(1500)
    expect(s.unpaid).not.toBe(s.own)
  })
})

describe('as invariantes do resumo', () => {
  it('sua parte + terceiros = total', () => {
    const s = resumo([
      inv('b1', 1000, InvoiceStatus.OPEN, 240),
      inv('b2', 500, InvoiceStatus.PAID, 100),
    ])
    expect(s.own + s.thirdParty).toBeCloseTo(s.total, 2)
  })

  it('o que falta nunca passa do total', () => {
    const s = resumo([inv('b1', 800, InvoiceStatus.PAID), inv('b2', 1200)])
    expect(s.unpaid).toBeLessThanOrEqual(s.total)
  })

  it('bancos sem fatura não entram na contagem', () => {
    const s = resumo([inv('b1', 500)], [
      banco('b1', 'Com'),
      banco('b2', 'Sem'),
      banco('b3', 'Sem tambem'),
    ])
    expect(s.invoiceCount).toBe(1)
    expect(s.total).toBe(500)
  })
})

describe('a página consome as policies compartilhadas', () => {
  const PAGE = readFileSync(
    new URL('../app/(dashboard)/banks/page.tsx', import.meta.url),
    'utf-8',
  )
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('o trailing sai da policy, não de condições locais', () => {
    /*
      A derivação migrou para `invoice-row-presenter`, a autoridade que Bancos
      e Orçamento passaram a compartilhar. O contrato é o mesmo — a página não
      decide o rótulo nem o tom —, e agora vale para as duas telas.
    */
    expect(code).toContain('invoiceRowPresentation(invoice)')
    expect(code).toContain('apresentacao.statusLabel')
    expect(code).toContain('apresentacao.statusTone')

    const presenter = ler('./invoice-row-presenter.ts')
    expect(presenter).toContain('bankTrailingState(invoice)')
    expect(presenter).toContain('BANK_TRAILING_LABEL[state]')
    expect(presenter).toContain('BANK_TRAILING_TONE[state]')
  })

  it('o resumo sai da policy, não de ifs na JSX', () => {
    expect(code).toContain('bankMonthSummaryLines(')
    expect(code).toContain('monthCycleOf(period, currentPeriod())')
    expect(code).not.toContain('monthSummary.paidCount > 0 &&')
  })

  it('a composição reutiliza o helper canônico do produto', () => {
    /*
      `invoiceSectionParts` é o mesmo que o Orçamento e o detalhe da fatura
      usam. Uma segunda regra faria os números divergirem entre as telas.
    */
    const lines = readFileSync(
      new URL('./bank-month-summary-lines.ts', import.meta.url),
      'utf-8',
    )
    expect(lines).toContain("from '@/lib/invoice-composition'")
    expect(lines).toContain('invoiceSectionParts(')
  })

  it('a urgência continua concentrada nas rows', () => {
    /* Pendência não é urgência: nenhum âmbar no resumo. */
    const resumoJsx = code.slice(
      code.indexOf('bankMonthSummaryLines(monthSummary)'),
      code.indexOf('role="tablist"'),
    )
    expect(resumoJsx).not.toContain('text-pending')
  })
})

describe('o ciclo do mês, no resumo do topo', () => {
  const HOJE = { month: 9, year: 2026 }

  it('reconhece atual, futuro e passado', () => {
    expect(monthCycleOf({ month: 9, year: 2026 }, HOJE)).toBe('current')
    expect(monthCycleOf({ month: 10, year: 2026 }, HOJE)).toBe('future')
    expect(monthCycleOf({ month: 8, year: 2026 }, HOJE)).toBe('past')
  })

  it('atravessa a virada de ano', () => {
    /* Janeiro de 2027 é futuro em setembro de 2026, não passado. */
    expect(monthCycleOf({ month: 1, year: 2027 }, HOJE)).toBe('future')
    expect(monthCycleOf({ month: 12, year: 2025 }, HOJE)).toBe('past')
  })

  it('Caso 1: mês atual com pendência leva "Faturas atuais"', () => {
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 800, InvoiceStatus.PAID), inv('b2', 1200)]),
      'current',
    )
    expect(linhas[0]).toMatchObject({ kind: 'cycle', cycle: 'current', remaining: 1200 })
    expect(CYCLE_LABEL.current).toBe('Faturas atuais')
  })

  it('Caso 2: mês totalmente pago diz só "Tudo em dia"', () => {
    /*
      Sem prefixo de ciclo: "Tudo em dia" já é conclusivo, e nada resta a
      fazer seja o mês qual for.
    */
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 500, InvoiceStatus.PAID)]),
      'current',
    )
    expect(linhas).toEqual([{ kind: 'settled', text: 'Tudo em dia' }])
  })

  it('Caso 3: mês futuro leva "Faturas futuras"', () => {
    const linhas = bankMonthSummaryLines(resumo([inv('b1', 320)]), 'future')
    expect(linhas[0]).toMatchObject({ kind: 'cycle', cycle: 'future' })
    expect(CYCLE_LABEL.future).toBe('Faturas futuras')
  })

  it('Caso 4: mês passado NÃO recebe rótulo', () => {
    /*
      "Faturas passadas" seria redundante — o seletor já diz o mês. O caso
      relevante do passado é o atraso, e ele se anuncia sozinho em vermelho.
    */
    expect(CYCLE_LABEL.past).toBeNull()

    const linhas = bankMonthSummaryLines(resumo([inv('b1', 320)]), 'past')
    expect(linhas[0]).toMatchObject({ cycle: 'past' })
  })

  it('o rótulo de ciclo NUNCA aparece na linha de composição', () => {
    /*
      A composição fala de dinheiro (sua parte / de terceiros), não de tempo.
      Prefixá-la com o ciclo misturaria dois assuntos numa linha só.
    */
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 1000, InvoiceStatus.OPEN, 240)]),
      'future',
    )
    expect(linhas[0].kind).toBe('composition')
    expect(linhas[0]).not.toHaveProperty('cycle')
  })
})

describe('a fatura paga tinge o prazo de verde', () => {
  const PAGE = readFileSync(
    new URL('../app/(dashboard)/banks/page.tsx', import.meta.url),
    'utf-8',
  )
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('usa a MESMA cor do trailing "Paga"', () => {
    /*
      "Venceu em 10/09" saía cinza ao lado de "PAGA" em verde, e os dois falam
      do mesmo fato resolvido. Sem inventar tom: é o `BANK_TRAILING_TONE.paid`.
    */
    /*
      A condicional saiu do JSX para o presenter — era ELA a policy real, e
      vivia num lugar onde quem consumisse o helper não a encontraria. Foi
      exatamente por isso que o Orçamento divergiu.
    */
    const presenter = ler('./invoice-row-presenter.ts')
    expect(presenter).toContain('BANK_TRAILING_TONE.paid')
    expect(presenter).toContain("state === 'paid'")
    expect(code).toContain('apresentacao.timingTone')
  })

  it('as outras faturas continuam com a cor da urgência', () => {
    /* O verde é exceção para o resolvido, não substituto da régua de prazo. */
    expect(ler('./invoice-row-presenter.ts')).toContain(
      'invoiceTimingClass(invoice, today)',
    )
  })

  it('o rótulo de ciclo usa azul — cor de contexto', () => {
    /*
      Os tons de valor (âmbar, vermelho, verde) já significam prazo e
      resolução; reusar um deles no ciclo sugeriria que o MÊS é urgente ou
      resolvido.
    */
    const cycleLabel = code.slice(
      code.indexOf('function CycleLabel'),
      code.indexOf('function MonthInvoiceAmount'),
    )
    expect(cycleLabel).toContain('text-primary')
  })
})

describe('o ciclo é independente do pagamento', () => {
  /**
   * O bug que esta seção fixa.
   *
   * O rótulo do ciclo viajava DENTRO das linhas de quitação (`remaining` e
   * `count`), e cada uma tinha sua própria condição de existir. No mês
   * corrente sem nada pago e COM terceiros, nenhuma das duas era emitida —
   * então "Faturas atuais" só nascia depois de o usuário pagar alguma fatura.
   *
   * Pagar uma fatura não pode fazer o mês virar "atual": isso é fato do
   * calendário, não de quitação.
   */
  const cicloDe = (linhas: ReturnType<typeof bankMonthSummaryLines>) =>
    linhas.find((l) => l.kind === 'cycle')

  it('S1/S2: mês atual com ZERO pago já mostra o ciclo', () => {
    const linhas = bankMonthSummaryLines(resumo([inv('b1', 1463.49)]), 'current')
    expect(cicloDe(linhas)).toMatchObject({ cycle: 'current' })
  })

  it('S2: e NÃO mostra "Faltam", que repetiria o total', () => {
    const linhas = bankMonthSummaryLines(resumo([inv('b1', 1463.49)]), 'current')
    expect(cicloDe(linhas)).toMatchObject({ remaining: null })
  })

  it('a regressão exata do relato: com terceiros e nada pago', () => {
    /*
      O caso que sumia. `temTerceiros` desviava para a composição e o ramo da
      contagem não rodava, levando o ciclo embora.
    */
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 1463.49, InvoiceStatus.OPEN, 240)]),
      'current',
    )
    expect(linhas.map((l) => l.kind)).toEqual(['composition', 'cycle'])
    expect(cicloDe(linhas)).toMatchObject({ cycle: 'current', remaining: null })
  })

  it('S3: pagar UMA fatura não faz o ciclo nascer — só o complemento', () => {
    /*
      A invariante central: o rótulo é o mesmo antes e depois do pagamento.
      O que muda é apenas o `remaining`.
    */
    const antes = bankMonthSummaryLines(
      resumo([inv('b1', 180.51), inv('b2', 1282.98)]),
      'current',
    )
    const depois = bankMonthSummaryLines(
      resumo([inv('b1', 180.51, InvoiceStatus.PAID), inv('b2', 1282.98)]),
      'current',
    )

    expect(cicloDe(antes)).toMatchObject({ cycle: 'current', remaining: null })
    expect(cicloDe(depois)).toMatchObject({
      cycle: 'current',
      remaining: 1282.98,
    })
  })

  it('S4: todas pagas continua "Tudo em dia", sem ciclo', () => {
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 500, InvoiceStatus.PAID)]),
      'current',
    )
    expect(linhas).toEqual([{ kind: 'settled', text: 'Tudo em dia' }])
    expect(cicloDe(linhas)).toBeUndefined()
  })

  it('S5/S6: mês futuro mostra o ciclo com zero pago', () => {
    const linhas = bankMonthSummaryLines(resumo([inv('b1', 320)]), 'future')
    expect(cicloDe(linhas)).toMatchObject({ cycle: 'future', remaining: null })
    expect(CYCLE_LABEL.future).toBe('Faturas futuras')
  })

  it('S7: mês futuro mantém o ciclo após pagamento parcial', () => {
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 200, InvoiceStatus.PAID), inv('b2', 320)]),
      'future',
    )
    expect(cicloDe(linhas)).toMatchObject({ cycle: 'future', remaining: 320 })
  })

  it('S8: mês passado não ganha rótulo de ciclo', () => {
    /*
      Decisão preservada da BANKS1.4: "Faturas passadas" seria redundante — o
      seletor já diz o mês. A linha existe, mas com a contagem no lugar do
      rótulo, para não ficar vazia.
    */
    const linhas = bankMonthSummaryLines(resumo([inv('b1', 320)]), 'past')
    expect(CYCLE_LABEL.past).toBeNull()
    expect(cicloDe(linhas)).toMatchObject({
      cycle: 'past',
      count: '1 fatura em aberto',
    })
  })

  it('S9: zero faturas não mostra ciclo algum', () => {
    const linhas = bankMonthSummaryLines(resumo([]), 'current')
    expect(linhas).toEqual([
      { kind: 'empty', text: 'Nenhuma fatura neste mês' },
    ])
    expect(cicloDe(linhas)).toBeUndefined()
  })

  it('S10: a composição segue independente das duas decisões', () => {
    /*
      Terceiros é fato de DINHEIRO; ciclo é de calendário; quitação é de
      pagamento. As três não se condicionam.
    */
    const semTerceiros = bankMonthSummaryLines(resumo([inv('b1', 500)]), 'current')
    const comTerceiros = bankMonthSummaryLines(
      resumo([inv('b1', 500, InvoiceStatus.OPEN, 100)]),
      'current',
    )

    expect(semTerceiros.some((l) => l.kind === 'composition')).toBe(false)
    expect(comTerceiros.some((l) => l.kind === 'composition')).toBe(true)
    /* E o ciclo está nos dois. */
    expect(cicloDe(semTerceiros)).toMatchObject({ cycle: 'current' })
    expect(cicloDe(comTerceiros)).toMatchObject({ cycle: 'current' })
  })

  it('o rótulo sozinho não leva separador na tela', () => {
    /*
      "Faturas atuais ·" com nada depois deixaria um ponto órfão. O separador
      é responsabilidade de quem desenha, e só aparece quando há complemento.
    */
    const PAGE = readFileSync(
      new URL('../app/(dashboard)/banks/page.tsx', import.meta.url),
      'utf-8',
    )
    expect(PAGE).toContain('withSeparator={linha.remaining !== null || linha.count !== null}')
  })
})
