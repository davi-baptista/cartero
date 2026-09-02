import { describe, expect, it } from 'vitest'
import { isNextItemOverdue, nextItemLabel } from './person-next-item'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O próximo acerto, em texto
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A row de Pessoas dizia quanto e não dizia quando: uma cobrança vencida há
 * três dias ficava idêntica a outra que só vence no fim do mês.
 *
 * Duas coisas são protegidas aqui:
 *
 *   a DIREÇÃO — "Receber" e "Pagar" invertidos seriam um erro de UX grave,
 *   porque o usuário agiria sobre a pessoa errada;
 *
 *   o DIA CIVIL — as datas chegam como `YYYY-MM-DD` e são comparadas como
 *   string/componentes, nunca por `new Date('2026-09-02')`, que em fuso
 *   negativo cai no dia anterior e transformaria "hoje" em "atrasado 1d".
 *
 * O relógio é sempre injetado: um teste que dependesse do dia real passaria
 * hoje e quebraria amanhã.
 */

const HOJE = '2026-09-02'

const receber = (dueDate: string) => ({ direction: 'receive' as const, dueDate })
const pagar = (dueDate: string) => ({ direction: 'pay' as const, dueDate })

describe('P1-P7: o estado temporal', () => {
  it('P1: cobrança vencida', () => {
    expect(nextItemLabel(receber('2026-08-30'), HOJE)).toBe('Receber atrasado 3d')
  })

  it('P2: dívida vencida', () => {
    expect(nextItemLabel(pagar('2026-08-31'), HOJE)).toBe('Pagar atrasado 2d')
  })

  it('P3: cobrança hoje', () => {
    expect(nextItemLabel(receber(HOJE), HOJE)).toBe('Receber hoje')
  })

  it('P4: dívida hoje', () => {
    expect(nextItemLabel(pagar(HOJE), HOJE)).toBe('Pagar hoje')
  })

  it('P5: cobrança amanhã', () => {
    /* "em 1d" seria correto e mais frio; "amanhã" é como as pessoas pensam. */
    expect(nextItemLabel(receber('2026-09-03'), HOJE)).toBe('Receber amanhã')
  })

  it('P6: dívida amanhã', () => {
    expect(nextItemLabel(pagar('2026-09-03'), HOJE)).toBe('Pagar amanhã')
  })

  it('P7: futuro conta os dias', () => {
    expect(nextItemLabel(receber('2026-09-06'), HOJE)).toBe('Receber em 4d')
    expect(nextItemLabel(pagar('2026-09-12'), HOJE)).toBe('Pagar em 10d')
  })

  it('atraso longo continua legível', () => {
    expect(nextItemLabel(receber('2026-06-02'), HOJE)).toBe('Receber atrasado 92d')
  })
})

describe('a direção nunca se inverte', () => {
  it('receivable é sempre "Receber"; debt é sempre "Pagar"', () => {
    /*
      O erro que este teste existe para impedir: trocar os verbos faria o
      usuário cobrar quem ele deve. "Vence em 4d" sozinho teria o mesmo
      defeito de outra forma — obrigaria a lembrar quem deve a quem.
    */
    for (const dia of ['2026-08-01', HOJE, '2026-09-03', '2026-12-25']) {
      expect(nextItemLabel(receber(dia), HOJE)).toMatch(/^Receber/)
      expect(nextItemLabel(pagar(dia), HOJE)).toMatch(/^Pagar/)
    }
  })
})

describe('P10: sem item, sem subtexto', () => {
  it('null e undefined não geram texto', () => {
    /*
      A row fica limpa. "Sem pendências" ocuparia a linha para não dizer nada,
      e a lista existe para ser varrida rápido.
    */
    expect(nextItemLabel(null, HOJE)).toBeNull()
    expect(nextItemLabel(undefined, HOJE)).toBeNull()
  })
})

describe('a fronteira do dia civil', () => {
  it('a virada não desloca o dia', () => {
    /*
      `new Date('2026-09-02')` é meia-noite UTC — 21h do dia 1º em Fortaleza.
      Construir a data assim faria "hoje" virar "atrasado 1d" para quem abre o
      app à noite. A comparação é por componentes, então isso não acontece.
    */
    expect(nextItemLabel(receber('2026-09-02'), '2026-09-02')).toBe('Receber hoje')
    expect(nextItemLabel(receber('2026-09-01'), '2026-09-02')).toBe(
      'Receber atrasado 1d',
    )
  })

  it('atravessa a virada de mês', () => {
    expect(nextItemLabel(pagar('2026-10-01'), '2026-09-30')).toBe('Pagar amanhã')
  })

  it('atravessa a virada de ano', () => {
    expect(nextItemLabel(pagar('2027-01-01'), '2026-12-31')).toBe('Pagar amanhã')
    expect(nextItemLabel(receber('2026-12-31'), '2027-01-02')).toBe(
      'Receber atrasado 2d',
    )
  })

  it('ignora a hora que venha junto da data', () => {
    /*
      Hoje o backend envia `YYYY-MM-DD`. Se passar a enviar timestamp, o dia
      precisa continuar sendo o dia — sem o recorte, `Number('02T00:00:00')` é
      `NaN` e a row exibiria "Receber em NaNd".
    */
    const comHora = { direction: 'receive' as const, dueDate: '2026-09-02T00:00:00.000Z' }
    expect(nextItemLabel(comHora, HOJE)).toBe('Receber hoje')
    expect(isNextItemOverdue(comHora, HOJE)).toBe(false)

    const vencidoComHora = { direction: 'pay' as const, dueDate: '2026-08-30T12:00:00.000Z' }
    expect(nextItemLabel(vencidoComHora, HOJE)).toBe('Pagar atrasado 3d')
    expect(isNextItemOverdue(vencidoComHora, HOJE)).toBe(true)
  })
})

describe('o atraso é sinalizado separado do texto', () => {
  it('só o vencido é atraso', () => {
    /*
      Separado porque quem desenha decide a cor: pintar todos os estados
      transformaria a lista numa árvore de Natal.
    */
    expect(isNextItemOverdue(receber('2026-08-30'), HOJE)).toBe(true)
    expect(isNextItemOverdue(receber(HOJE), HOJE)).toBe(false)
    expect(isNextItemOverdue(receber('2026-09-10'), HOJE)).toBe(false)
  })

  it('vencer hoje NÃO é atraso', () => {
    /* Há o dia inteiro para resolver — a mesma regra do resto do produto. */
    expect(isNextItemOverdue(pagar(HOJE), HOJE)).toBe(false)
  })

  it('sem item não há atraso', () => {
    expect(isNextItemOverdue(null, HOJE)).toBe(false)
  })
})
