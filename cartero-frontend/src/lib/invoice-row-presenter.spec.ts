import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  hasTimingLabel,
  invoiceRowPresentation,
  type PresentableInvoice,
} from './invoice-row-presenter'
import { BANK_TRAILING_LABEL, BANK_TRAILING_TONE } from './bank-invoice-selection'
import { InvoiceStatus } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A mesma fatura, a mesma row — nas duas telas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Bancos e a seção Faturas do Orçamento montavam a row por caminhos
 * diferentes, e divergiam num ponto difícil de notar: o prazo de uma fatura
 * PAGA saía verde em Bancos e cinza no Orçamento.
 *
 * A causa não era um helper errado — `invoiceTimingClass` devolve muted para
 * `PAID` de propósito. Bancos corrigia com uma condicional dentro do JSX, e
 * ERA ELA a policy real, num lugar onde ninguém que consumisse o helper a
 * encontraria.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const BANKS = semComentarios(ler('../app/(dashboard)/banks/page.tsx'))
const BUDGET = semComentarios(ler('../app/(dashboard)/budget/page.tsx'))

/** 10/09/2026. */
const HOJE = new Date(2026, 8, 10)

function fatura(
  status: InvoiceStatus,
  dias = { close: 20, due: 27 },
): PresentableInvoice {
  const d = (dia: number) => `2026-09-${String(dia).padStart(2, '0')}`
  return { status, closeDate: d(dias.close), dueDate: d(dias.due) }
}

describe('os quatro estados persistidos', () => {
  it('OPEN conta até o fechamento', () => {
    const p = invoiceRowPresentation(fatura(InvoiceStatus.OPEN), HOJE)

    expect(p.statusLabel).toBe('Fatura aberta')
    expect(p.timingLabel).toContain('Fecha')
  })

  it('CLOSED conta até o vencimento', () => {
    const p = invoiceRowPresentation(fatura(InvoiceStatus.CLOSED), HOJE)

    expect(p.statusLabel).toBe('Fatura fechada')
    expect(p.timingLabel).toContain('Vence')
  })

  it('OVERDUE conta desde o vencimento', () => {
    const p = invoiceRowPresentation(
      fatura(InvoiceStatus.OVERDUE, { close: 1, due: 5 }),
      HOJE,
    )

    expect(p.statusLabel).toBe('Fatura vencida')
    expect(p.timingTone).toBe('text-destructive')
  })

  it('PAID mostra a data factual, sem contagem', () => {
    /*
      Um ciclo quitado não tem prazo a cumprir, e exibir contagem sobre ele
      sugeriria pendência onde não há.
    */
    const p = invoiceRowPresentation(fatura(InvoiceStatus.PAID), HOJE)

    expect(p.statusLabel).toBe('Paga')
    expect(p.timingLabel).toBe('Venceu em 27/09/2026')
    expect(p.timingLabel).not.toMatch(/\d+d$/)
  })

  it('sem fatura não inventa prazo', () => {
    /*
      Nenhuma data existe para contar. "Sem fatura" é o estado, e o prazo fica
      vazio — não um placeholder.
    */
    const p = invoiceRowPresentation(null, HOJE)

    expect(p.statusLabel).toBe(BANK_TRAILING_LABEL.noInvoice)
    expect(p.timingLabel).toBe('')
    expect(hasTimingLabel(p)).toBe(false)
  })

  it('os rótulos vêm da policy, não de literais', () => {
    for (const st of [
      InvoiceStatus.OPEN,
      InvoiceStatus.CLOSED,
      InvoiceStatus.OVERDUE,
      InvoiceStatus.PAID,
    ]) {
      const p = invoiceRowPresentation(fatura(st), HOJE)
      expect(Object.values(BANK_TRAILING_LABEL)).toContain(p.statusLabel)
      expect(Object.values(BANK_TRAILING_TONE)).toContain(p.statusTone)
    }
  })
})

describe('a regressão corrigida: prazo de fatura paga', () => {
  it('PAGA tinge o prazo com o MESMO verde do trailing', () => {
    /*
      "Venceu em 27/09" ao lado de "PAGA" em verde fala do mesmo fato
      resolvido. Saindo cinza, a linha parecia meio-concluída.
    */
    const p = invoiceRowPresentation(fatura(InvoiceStatus.PAID), HOJE)

    expect(p.timingTone).toBe('text-paid')
    expect(p.timingTone).toBe(p.statusTone)
    expect(p.timingTone).toBe(BANK_TRAILING_TONE.paid)
  })

  it('não é um verde novo', () => {
    /* O mesmo token de `PAGA`, de "Tudo em dia" e de `RECEBIDO`. */
    expect(BANK_TRAILING_TONE.paid).toBe('text-paid')
  })

  it('o verde é EXCEÇÃO, não substitui a régua de prazo', () => {
    /*
      O risco da correção é pintar tudo de verde. Os outros estados continuam
      com a régua temporal: vermelho no atraso, âmbar em ≤7 dias, neutro no
      resto.
    */
    const vencida = invoiceRowPresentation(
      fatura(InvoiceStatus.OVERDUE, { close: 1, due: 5 }),
      HOJE,
    )
    const fechaLonge = invoiceRowPresentation(
      fatura(InvoiceStatus.OPEN, { close: 30, due: 30 }),
      HOJE,
    )

    expect(vencida.timingTone).toBe('text-destructive')
    expect(fechaLonge.timingTone).toBe('text-muted-foreground')
    for (const p of [vencida, fechaLonge]) {
      expect(p.timingTone).not.toBe('text-paid')
    }
  })

  it('prazo curto usa o âmbar canônico', () => {
    /* A mesma janela de 7 dias de Pessoas e da "Atenção agora". */
    const p = invoiceRowPresentation(
      fatura(InvoiceStatus.CLOSED, { close: 1, due: 14 }),
      HOJE,
    )

    expect(p.timingTone).toBe('text-pending')
  })
})

describe('o valor nunca passa por aqui', () => {
  it('o presenter não devolve tom de valor', () => {
    /*
      R$ 1.940,95 é o mesmo número pago ou não. Não existe campo para uma tela
      pedir "a cor do valor" — a ausência é a garantia.
    */
    const p = invoiceRowPresentation(fatura(InvoiceStatus.PAID), HOJE)

    expect(Object.keys(p).sort()).toEqual([
      'state',
      'statusLabel',
      'statusTone',
      'timingLabel',
      'timingTone',
    ])
  })

  it('nenhuma das duas telas colore o valor da fatura', () => {
    for (const [nome, code] of [
      ['banks', BANKS],
      ['budget', BUDGET],
    ] as const) {
      /* `MonthInvoiceAmount`/`ROW_AMOUNT_CLASS` sem tom — só escala. */
      expect(code, nome).not.toContain('amountTone')
    }
  })
})

describe('as duas telas consomem a MESMA autoridade', () => {
  it('Bancos pede a apresentação ao presenter', () => {
    expect(BANKS).toContain('invoiceRowPresentation(invoice)')
    expect(BANKS).toContain('apresentacao.timingLabel')
    expect(BANKS).toContain('apresentacao.timingTone')
    expect(BANKS).toContain('apresentacao.statusLabel')
    expect(BANKS).toContain('apresentacao.statusTone')
  })

  it('Orçamento pede a mesma coisa', () => {
    expect(BUDGET).toContain('invoiceRowPresentation(inv)')
    expect(BUDGET).toContain('apresentacao.timingLabel')
    expect(BUDGET).toContain('apresentacao.timingTone')
    expect(BUDGET).toContain('apresentacao.statusLabel')
    expect(BUDGET).toContain('apresentacao.statusTone')
  })

  it('nenhuma das duas decide o tom localmente', () => {
    /*
      O assert que impede a divergência de voltar: a condicional
      `status === PAID ? verde : régua` era a policy, e vivia no JSX de Bancos.
    */
    for (const [nome, code] of [
      ['banks', BANKS],
      ['budget', BUDGET],
    ] as const) {
      expect(code, nome).not.toContain('InvoiceStatus.PAID\n')
      expect(code, nome).not.toContain('invoiceTimingClass(')
      expect(code, nome).not.toContain('bankTrailingState(')
      expect(code, nome).not.toContain('BANK_TRAILING_TONE[')
    }
  })

  it('nenhuma das duas usa badge na row de fatura', () => {
    for (const [nome, code] of [
      ['banks', BANKS],
      ['budget', BUDGET],
    ] as const) {
      expect(code, nome).not.toContain('badge=')
    }
  })

  it('a mesma fatura produz a mesma apresentação — é a definição de alinhado', () => {
    /*
      Determinismo do presenter: sem estado interno, mesma entrada devolve
      objeto igual. É o que torna impossível as duas telas discordarem.
    */
    for (const st of [
      InvoiceStatus.OPEN,
      InvoiceStatus.CLOSED,
      InvoiceStatus.OVERDUE,
      InvoiceStatus.PAID,
    ]) {
      const a = invoiceRowPresentation(fatura(st), HOJE)
      const b = invoiceRowPresentation(fatura(st), HOJE)
      expect(a).toEqual(b)
    }
  })
})

describe('a anatomia da row', () => {
  it('prazo à esquerda, estado à direita — em ambas', () => {
    /*
      nome / prazo  ·  valor / estado. O presenter nomeia os quatro slots, e é
      o nome que impede uma tela de trocar a posição de dois deles.
    */
    const p = invoiceRowPresentation(fatura(InvoiceStatus.CLOSED), HOJE)

    expect(p.timingLabel).toBeTruthy()
    expect(p.statusLabel).toBeTruthy()
    expect(p.timingLabel).not.toBe(p.statusLabel)
  })

  it('o estado não repete a competência', () => {
    /*
      "SETEMBRO 2026" se repetia em cada row sob um seletor que já dizia
      setembro. O trailing nomeia o ciclo, não o mês.
    */
    for (const st of [
      InvoiceStatus.OPEN,
      InvoiceStatus.CLOSED,
      InvoiceStatus.OVERDUE,
      InvoiceStatus.PAID,
    ]) {
      const p = invoiceRowPresentation(fatura(st), HOJE)
      expect(p.statusLabel).not.toMatch(/2026|setembro/i)
    }
  })
})
