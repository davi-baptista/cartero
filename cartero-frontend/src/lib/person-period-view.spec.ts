import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  hasPeriodActivity,
  PERSON_ROW_LABEL,
  PERSON_ROW_TONE,
  periodNetAmount,
  personRowStatus,
  resolvedSubtext,
  type PeriodBalance,
} from './person-period-view'
import { personsSummaryText } from './persons-summary-text'

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

describe('P-5: o subtexto não afirma pendência inexistente', () => {
  it('resolvido substitui o próximo evento', () => {
    expect(resolvedSubtext('received')).toBe('Recebido')
    expect(resolvedSubtext('paid')).toBe('Pago')
  })

  it('pendente mantém o subtexto de prazo', () => {
    /*
      `null` é o sinal para a page usar `nextItemLabel` — a row pendente
      continua dizendo quando vence.
    */
    expect(resolvedSubtext('receivable')).toBeNull()
    expect(resolvedSubtext('debt')).toBeNull()
    expect(resolvedSubtext('empty')).toBeNull()
  })

  it('sem data no subtexto resolvido', () => {
    /*
      Vários itens podem ter sido resolvidos em dias diferentes; escolher um
      seria inventar. A data real está no drawer.
    */
    for (const s of ['received', 'paid'] as const) {
      expect(resolvedSubtext(s)).not.toMatch(/\d/)
    }
  })
})

describe('P-6: resolvido usa o verde de conclusão', () => {
  it('os dois estados resolvidos compartilham o tom', () => {
    expect(PERSON_ROW_TONE.received).toBe('text-paid')
    expect(PERSON_ROW_TONE.paid).toBe('text-paid')
  })

  it('pendente conserva a direção econômica', () => {
    expect(PERSON_ROW_TONE.receivable).toBe('text-receivable')
    expect(PERSON_ROW_TONE.debt).toBe('text-destructive')
  })

  it('todo status tem rótulo e tom', () => {
    /* Sem isso um status novo renderizaria `undefined` na tela. */
    for (const s of ['receivable', 'debt', 'received', 'paid', 'empty'] as const) {
      expect(PERSON_ROW_LABEL[s]).toBeTruthy()
      expect(PERSON_ROW_TONE[s]).toBeTruthy()
    }
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

describe('P-8: o resumo do topo preserva o mês', () => {
  it('mês resolvido não afirma ausência de valores', () => {
    /*
      Dizia "Sem valores em aberto neste mês" — verdadeiro sobre a pendência,
      mas lido como "nada aconteceu" ao lado de um total agora histórico.
    */
    const texto = personsSummaryText({
      toReceive: 350,
      toPay: 0,
      outstanding: 0,
      comMovimento: 1,
    })
    expect(texto).toBe('Tudo resolvido neste mês')
  })

  it('mês sem movimento é distinto de mês resolvido', () => {
    expect(
      personsSummaryText({
        toReceive: 0,
        toPay: 0,
        outstanding: 0,
        comMovimento: 0,
      }),
    ).toBe('Nenhuma movimentação neste mês')
  })

  it('com pendência mostra os dois lados', () => {
    const texto = personsSummaryText({
      toReceive: 500,
      toPay: 200,
      outstanding: 300,
      comMovimento: 2,
    })
    expect(texto).toContain('a receber')
    expect(texto).toContain('a pagar')
  })

  it('não copia o vocabulário de prazo de Bancos', () => {
    /*
      "Tudo em dia" fala de pontualidade, que este domínio não mede — aqui o
      fato é que as obrigações foram liquidadas.
    */
    const texto = personsSummaryText({
      toReceive: 100,
      toPay: 0,
      outstanding: 0,
      comMovimento: 1,
    })
    expect(texto).not.toContain('em dia')
  })
})

describe('P-9: a page aplica a policy', () => {
  const PAGE = readFileSync(
    new URL('../app/(dashboard)/persons/page.tsx', import.meta.url),
    'utf-8',
  )
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('a row exibe o líquido do período, não o saldo aberto', () => {
    /*
      Este é o assert que impede a regressão voltar: a page precisa CHAMAR o
      helper, não apenas ele existir.
    */
    expect(code).toContain('periodNetAmount(balance)')
    expect(code).toContain('personRowStatus(balance)')
    expect(code).not.toContain('balance?.netBalance ?? 0\n')
  })

  it('o rótulo e o tom vêm dos mapas', () => {
    expect(code).toContain('PERSON_ROW_LABEL[status]')
    expect(code).toContain('PERSON_ROW_TONE[status]')
    expect(code).not.toContain("'A RECEBER' : ")
  })

  it('o subtexto resolvido tem precedência sobre o prazo', () => {
    expect(code).toContain('resolvedSubtext(status)')
    expect(code).toContain('resolvido ?? nextItemLabel(')
  })

  it('resolvido não pinta atraso', () => {
    /*
      `nextItem` pode continuar preenchido por um item de outra competência; o
      âmbar/vermelho de atraso numa linha quitada mentiria.
    */
    expect(code).toContain('resolvido === null && isNextItemOverdue(')
  })

  it('o resumo do topo soma o período', () => {
    expect(code).toContain('b.periodReceivableTotal')
    expect(code).toContain('b.periodDebtTotal')
    expect(code).toContain('personsSummaryText(summary)')
  })

  it('a ordenação NÃO passa a seguir o valor histórico', () => {
    /*
      Urgência é sobre o que resta a fazer. Ordenar pelo histórico colocaria
      um mês inteiramente quitado no topo, acima de uma dívida vencida.
    */
    const sort = code.slice(code.indexOf('const orderedPersons'))
    const bloco = sort.slice(0, sort.indexOf('}, ['))
    expect(bloco).toContain('netBalance: balance?.netBalance ?? 0')
    expect(bloco).not.toContain('periodNetAmount')
  })
})
