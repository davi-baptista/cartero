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
      { kind: 'count', text: '1 fatura em aberto', cycle: 'current' },
    ])
  })

  it('S2: várias faturas, nada pago → contagem no plural', () => {
    const linhas = bankMonthSummaryLines(
      resumo([inv('b1', 500), inv('b2', 300)]),
    )
    expect(linhas).toEqual([
      { kind: 'count', text: '2 faturas em aberto', cycle: 'current' },
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
    expect(linhas).toHaveLength(1)
    expect(linhas[0].kind).toBe('composition')
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
      { kind: 'remaining', amount: 1200, cycle: 'current' },
    ])
  })

  it('S5: terceiros e parte paga → duas linhas, fatos diferentes', () => {
    const linhas = bankMonthSummaryLines(
      resumo([
        inv('b1', 800, InvoiceStatus.PAID),
        inv('b2', 1200, InvoiceStatus.OPEN, 240),
      ]),
    )
    expect(linhas.map((l) => l.kind)).toEqual(['composition', 'remaining'])
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
    expect(code).toContain('bankTrailingState(invoice)')
    expect(code).toContain('BANK_TRAILING_LABEL[trailingState]')
    expect(code).toContain('BANK_TRAILING_TONE[trailingState]')
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
    expect(linhas[0]).toMatchObject({ kind: 'remaining', cycle: 'current' })
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
    expect(linhas[0]).toMatchObject({ kind: 'count', cycle: 'future' })
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
    expect(code).toContain('BANK_TRAILING_TONE.paid')
    expect(code).toContain('invoice.status === InvoiceStatus.PAID')
  })

  it('as outras faturas continuam com a cor da urgência', () => {
    /* O verde é exceção para o resolvido, não substituto da régua de prazo. */
    expect(code).toContain('invoiceTimingClass(invoice)')
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
