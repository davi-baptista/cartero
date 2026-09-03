import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  hasPeriodActivity,
  PERSON_ROW_LABEL,
  PERSON_ROW_TONE,
  isResolvedStatus,
  periodNetAmount,
  personRowStatus,
  rowSubtext,
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
    periodReceivableTotal: 0,
    periodDebtTotal: 0,
    settledReceivablesCount: 0,
    settledDebtsCount: 0,
    nextItem: null,
    ...p,
  }
}

describe('P-1: o valor histórico sobrevive ao settlement', () => {
  it('mês inteiramente recebido conserva o valor', () => {
    /*
      O caso exato do bug. `netBalance: 0` porque nada resta; o valor exibido
      vem do período, não do saldo.
    */
    const b = bal({
      periodReceivableTotal: 350,
      settledReceivablesCount: 1,
      netBalance: 0,
    })

    expect(periodNetAmount(b)).toBe(350)
    expect(personRowStatus(b)).toBe('received')
    expect(PERSON_ROW_LABEL.received).toBe('RECEBIDO')
  })

  it('mês inteiramente pago conserva o valor, com sinal negativo', () => {
    const b = bal({
      periodDebtTotal: 120,
      settledDebtsCount: 1,
      netBalance: 0,
    })

    expect(periodNetAmount(b)).toBe(-120)
    expect(personRowStatus(b)).toBe('paid')
    expect(PERSON_ROW_LABEL.paid).toBe('PAGO')
  })

  it('a convenção de sinal não mudou', () => {
    /*
      Positivo = te devem. Passou a ser calculado sobre o histórico, mas o
      significado da direção é o mesmo de antes.
    */
    expect(periodNetAmount(bal({ periodReceivableTotal: 100 }))).toBeGreaterThan(0)
    expect(periodNetAmount(bal({ periodDebtTotal: 100 }))).toBeLessThan(0)
  })
})

describe('P-2: pendência continua falando do que RESTA', () => {
  it('em aberto mostra a direção do saldo, não do histórico', () => {
    /*
      R$ 500 recebidos e R$ 200 ainda a receber: o histórico é +700, mas o que
      exige ação são os 200 — e o status é sobre ação.
    */
    const b = bal({
      periodReceivableTotal: 700,
      settledReceivablesCount: 1,
      netBalance: 200,
    })

    expect(personRowStatus(b)).toBe('receivable')
    expect(periodNetAmount(b)).toBe(700)
  })

  it('dívida em aberto', () => {
    expect(personRowStatus(bal({ periodDebtTotal: 300, netBalance: -300 }))).toBe(
      'debt',
    )
  })

  it('histórico positivo com saldo devedor não vira RECEBIDO', () => {
    /*
      Recebeu R$ 900 e ainda deve R$ 100: o status precisa dizer VOCÊ DEVE. Se
      olhasse o histórico, diria "recebido" com uma dívida aberta na mesa.
    */
    const b = bal({
      periodReceivableTotal: 900,
      periodDebtTotal: 100,
      settledReceivablesCount: 1,
      netBalance: -100,
    })

    expect(personRowStatus(b)).toBe('debt')
  })
})

describe('P-3: sem movimento nao e o mesmo que resolvido', () => {
  it('nada em nenhum sentido é SEM SALDO', () => {
    expect(personRowStatus(bal())).toBe('empty')
    expect(hasPeriodActivity(bal())).toBe(false)
  })

  it('resolvido conta como movimento', () => {
    expect(hasPeriodActivity(bal({ settledDebtsCount: 1 }))).toBe(true)
  })

  it('a ordem das perguntas: resolvido não cai em empty', () => {
    /*
      Inverter as duas condições em `personRowStatus` reintroduz o bug —
      `netBalance: 0` casaria antes de "houve movimento?".
    */
    const b = bal({ periodReceivableTotal: 350, settledReceivablesCount: 1 })
    expect(personRowStatus(b)).not.toBe('empty')
  })

  it('valor zerado com contagem ainda é movimento', () => {
    /*
      Item de R$ 0 é raro mas legítimo; a contagem é a autoridade sobre "houve
      algo", não o valor.
    */
    expect(hasPeriodActivity(bal({ settledReceivablesCount: 1 }))).toBe(true)
  })
})

describe('P-4: misto resolvido segue o sinal do líquido', () => {
  it('recebeu mais do que pagou vira RECEBIDO', () => {
    const b = bal({
      periodReceivableTotal: 500,
      periodDebtTotal: 200,
      settledReceivablesCount: 1,
      settledDebtsCount: 1,
    })
    expect(personRowStatus(b)).toBe('received')
    expect(periodNetAmount(b)).toBe(300)
  })

  it('pagou mais do que recebeu vira PAGO', () => {
    const b = bal({
      periodReceivableTotal: 200,
      periodDebtTotal: 500,
      settledReceivablesCount: 1,
      settledDebtsCount: 1,
    })
    expect(personRowStatus(b)).toBe('paid')
  })

  it('líquido zero com movimento nos dois lados não trava', () => {
    /*
      R$ 200 de cada lado, tudo quitado: o valor é R$ 0,00 e a lista precisa de
      UMA palavra. Convenção documentada: `received`.
    */
    const b = bal({
      periodReceivableTotal: 200,
      periodDebtTotal: 200,
      settledReceivablesCount: 1,
      settledDebtsCount: 1,
    })
    expect(personRowStatus(b)).toBe('received')
  })
})

describe('P-5: resolvido não repete o estado no subtexto', () => {
  it('D1/D2: resolvido não tem subtexto', () => {
    /*
      A versão anterior devolvia "Recebido" aqui para ocupar o lugar do prazo.
      Mas o trailing já diz RECEBIDO, e a row passou a exibir o mesmo estado
      duas vezes — sem acrescentar nada.
    */
    expect(rowSubtext('received', 'Receber em 12d')).toBeNull()
    expect(rowSubtext('paid', 'Pagar em 3d')).toBeNull()
  })

  it('D3: pendente mantém o subtexto de prazo', () => {
    /* O contrapeso: omitir sempre esconderia a urgência de quem tem pendência. */
    expect(rowSubtext('receivable', 'Receber em 12d')).toBe('Receber em 12d')
    expect(rowSubtext('debt', 'Pagar atrasado 6d')).toBe('Pagar atrasado 6d')
  })

  it('D4: sem evento não inventa subtexto', () => {
    expect(rowSubtext('empty', null)).toBeNull()
    expect(rowSubtext('receivable', null)).toBeNull()
  })

  it('nenhuma palavra de conclusão sobrou no subtexto', () => {
    /*
      Vigia a duplicação de forma independente do nome da função: se alguém
      voltar a devolver "Recebido"/"Pago" por aqui, isto falha.
    */
    for (const st of ['received', 'paid'] as const) {
      /*
        O prazo de entrada CONTÉM as palavras, para provar que a omissão é do
        estado resolvido e não coincidência do texto passado.
      */
      expect(rowSubtext(st, 'Recebido em 28/08')).toBeNull()
      expect(rowSubtext(st, 'Pago em 15/07')).toBeNull()
    }
  })

  it('a policy de "resolvido" é uma só', () => {
    expect(isResolvedStatus('received')).toBe(true)
    expect(isResolvedStatus('paid')).toBe(true)
    expect(isResolvedStatus('receivable')).toBe(false)
    expect(isResolvedStatus('debt')).toBe(false)
    expect(isResolvedStatus('empty')).toBe(false)
  })
})

describe('P-6: cor comunica ESTADO, nunca direção', () => {
  it('C3/C4: pendências ficam muted', () => {
    /*
      `A RECEBER` era verde e `VOCÊ DEVE` vermelho. O verde colidia com o verde
      de "resolvido": um recebível em aberto e um já recebido saíam quase
      idênticos, apesar de pedirem ações opostas.

      A direção continua escrita no texto e no sinal do valor.
    */
    expect(PERSON_ROW_TONE.receivable).toBe('text-muted-foreground')
    expect(PERSON_ROW_TONE.debt).toBe('text-muted-foreground')
  })

  it('C1/C2: nenhum tom direcional sobrou nos abertos', () => {
    for (const st of ['receivable', 'debt'] as const) {
      expect(PERSON_ROW_TONE[st]).not.toContain('text-receivable')
      expect(PERSON_ROW_TONE[st]).not.toContain('text-destructive')
    }
  })

  it('C5/C6: resolvido usa o verde canônico de success', () => {
    /*
      `text-paid` — o mesmo de `PAGA` em Bancos e de "Tudo em dia". Não um
      segundo verde.
    */
    expect(PERSON_ROW_TONE.received).toBe('text-paid')
    expect(PERSON_ROW_TONE.paid).toBe('text-paid')
  })

  it('só os estados resolvidos têm cor', () => {
    /*
      A invariante da fase, e a que Bancos já aplica: se um estado estrutural
      ganhar cor, a hierarquia se desfaz.
    */
    for (const st of ['receivable', 'debt', 'empty'] as const) {
      expect(PERSON_ROW_TONE[st]).toBe('text-muted-foreground')
    }
  })

  it('todo status tem rótulo e tom', () => {
    /* Sem isso um status novo renderizaria `undefined` na tela. */
    for (const s of ['receivable', 'debt', 'received', 'paid', 'empty'] as const) {
      expect(PERSON_ROW_LABEL[s]).toBeTruthy()
      expect(PERSON_ROW_TONE[s]).toBeTruthy()
    }
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
    const b = bal({
      periodReceivableTotal: 100,
      settledReceivablesCount: 1,
      netBalance: residuo,
    })
    expect(personRowStatus(b)).toBe('received')
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

  it('a row exibe o líquido do período, não o saldo aberto', () => {
    expect(code).toContain('periodNetAmount(balance)')
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
    expect(code).toContain('ROW_AMOUNT_TONE.neutral')
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
    expect(code).toContain('subtextTone(balance.nextItem)')
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
