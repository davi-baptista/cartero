import { describe, expect, it } from 'vitest'
import {
  canEditSettlementDate,
  currentSettlementDate,
  settlementDateActionLabel,
} from './settlement-date-action'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Acesso à correção da data de acerto
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A ação é oferecida em cinco superfícies: menu mobile e ações desktop de
 * Dívidas e A Receber, mais o Histórico do drawer de Pessoa. A regra vive num
 * helper único justamente para não divergir entre elas.
 */

describe('canEditSettlementDate', () => {
  it('item resolvido oferece a ação', () => {
    expect(canEditSettlementDate({ isPaid: true })).toBe(true)
  })

  it('item ABERTO não oferece', () => {
    /*
      Item aberto não tem data de acerto para corrigir, e o backend recusa com
      `SETTLEMENT_NOT_RESOLVED` — oferecer levaria a um erro previsível.
    */
    expect(canEditSettlementDate({ isPaid: false })).toBe(false)
  })
})

describe('settlementDateActionLabel', () => {
  it('dívida fala em pagamento', () => {
    expect(settlementDateActionLabel('debt')).toBe('Alterar data do pagamento')
  })

  it('cobrança fala em recebimento', () => {
    expect(settlementDateActionLabel('receivable')).toBe(
      'Alterar data do recebimento',
    )
  })

  it('os dois rótulos são distintos', () => {
    // Vocabulário próprio de cada domínio, como no resto do app.
    expect(settlementDateActionLabel('debt')).not.toBe(
      settlementDateActionLabel('receivable'),
    )
  })
})

describe('currentSettlementDate', () => {
  it('devolve a data registrada, para o diálogo abrir preenchido', () => {
    /*
      O caso da regularização: registrado em 24/08/2026, o usuário corrige
      para a data real. Abrir vazio o obrigaria a redigitar o que já existe.
    */
    expect(currentSettlementDate({ paidAt: '2026-08-24' })).toBe('2026-08-24')
  })

  it('legado sem data devolve null', () => {
    // O diálogo mostra "não registrada" em vez de inventar um valor.
    expect(currentSettlementDate({ paidAt: null })).toBeNull()
    expect(currentSettlementDate({})).toBeNull()
  })

  it('preserva o dia civil sem converter para Date', () => {
    // Construir `Date` aqui deslocaria o dia em UTC-3.
    expect(currentSettlementDate({ paidAt: '2025-12-20' })).toContain(
      '2025-12-20',
    )
  })
})

describe('o cenário do item 8, ponta a ponta', () => {
  it('dívida de dezembro registrada em agosto é corrigível', () => {
    /*
      dueDate 08/12/2025, paidAt 24/08/2026, isPaid true.
      A ação aparece, e o diálogo abre com a data errada preenchida —
      é ela que o usuário troca por 20/12/2025.
    */
    const divida = { isPaid: true, paidAt: '2026-08-24' }

    expect(canEditSettlementDate({ isPaid: divida.isPaid })).toBe(true)
    expect(currentSettlementDate(divida)).toBe('2026-08-24')
    expect(settlementDateActionLabel('debt')).toContain('pagamento')
  })

  it('a mesma dívida em aberto não ofereceria a ação', () => {
    expect(canEditSettlementDate({ isPaid: false })).toBe(false)
  })
})
