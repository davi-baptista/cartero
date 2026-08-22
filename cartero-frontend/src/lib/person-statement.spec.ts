import { describe, expect, it } from 'vitest'
import type { PersonSummary } from '@/types'
import {
  balanceDirection,
  balanceLabel,
  balanceSentence,
  buildWhatsAppMessage,
  normalizeWhatsAppPhone,
  pendingPhrase,
} from './person-statement'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Consolidado e mensagem de uma pessoa (Fase 10)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Duas regras críticas vivem aqui, e as duas já falharam antes:
 *
 *   1. **Saldo zero não é quitação.** Com R$ 500 de cada lado o saldo é zero e
 *      existem duas obrigações abertas. A mensagem antiga dizia
 *      "Estamos quites nesse período — nada pendente!" nesse caso.
 *   2. **Telefone inválido não gera link.** A versão anterior transformava
 *      qualquer string em `wa.me/55<dígitos>`, abrindo conversa inexistente.
 */

function summary(over: Partial<PersonSummary>): PersonSummary {
  const receivablePending = over.receivablePending ?? 0
  const debtPending = over.debtPending ?? 0
  const pendingReceivablesCount =
    over.pendingReceivablesCount ?? (receivablePending > 0 ? 1 : 0)
  const pendingDebtsCount = over.pendingDebtsCount ?? (debtPending > 0 ? 1 : 0)

  return {
    receivablePending,
    debtPending,
    netBalance: receivablePending - debtPending,
    pendingReceivablesCount,
    pendingDebtsCount,
    isFullySettled:
      over.isFullySettled ??
      (pendingReceivablesCount === 0 && pendingDebtsCount === 0),
  }
}

describe('Direção do saldo', () => {
  it('só a receber → receive', () => {
    expect(balanceDirection(summary({ receivablePending: 500 }))).toBe('receive')
  })

  it('só a pagar → pay', () => {
    expect(balanceDirection(summary({ debtPending: 500 }))).toBe('pay')
  })

  it('nada pendente → settled', () => {
    expect(balanceDirection(summary({}))).toBe('settled')
  })

  it('saldo zero COM pendências → offset, nunca settled', () => {
    /**
     * O estado que não existia antes. Sem ele, o zero matemático era
     * indistinguível de "não há nada pendente".
     */
    const zerado = summary({ receivablePending: 500, debtPending: 500 })

    expect(zerado.netBalance).toBe(0)
    expect(balanceDirection(zerado)).toBe('offset')
    expect(balanceDirection(zerado)).not.toBe('settled')
  })
})

describe('Rótulos', () => {
  it('offset não usa linguagem de quitação', () => {
    const label = balanceLabel(
      summary({ receivablePending: 500, debtPending: 500 }),
    )

    expect(label).not.toMatch(/acertado|quite/i)
  })

  it('somente sem pendências diz "Tudo acertado"', () => {
    expect(balanceLabel(summary({}))).toBe('Tudo acertado')
  })

  it('a frase de offset menciona as pendências abertas', () => {
    const sentence = balanceSentence(
      summary({ receivablePending: 500, debtPending: 500 }),
      'Eva',
    )

    expect(sentence).toMatch(/aberto/)
  })

  it('a frase nomeia quem deve a quem', () => {
    expect(
      balanceSentence(summary({ receivablePending: 300 }), 'Eva'),
    ).toMatch(/Eva deve/)
    expect(balanceSentence(summary({ debtPending: 300 }), 'Eva')).toMatch(
      /Você deve/,
    )
  })
})

describe('Contagem de pendências', () => {
  it('menciona só o que existe', () => {
    expect(pendingPhrase(summary({ debtPending: 100 }))).toBe('1 dívida')
    expect(pendingPhrase(summary({ receivablePending: 100 }))).toBe(
      '1 cobrança',
    )
  })

  it('junta os dois lados', () => {
    expect(
      pendingPhrase(summary({ receivablePending: 100, debtPending: 100 })),
    ).toBe('1 dívida e 1 cobrança')
  })

  it('pluraliza', () => {
    expect(
      pendingPhrase(
        summary({ debtPending: 200, pendingDebtsCount: 2 }),
      ),
    ).toBe('2 dívidas')
  })
})

describe('Mensagem de WhatsApp', () => {
  it('somente a receber: cobrança direta', () => {
    const message = buildWhatsAppMessage(
      summary({ receivablePending: 500 }),
      'Eva',
    )

    expect(message).toMatch(/pendente comigo/)
  })

  it('somente a pagar: NÃO usa linguagem de cobrança', () => {
    /**
     * O usuário é quem deve — cobrar aqui seria cobrar a si mesmo.
     */
    const message = buildWhatsAppMessage(summary({ debtPending: 500 }), 'Eva')

    expect(message).toMatch(/Estou te devendo/)
    expect(message).not.toMatch(/você (me )?deve/i)
  })

  it('ambos os lados: expõe a composição', () => {
    /**
     * "Você me deve R$ 300" afirmaria um encontro de contas que o app não faz.
     * A mensagem mostra os dois valores brutos.
     */
    const message = buildWhatsAppMessage(
      summary({ receivablePending: 500, debtPending: 200 }),
      'Eva',
    )

    expect(message).toMatch(/500/)
    expect(message).toMatch(/200/)
  })

  it('saldo zero com pendências NÃO diz que está quitado', () => {
    const message = buildWhatsAppMessage(
      summary({ receivablePending: 500, debtPending: 500 }),
      'Eva',
    )

    expect(message).not.toMatch(/quites|nada pendente|tudo (certo|acertado)/i)
    expect(message).toMatch(/aberto/)
  })

  it('sem pendências pode comunicar quitação', () => {
    const message = buildWhatsAppMessage(summary({}), 'Eva')

    expect(message).toMatch(/nada pendente/i)
  })

  it('o texto sobrevive ao encoding de URL', () => {
    // Sem quebrar: acentos, negrito do WhatsApp e quebras de linha.
    const message = buildWhatsAppMessage(
      summary({ receivablePending: 500, debtPending: 200 }),
      'Eva',
    )
    const encoded = encodeURIComponent(message)

    expect(decodeURIComponent(encoded)).toBe(message)
    expect(encoded).not.toContain(' ')
  })
})

describe('normalizeWhatsAppPhone', () => {
  it('celular com máscara vira 13 dígitos com país', () => {
    expect(normalizeWhatsAppPhone('(85) 99999-9999')).toBe('5585999999999')
  })

  it('fixo de 10 dígitos também é aceito', () => {
    expect(normalizeWhatsAppPhone('85 3333-4444')).toBe('558533334444')
  })

  it('número que já tem +55 é preservado', () => {
    expect(normalizeWhatsAppPhone('+55 85 99999-9999')).toBe('5585999999999')
  })

  it('DDD 55 não é confundido com código do país', () => {
    /**
     * O bug encontrado por sonda na Fase 8B: o DDD 55 existe (região de Santa
     * Maria, RS). Detectar o país por `startsWith('55')` transformava
     * `(55) 99999-9999` — 11 dígitos válidos — em 9 dígitos e reprovava o
     * número. A decisão é pelo COMPRIMENTO.
     */
    expect(normalizeWhatsAppPhone('(55) 99999-9999')).toBe('5555999999999')
    expect(normalizeWhatsAppPhone('(55) 3333-4444')).toBe('555533334444')
  })

  it('número curto é rejeitado', () => {
    // Antes virava `wa.me/55123`: link silenciosamente quebrado.
    expect(normalizeWhatsAppPhone('123')).toBeNull()
  })

  it('número longo é rejeitado', () => {
    expect(normalizeWhatsAppPhone('999999999999999')).toBeNull()
  })

  it('vazio, nulo e indefinido são rejeitados', () => {
    expect(normalizeWhatsAppPhone('')).toBeNull()
    expect(normalizeWhatsAppPhone(null)).toBeNull()
    expect(normalizeWhatsAppPhone(undefined)).toBeNull()
  })

  it('caracteres extras são descartados', () => {
    expect(normalizeWhatsAppPhone('+55 (85) 9.9999-9999 ')).toBe(
      '5585999999999',
    )
  })

  it('12 ou 13 dígitos sem 55 na frente são rejeitados', () => {
    // Não é número brasileiro: gerar link seria adivinhar.
    expect(normalizeWhatsAppPhone('018599999999')).toBeNull()
  })
})
