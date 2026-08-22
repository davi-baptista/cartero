import { describe, expect, it } from 'vitest'
import {
  DEBT_STATUS_LABEL,
  isOverdue,
  overdueCountLabel,
  RECEIVABLE_STATUS_LABEL,
  settlementStatus,
} from './settlement-status'
import { INVOICE_STATUS_LABEL } from './invoice-status'
import { InvoiceStatus } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Status derivado e vocabulário oficial (Fase 10)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O status NÃO é persistido: deriva de `isPaid` + `dueDate`, e por isso muda de
 * valor sozinho à meia-noite. A comparação é por string ISO, não por `Date` —
 * `new Date(iso)` cai no dia anterior em fuso negativo, e o Cartero é UTC-3.
 *
 * O vocabulário também é testado aqui: as fases anteriores encontraram três
 * palavras diferentes ("vencida", "atrasada", "Em atraso") para o mesmo estado.
 */

/** Data de hoje no formato que o helper compara. */
function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function daysFromToday(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('Derivação do status', () => {
  it('pago é pago, independente da data', () => {
    expect(
      settlementStatus({ isPaid: true, dueDate: daysFromToday(-30) }),
    ).toBe('paid')
    expect(settlementStatus({ isPaid: true, dueDate: daysFromToday(30) })).toBe(
      'paid',
    )
  })

  it('vencimento no passado e em aberto é atraso', () => {
    expect(
      settlementStatus({ isPaid: false, dueDate: daysFromToday(-1) }),
    ).toBe('overdue')
  })

  it('vence HOJE ainda não está em atraso', () => {
    /**
     * Comparação estrita `<`: um item que vence hoje tem o dia inteiro para
     * ser pago. Tratá-lo como atrasado alarmaria sem motivo.
     */
    expect(settlementStatus({ isPaid: false, dueDate: today() })).toBe(
      'pending',
    )
  })

  it('vencimento futuro é pendente', () => {
    expect(settlementStatus({ isPaid: false, dueDate: daysFromToday(5) })).toBe(
      'pending',
    )
  })

  it('timestamp ISO completo é aceito', () => {
    /**
     * `dueDate` pode chegar como `2026-06-26T00:00:00.000Z`. O helper recorta
     * os 10 primeiros caracteres em vez de construir um `Date`, então não há
     * conversão de fuso capaz de deslocar o dia.
     */
    const passado = `${daysFromToday(-2)}T00:00:00.000Z`

    expect(settlementStatus({ isPaid: false, dueDate: passado })).toBe(
      'overdue',
    )
  })

  it('isOverdue concorda com settlementStatus', () => {
    const item = { isPaid: false, dueDate: daysFromToday(-1) }

    expect(isOverdue(item)).toBe(true)
    expect(isOverdue({ isPaid: true, dueDate: daysFromToday(-1) })).toBe(false)
  })
})

describe('Vocabulário oficial', () => {
  it('dívida usa Pendente / Em atraso / Pago', () => {
    expect(DEBT_STATUS_LABEL.pending).toBe('Pendente')
    expect(DEBT_STATUS_LABEL.overdue).toBe('Em atraso')
    /*
      "Pago", não "Paga": `settlement-status.ts` divergia de
      `calendar-events.ts`, que já usava esta forma. Mesmo estado, duas
      palavras em telas diferentes.
    */
    expect(DEBT_STATUS_LABEL.paid).toBe('Pago')
  })

  it('cobrança usa Recebida na conclusão', () => {
    // A conclusão tem nome diferente nos dois domínios; pendente e atraso não.
    expect(RECEIVABLE_STATUS_LABEL.paid).toBe('Recebida')
    expect(RECEIVABLE_STATUS_LABEL.overdue).toBe('Em atraso')
  })

  it('fatura usa Aberta / Fechada / Em atraso / Paga', () => {
    expect(INVOICE_STATUS_LABEL[InvoiceStatus.OPEN]).toBe('Aberta')
    expect(INVOICE_STATUS_LABEL[InvoiceStatus.CLOSED]).toBe('Fechada')
    expect(INVOICE_STATUS_LABEL[InvoiceStatus.OVERDUE]).toBe('Em atraso')
    expect(INVOICE_STATUS_LABEL[InvoiceStatus.PAID]).toBe('Paga')
  })

  it('nenhum rótulo usa os termos proibidos', () => {
    /**
     * "Vencida", "Atrasada" e "Atrasado" foram usados para o MESMO estado em
     * telas diferentes. Este teste é a rede que impede a divergência voltar.
     */
    const proibidos = /vencid|atrasad/i
    const todos = [
      ...Object.values(DEBT_STATUS_LABEL),
      ...Object.values(RECEIVABLE_STATUS_LABEL),
      ...Object.values(INVOICE_STATUS_LABEL),
    ]

    for (const label of todos) {
      expect(label).not.toMatch(proibidos)
    }
  })
})

describe('Contador de itens em atraso', () => {
  it('singular e plural por domínio', () => {
    expect(overdueCountLabel(1, 'debt')).toBe('1 dívida em atraso')
    expect(overdueCountLabel(3, 'debt')).toBe('3 dívidas em atraso')
    expect(overdueCountLabel(1, 'receivable')).toBe('1 cobrança em atraso')
    expect(overdueCountLabel(2, 'receivable')).toBe('2 cobranças em atraso')
  })

  it('nunca usa "vencida" nem "atrasada"', () => {
    // Os dois contadores usavam palavras diferentes antes da Fase 8A.
    expect(overdueCountLabel(2, 'debt')).not.toMatch(/vencid|atrasad/i)
    expect(overdueCountLabel(2, 'receivable')).not.toMatch(/vencid|atrasad/i)
  })
})
