import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  hasOpenObligation,
  outstandingNetAmount,
  periodNetAmount,
  personRowAmount,
  personRowStatus,
  PERSON_ROW_LABEL,
  PERSON_ROW_TONE,
  rowSubtext,
  rowSubtextTone,
  type PeriodBalance,
} from './person-period-view'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A row de Pessoa tem dois MODOS, e o número muda de significado
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   ACTIVE    "quanto ainda falta acertar?"   → outstanding
 *   SETTLED   "qual foi o saldo do mês?"      → histórico
 *   EMPTY     não houve atividade             → zero
 *
 * Duas correções, com causas distintas:
 *
 * · a fase anterior exibia SEMPRE o histórico, para não perder o valor do mês
 *   quando tudo era quitado. Certo no fim, cedo demais no meio: com R$ 500 a
 *   receber e R$ 300 já recebidos, a row seguia dizendo R$ 500;
 *
 * · o modo saía de `Math.abs(netBalance)`, que é ZERO quando há R$ 200 abertos
 *   de cada lado — então essa pessoa caía no ramo resolvido e a row dizia
 *   RECEBIDO com duas obrigações vivas.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const PERSONS = semComentarios(ler('../app/(dashboard)/persons/page.tsx'))

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

describe('P1-P4: ACTIVE usa outstanding', () => {
  it('P1: histórico 500, já recebido 300 → mostra os 200 que faltam', () => {
    /*
      O caso do relato. R$ 500 é o que houve; R$ 200 é o que exige ação, e a
      lista existe para ser varrida rápido.
    */
    const b = bal({
      periodReceivableTotal: 500,
      receivablePending: 200,
      netBalance: 200,
      settledReceivablesCount: 1,
    })

    expect(personRowAmount(b)).toBe(200)
    expect(personRowStatus(b)).toBe('receivable')
    expect(PERSON_ROW_LABEL.receivable).toBe('A RECEBER')
    /* O histórico continua disponível, só não é o que a row exibe. */
    expect(periodNetAmount(b)).toBe(500)
  })

  it('P2: dívida parcialmente paga', () => {
    const b = bal({
      periodDebtTotal: 500,
      debtPending: 200,
      netBalance: -200,
      settledDebtsCount: 1,
    })

    expect(personRowAmount(b)).toBe(-200)
    expect(personRowStatus(b)).toBe('debt')
    expect(PERSON_ROW_LABEL.debt).toBe('VOCÊ DEVE')
  })

  it('P3: um item resolvido e outro aberto usa outstanding', () => {
    const b = bal({
      periodReceivableTotal: 800,
      receivablePending: 300,
      netBalance: 300,
      settledReceivablesCount: 1,
    })

    expect(personRowAmount(b)).toBe(300)
    expect(personRowAmount(b)).not.toBe(800)
  })

  it('P4: quitar mais um item REDUZ o valor exibido', () => {
    /*
      A propriedade que o usuário observa: cada liquidação encolhe o número,
      até a última — quando ele volta a ser o histórico, com aviso.
    */
    const passos = [500, 300, 100].map((pendente) =>
      personRowAmount(
        bal({
          periodReceivableTotal: 500,
          receivablePending: pendente,
          netBalance: pendente,
        }),
      ),
    )

    expect(passos).toEqual([500, 300, 100])
    expect(passos[1]).toBeLessThan(passos[0])
    expect(passos[2]).toBeLessThan(passos[1])
  })
})

describe('P5-P8: SETTLED usa histórico', () => {
  it('P5: tudo recebido → saldo final positivo', () => {
    const b = bal({
      periodReceivableTotal: 500,
      settledReceivablesCount: 2,
      settledAt: '2026-09-28',
    })

    expect(personRowAmount(b)).toBe(500)
    expect(personRowStatus(b)).toBe('finalBalance')
    expect(PERSON_ROW_LABEL.finalBalance).toBe('SALDO FINAL')
  })

  it('P6: tudo pago → saldo final negativo', () => {
    const b = bal({
      periodDebtTotal: 500,
      settledDebtsCount: 1,
      settledAt: '2026-09-28',
    })

    expect(personRowAmount(b)).toBe(-500)
    expect(personRowStatus(b)).toBe('finalBalance')
  })

  it('P7: metadata diz QUANDO terminou', () => {
    expect(rowSubtext('finalBalance', 'Receber em 5d', '2026-09-28')).toBe(
      'Quitado em 28/09/2026',
    )
  })

  it('P8: sem data defensável, fallback honesto', () => {
    expect(rowSubtext('finalBalance', null, null)).toBe('Acerto concluído')
  })

  it('o verde de conclusão vale para o trailing e a metadata', () => {
    expect(PERSON_ROW_TONE.finalBalance).toBe('text-paid')
    expect(rowSubtextTone('finalBalance', null)).toBe('text-paid')
  })

  it('P7/§7: o trailing NÃO diz mais RECEBIDO nem PAGO', () => {
    /*
      O número volta a ser o histórico, e sem aviso isso pareceria bug — o
      valor "cresce" ao quitar o último item. `SALDO FINAL` é o aviso de que a
      base mudou; "Recebido" descreveria o evento sem dizer isso.

      A informação de resolução não se perdeu: está em "Quitado em DD/MM".
    */
    expect(Object.values(PERSON_ROW_LABEL)).not.toContain('RECEBIDO')
    expect(Object.values(PERSON_ROW_LABEL)).not.toContain('PAGO')
  })
})

describe('P9-P15: líquido zero COM pendência é ACTIVE', () => {
  const netZero = bal({
    receivablePending: 200,
    debtPending: 200,
    netBalance: 0,
    periodReceivableTotal: 200,
    periodDebtTotal: 200,
    nextItem: { direction: 'pay', dueDate: '2026-09-11' },
  })

  it('P9: é ACTIVE, não SETTLED', () => {
    /*
      A causa do bug: o modo saía de `Math.abs(netBalance)`, e aqui ele é zero
      com duas obrigações vivas. A pergunta certa é sobre os LADOS.
    */
    expect(hasOpenObligation(netZero)).toBe(true)
    expect(personRowStatus(netZero)).toBe('toSettle')
  })

  it('P10: o valor é zero — e isso é verdade', () => {
    expect(personRowAmount(netZero)).toBe(0)
    expect(outstandingNetAmount(netZero)).toBe(0)
  })

  it('P11: o trailing é A ACERTAR', () => {
    /*
      Nenhum dos dois sentidos manda, mas há trabalho a fazer. Escolher "A
      RECEBER" ou "VOCÊ DEVE" seria arbitrário.
    */
    expect(PERSON_ROW_LABEL.toSettle).toBe('A ACERTAR')
    expect(PERSON_ROW_TONE.toSettle).toBe('text-muted-foreground')
  })

  it('P12: a metadata mostra o evento real', () => {
    expect(rowSubtext('toSettle', 'Pagar amanhã', null)).toBe('Pagar amanhã')
  })

  it('P13/P14/P15: nada de linguagem de quitação', () => {
    const meta = rowSubtext('toSettle', 'Pagar amanhã', '2026-09-11')

    expect(meta).not.toContain('Quitado')
    expect(meta).not.toContain('Acerto concluído')
    expect(PERSON_ROW_LABEL.toSettle).not.toBe('SALDO FINAL')
    expect(PERSON_ROW_TONE.toSettle).not.toBe('text-paid')
  })

  it('um settledAt residual não transforma em resolvido', () => {
    /*
      Um item quitado antes deixa `settledAt` preenchido. Com outro aberto, a
      relação NÃO terminou.
    */
    const comData = { ...netZero, settledAt: '2026-09-05' }

    expect(personRowStatus(comData)).toBe('toSettle')
    expect(rowSubtext('toSettle', 'Pagar amanhã', '2026-09-05')).toBe(
      'Pagar amanhã',
    )
  })

  it('um lado sozinho aberto não é net-zero', () => {
    /* Contrapeso: `toSettle` exige os dois lados se anulando. */
    expect(personRowStatus(bal({ receivablePending: 200, netBalance: 200 }))).toBe(
      'receivable',
    )
    expect(personRowStatus(bal({ debtPending: 200, netBalance: -200 }))).toBe(
      'debt',
    )
  })
})

describe('P16: SETTLED com líquido zero', () => {
  it('R$ 0,00 + SALDO FINAL — diferente de EMPTY', () => {
    /*
      R$ 200 de cada lado, tudo liquidado: o líquido histórico é zero, mas
      houve movimento. "SEM SALDO" afirmaria que nunca teve nada com a pessoa.
    */
    const b = bal({
      periodReceivableTotal: 200,
      periodDebtTotal: 200,
      settledReceivablesCount: 1,
      settledDebtsCount: 1,
      settledAt: '2026-09-20',
    })

    expect(personRowAmount(b)).toBe(0)
    expect(personRowStatus(b)).toBe('finalBalance')
    expect(rowSubtext('finalBalance', null, '2026-09-20')).toBe(
      'Quitado em 20/09/2026',
    )
  })
})

describe('P17: EMPTY é o único SEM SALDO', () => {
  it('sem atividade nenhuma', () => {
    const vazio = bal()

    expect(personRowStatus(vazio)).toBe('empty')
    expect(personRowAmount(vazio)).toBe(0)
    expect(PERSON_ROW_LABEL.empty).toBe('SEM SALDO')
    expect(rowSubtext('empty', null, null)).toBeNull()
  })

  it('os três estados de R$ 0,00 são distinguíveis', () => {
    /*
      O mesmo número, três significados — e é a razão de `A ACERTAR` e
      `SALDO FINAL` existirem.
    */
    const aberto = bal({
      receivablePending: 200,
      debtPending: 200,
      periodReceivableTotal: 200,
      periodDebtTotal: 200,
    })
    const resolvido = bal({
      periodReceivableTotal: 200,
      periodDebtTotal: 200,
      settledReceivablesCount: 1,
      settledDebtsCount: 1,
    })

    expect(personRowAmount(aberto)).toBe(0)
    expect(personRowAmount(resolvido)).toBe(0)
    expect(personRowAmount(bal())).toBe(0)

    expect(
      new Set([
        personRowStatus(aberto),
        personRowStatus(resolvido),
        personRowStatus(bal()),
      ]).size,
    ).toBe(3)
  })
})

describe('a ordem das perguntas define o modo', () => {
  it('pendência vence atividade histórica', () => {
    /*
      Se a pergunta "houve atividade?" viesse primeiro, uma pessoa com item
      resolvido E item aberto cairia em SETTLED — o bug do relato.
    */
    const misto = bal({
      periodReceivableTotal: 800,
      receivablePending: 300,
      netBalance: 300,
      settledReceivablesCount: 1,
      settledAt: '2026-09-05',
    })

    expect(personRowStatus(misto)).toBe('receivable')
    expect(personRowStatus(misto)).not.toBe('finalBalance')
  })

  it('o modo nunca sai do líquido', () => {
    /*
      A invariante que fecha o bug: mesmo líquido, modos diferentes conforme
      exista ou não pendência.
    */
    const abertoZero = bal({ receivablePending: 50, debtPending: 50 })
    const resolvidoZero = bal({
      periodReceivableTotal: 50,
      periodDebtTotal: 50,
      settledReceivablesCount: 1,
      settledDebtsCount: 1,
    })

    expect(outstandingNetAmount(abertoZero)).toBe(0)
    expect(personRowStatus(abertoZero)).not.toBe(personRowStatus(resolvidoZero))
  })

  it('todo status tem rótulo e tom', () => {
    for (const st of [
      'receivable',
      'debt',
      'toSettle',
      'finalBalance',
      'empty',
    ] as const) {
      expect(PERSON_ROW_LABEL[st], st).toBeTruthy()
      expect(PERSON_ROW_TONE[st], st).toBeTruthy()
    }
  })
})

describe('S1-S6: o resumo segue o mesmo modo', () => {
  it('S1/S2: com pendência, soma o outstanding', () => {
    expect(PERSONS).toContain('outstandingReceber += b.receivablePending')
    expect(PERSONS).toContain('outstandingPagar += b.debtPending')
    expect(PERSONS).toContain('const ativo = comPendencia > 0')
    expect(PERSONS).toContain('const toReceive = ativo ? outstandingReceber')
  })

  it('S3: sem pendência, volta ao histórico', () => {
    expect(PERSONS).toContain('historicoReceber += b.periodReceivableTotal')
    expect(PERSONS).toContain('historicoPagar += b.periodDebtTotal')
  })

  it('S1b: o resumo NUNCA soma histórico e outstanding juntos', () => {
    /*
      Segundo guardião: a escolha é exclusiva. Somar os dois produziria um
      número que não corresponde a nenhuma das duas perguntas.
    */
    expect(PERSONS).toContain(
      'const toPay = ativo ? outstandingPagar : historicoPagar',
    )
    /* Sem atribuição incondicional ao histórico, e sem acumular os dois. */
    expect(PERSONS).not.toContain('const toReceive = historicoReceber\n')
    expect(PERSONS).not.toContain('toReceive += b.periodReceivableTotal')
  })

  it('S5b: a contagem de pendência não passa pelo líquido', () => {
    /*
      Terceiro guardião do net-zero: `Math.abs(netBalance)` é zero com R$ 200
      de cada lado, e o resumo anunciaria "Tudo em dia" com trabalho pendente.
    */
    expect(PERSONS).not.toContain('Math.abs(b.netBalance)')
    expect(PERSONS).toContain('hasOpenObligation(b)')
  })

  it('S5: a pendência é medida por CONTAGEM, não por soma', () => {
    /*
      `Math.abs(netBalance)` somado dá zero com R$ 200 de cada lado, e o
      resumo anunciaria "Tudo em dia" com trabalho pendente.
    */
    expect(PERSONS).toContain('if (hasOpenObligation(b)) comPendencia += 1')
    expect(PERSONS).toContain('outstanding: comPendencia')
    expect(PERSONS).not.toContain('outstanding += Math.abs(b.netBalance)')
  })
})

describe('a página aplica a policy', () => {
  it('a row usa o amount do modo', () => {
    expect(PERSONS).toContain('personRowAmount(balance)')
    expect(PERSONS).not.toContain('const net = periodNetAmount(balance)')
  })

  it('o status vem da policy', () => {
    expect(PERSONS).toContain('personRowStatus(balance)')
    expect(PERSONS).toContain('PERSON_ROW_LABEL[status]')
    expect(PERSONS).toContain('PERSON_ROW_TONE[status]')
  })

  it('o balanço neutro tem os lados zerados', () => {
    /* Sem isso, uma pessoa sem linha no lote cairia em ACTIVE. */
    expect(PERSONS).toContain('receivablePending: 0')
    expect(PERSONS).toContain('debtPending: 0')
  })

  it('a ordenação continua recebendo o outstanding', () => {
    /*
      Urgência é sobre o que resta a fazer — `netBalance`, não o histórico.
      Net-zero ACTIVE tem `nextItem`, então entra no grupo de urgência.
    */
    const sort = PERSONS.slice(PERSONS.indexOf('const orderedPersons'))
    const bloco = sort.slice(0, sort.indexOf('}, ['))

    expect(bloco).toContain('netBalance: balance.netBalance')
    expect(bloco).toContain('receivablePending: balance.receivablePending')
    expect(bloco).not.toContain('personRowAmount')
  })
})
