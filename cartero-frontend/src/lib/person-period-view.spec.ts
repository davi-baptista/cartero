import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  hasPeriodActivity,
  periodNetAmount,
  personRowStatus,
  subtextTone,
  type PeriodBalance,
} from './person-period-view'
import { personsSummaryLines } from './persons-summary-text'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Quitar muda o STATUS, não apaga o VALOR
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O bug: a row somava só o que estava em ABERTO. Recebido o último item de
 * julho, todas as linhas viravam "R$ 0,00 · SEM SALDO" — e a tela deixava de
 * responder "quem devia a quem em julho?".
 *
 * A separação copiada de Bancos: uma fatura paga conserva `totalAmount` e muda
 * o status para "Paga".
 */

function bal(p: Partial<PeriodBalance> = {}): PeriodBalance {
  return {
    netBalance: 0,
    receivablePending: 0,
    debtPending: 0,
    periodReceivableTotal: 0,
    periodDebtTotal: 0,
    settledReceivablesCount: 0,
    settledDebtsCount: 0,
    nextItem: null,
    settledAt: null,
    ...p,
  }
}

describe('P-1: o valor histórico continua disponível', () => {
  /*
    A conquista da fase anterior, preservada: o histórico da competência não se
    perde quando os itens são quitados.

    O que MUDOU é quando ele é exibido. A row agora tem dois modos — ACTIVE usa
    outstanding, SETTLED usa histórico —, e `person-balance-modes.spec.ts`
    cobre a policy completa. Aqui fica só a invariante do dado.
  */
  it('quitar não altera o histórico', () => {
    const aberta = bal({
      periodReceivableTotal: 350,
      receivablePending: 350,
      netBalance: 350,
    })
    const quitada = bal({
      periodReceivableTotal: 350,
      settledReceivablesCount: 1,
    })

    expect(periodNetAmount(aberta)).toBe(350)
    expect(periodNetAmount(quitada)).toBe(350)
  })

  it('a convenção de sinal não mudou', () => {
    /* Positivo = te devem. Vale para histórico e outstanding. */
    expect(periodNetAmount(bal({ periodReceivableTotal: 100 }))).toBeGreaterThan(0)
    expect(periodNetAmount(bal({ periodDebtTotal: 100 }))).toBeLessThan(0)
  })

  it('atividade histórica é reconhecida pelas contagens', () => {
    /*
      Item de R$ 0 é raro mas legítimo: a contagem é a autoridade sobre "houve
      algo", não o valor.
    */
    expect(hasPeriodActivity(bal({ settledReceivablesCount: 1 }))).toBe(true)
    expect(hasPeriodActivity(bal({ periodDebtTotal: 10 }))).toBe(true)
    expect(hasPeriodActivity(bal())).toBe(false)
  })
})

describe('P-6b: o tom do prazo segue a régua canônica', () => {
  const hoje = new Date(2026, 8, 3)
  const emDias = (d: number) => {
    const t = new Date(hoje)
    t.setDate(t.getDate() + d)
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    return { dueDate: iso, direction: 'receive' as const, amount: 100 }
  }

  it('C7: atraso é vermelho', () => {
    expect(subtextTone(emDias(-6))).toBe('text-destructive')
  })

  it('C8: hoje e prazo curto usam o âmbar de urgência', () => {
    /*
      `URGENT_DAYS_WINDOW = 7`, a MESMA janela de Bancos e da "Atenção agora" —
      não uma régua local. Antes só o atraso tinha cor, então "Receber amanhã" e
      "Receber em 18d" saíam no mesmo cinza.
    */
    expect(subtextTone(emDias(0))).toBe('text-pending')
    expect(subtextTone(emDias(1))).toBe('text-pending')
    expect(subtextTone(emDias(7))).toBe('text-pending')
  })

  it('C9: futuro distante é muted', () => {
    /* Pintar todo evento futuro encheria a lista de tons sem hierarquia. */
    expect(subtextTone(emDias(8))).toBe('')
    expect(subtextTone(emDias(18))).toBe('')
  })

  it('sem evento não há tom', () => {
    expect(subtextTone(null)).toBe('')
  })
})

describe('P-7: centavos não viram estado falso', () => {
  it('resíduo de ponto flutuante é tratado como zero', () => {
    /*
      0.1 + 0.2 - 0.3 deixa cerca de 5.5e-17. Sem tolerância, uma pessoa
      quitada apareceria como devendo fração de centavo.
    */
    const residuo = 0.1 + 0.2 - 0.3

    /* Resíduo no PENDENTE não cria uma pendência inexistente. */
    expect(
      personRowStatus(
        bal({
          periodReceivableTotal: 100,
          settledReceivablesCount: 1,
          receivablePending: residuo,
        }),
      ),
    ).toBe('finalBalance')

    /* E resíduo no líquido de dois lados abertos não vira `A ACERTAR` falso. */
    expect(
      personRowStatus(
        bal({ receivablePending: 200 + residuo, debtPending: 200 }),
      ),
    ).toBe('toSettle')
  })
})

describe('P-8: o resumo responde composição E quitação', () => {
  const linhas = (o: Partial<Parameters<typeof personsSummaryLines>[0]>) =>
    personsSummaryLines({
      toReceive: 0,
      toPay: 0,
      outstanding: 0,
      comMovimento: 1,
      ...o,
    })

  it('S2/S3: mês resolvido mantém a composição E diz "Tudo em dia"', () => {
    /*
      O bug: com tudo resolvido a composição DESAPARECIA, e o mês exibia
      R$ 1.335,77 sem nunca dizer de onde veio. São duas perguntas
      independentes — "de onde veio?" e "ainda falta algo?".
    */
    const r = linhas({ toReceive: 1335.77, outstanding: 0 })

    expect(r.map((l) => l.kind)).toEqual(['composition', 'settled'])
    expect(r[0].text).toContain('a receber')
    expect(r[0].text).toContain('a pagar')
    expect(r[1].text).toBe('Tudo em dia')
  })

  it('S3: a copy antiga não sobreviveu', () => {
    /*
      "Tudo resolvido neste mês" e "Tudo em dia" nomeavam o mesmo fato no mesmo
      lugar da tela. Duas frases fariam procurar uma diferença inexistente.
    */
    for (const l of linhas({ toReceive: 100, outstanding: 0 })) {
      expect(l.text).not.toContain('Tudo resolvido')
    }
  })

  it('S1: mês com pendência mostra composição e NÃO diz "Tudo em dia"', () => {
    const r = linhas({ toReceive: 500, toPay: 200, outstanding: 300 })

    expect(r.map((l) => l.kind)).toEqual(['composition'])
  })

  it('S7: mês passado parcialmente aberto não é "Tudo em dia"', () => {
    /*
      Histórico completo mas ainda com pendência vencida: a composição fica, a
      conclusão não — seria falsa.
    */
    const r = linhas({ toReceive: 900, toPay: 100, outstanding: 100 })

    expect(r.some((l) => l.kind === 'settled')).toBe(false)
    expect(r.some((l) => l.kind === 'composition')).toBe(true)
  })

  it('S6: mês sem movimento não recebe "Tudo em dia"', () => {
    /*
      Nunca ter tido nada e ter quitado tudo são fatos diferentes. Elogiar um
      mês vazio afirmaria uma conclusão que não houve.
    */
    const r = linhas({ comMovimento: 0 })

    expect(r).toEqual([
      { kind: 'empty', text: 'Nenhuma movimentação neste mês' },
    ])
  })

  it('S8: os totais chegam íntegros à composição', () => {
    const [c] = linhas({ toReceive: 1070.36, toPay: 341, outstanding: 500 })

    expect(c.text).toContain('1.070,36')
    expect(c.text).toContain('341,00')
  })

  it('no máximo duas linhas', () => {
    /* Acima disso o resumo começa a competir com a lista. */
    expect(linhas({ toReceive: 100, outstanding: 0 }).length).toBeLessThanOrEqual(2)
    expect(linhas({ toReceive: 100, outstanding: 50 }).length).toBeLessThanOrEqual(2)
  })

  it('não existe linha de "Em aberto"', () => {
    /*
      A lista e os status das rows já comunicam pendência; uma terceira linha
      repetiria.
    */
    for (const l of linhas({ toReceive: 100, outstanding: 100 })) {
      expect(l.text).not.toMatch(/Em aberto/i)
    }
  })
})

describe('P-9: a page aplica a policy', () => {
  const PAGE = readFileSync(
    new URL('../app/(dashboard)/persons/page.tsx', import.meta.url),
    'utf-8',
  )
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('a row exibe o valor do MODO', () => {
    /*
      Era `periodNetAmount` incondicional — sempre o histórico. Agora
      `personRowAmount` escolhe: outstanding em ACTIVE, histórico em SETTLED.
    */
    expect(code).toContain('personRowAmount(balance)')
    expect(code).toContain('personRowStatus(balance)')
  })

  it('o rótulo e o tom vêm dos mapas', () => {
    expect(code).toContain('PERSON_ROW_LABEL[status]')
    expect(code).toContain('PERSON_ROW_TONE[status]')
  })

  it('C1/C2/C10: o valor não usa tom direcional', () => {
    /*
      O assert que impede o verde/vermelho de voltar ao amount — inclusive no
      histórico resolvido, onde o valor também é um fato neutro.
    */
    expect(code).not.toContain('ROW_AMOUNT_TONE.in')
    expect(code).not.toContain('ROW_AMOUNT_TONE.out')
    /*
      O tom passou a sair do MODO, não do valor: `Math.abs(net) <= 0.005`
      deixava ACTIVE e SETTLED com R$ 0,00 cinzas, iguais a EMPTY.
    */
    expect(code).toContain('ROW_AMOUNT_TONE[personAmountTone(status)]')
  })

  it('D1/D2: o subtexto resolvido é omitido, não substituído', () => {
    expect(code).toContain('rowSubtext(')
    expect(code).not.toContain('resolvedSubtext')
  })

  it('C7/C8/C9: o tom do prazo vem da régua canônica', () => {
    /*
      `subtextTone` delega a `timingUrgency`. Um `atrasado && 'text-destructive'`
      solto voltaria a cobrir só uma das pontas.
    */
    expect(code).toContain('rowSubtextTone(status, balance.nextItem)')
    expect(code).not.toContain("atrasado && 'text-destructive'")
  })

  it('S4: o valor do resumo é neutro', () => {
    const resumo = code.slice(code.indexOf('Saldo com pessoas'))
    const bloco = resumo.slice(0, resumo.indexOf('{/* List */}'))

    expect(bloco).not.toContain("summary.net > 0 && 'text-receivable'")
    expect(bloco).not.toContain("summary.net < 0 && 'text-destructive'")
  })

  it('S2/S5: o resumo sai das linhas, e só a conclusão tem cor', () => {
    expect(code).toContain('personsSummaryLines(summary)')
    expect(code).toContain("linha.kind === 'settled'")
    expect(code).toContain("'font-medium text-paid'")
    expect(code).toContain("'text-muted-foreground'")
  })

  it('o resumo do topo soma o período', () => {
    expect(code).toContain('b.periodReceivableTotal')
    expect(code).toContain('b.periodDebtTotal')
  })

  it('O11: a ordenação escolhe a policy pelo ciclo do mês', () => {
    /*
      Não é `sortPeopleByPriority` incondicional nem um `if` solto na page: a
      pergunta que a lista responde é decisão de produto, e vive no helper.
    */
    expect(code).toContain('sortPersonRowsForMonth(')
    /*
      O ciclo é resolvido dentro do helper: a página observa a competência
      global e não reresolve "hoje" por conta própria — resolver o mês corrente
      em dois lugares foi o que uma fase anterior desfez.
    */
    expect(code).toContain('personRowsCycle(period)')
    expect(code).not.toContain('currentPeriod()')
  })
})
