import { describe, expect, it } from 'vitest'
import {
  monthName,
  nextEntryAfter,
  propagationNotice,
  sortedHistory,
} from './salary-history-view'
import type { SalaryHistoryEntry } from '@/services/salary.service'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Histórico salarial — listagem e aviso de propagação
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Cada entrada vale a partir da sua competência até a PRÓXIMA entrada real.
 * O aviso existe porque essa herança é invisível na lista: quem vê
 * "Janeiro · R$ 4.500" não tem como saber que corrigir janeiro muda também
 * fevereiro e março.
 */

const JAN: SalaryHistoryEntry = {
  id: 'e-jan',
  year: 2026,
  month: 1,
  amount: 4500,
}
const ABR: SalaryHistoryEntry = {
  id: 'e-abr',
  year: 2026,
  month: 4,
  amount: 5000,
}
const AGO: SalaryHistoryEntry = {
  id: 'e-ago',
  year: 2026,
  month: 8,
  amount: 5500,
}

/** A trilha do enunciado, em ordem embaralhada de propósito. */
const TRILHA = [ABR, AGO, JAN]

describe('sortedHistory', () => {
  it('ordena do mais recente para o mais antigo', () => {
    expect(sortedHistory(TRILHA).map((entry) => entry.month)).toEqual([8, 4, 1])
  })

  it('ordena entre anos', () => {
    const doisAnos = [
      { id: 'a', year: 2025, month: 11, amount: 4000 },
      { id: 'b', year: 2026, month: 2, amount: 4200 },
      { id: 'c', year: 2025, month: 3, amount: 3800 },
    ]
    expect(
      sortedHistory(doisAnos).map((entry) => `${entry.year}-${entry.month}`),
    ).toEqual(['2026-2', '2025-11', '2025-3'])
  })

  it('não altera o array recebido', () => {
    const original = [...TRILHA]
    sortedHistory(TRILHA)
    expect(TRILHA).toEqual(original)
  })

  it('lista vazia continua vazia', () => {
    expect(sortedHistory([])).toEqual([])
  })
})

describe('nextEntryAfter', () => {
  it('encontra a próxima alteração real', () => {
    expect(nextEntryAfter(JAN, TRILHA)?.month).toBe(4)
  })

  it('pula meses herdados — eles não são registros', () => {
    /*
      Fevereiro e março existem para o resolver, mas não como linha. A próxima
      entrada depois de janeiro é ABRIL, não fevereiro.
    */
    const proxima = nextEntryAfter(JAN, TRILHA)
    expect(proxima?.month).not.toBe(2)
    expect(proxima?.month).toBe(4)
  })

  it('a entrada mais recente não tem próxima', () => {
    expect(nextEntryAfter(AGO, TRILHA)).toBeNull()
  })

  it('atravessa a virada de ano', () => {
    const dez = { id: 'dez', year: 2025, month: 12, amount: 4000 }
    const jan = { id: 'jan27', year: 2026, month: 1, amount: 4500 }
    expect(nextEntryAfter(dez, [dez, jan])?.id).toBe('jan27')
  })
})

describe('propagationNotice', () => {
  it('com próxima alteração, nomeia o intervalo fechado', () => {
    const texto = propagationNotice(JAN, TRILHA)

    expect(texto).toContain('de janeiro')
    expect(texto).toContain('até a próxima alteração registrada em abril')
    // Não pode sugerir vigência indefinida quando abril existe.
    expect(texto).not.toContain('em diante')
  })

  it('sem próxima alteração, o intervalo é aberto', () => {
    const texto = propagationNotice(AGO, TRILHA)

    expect(texto).toContain('de agosto em diante')
    expect(texto).toContain('até uma nova alteração salarial')
    /*
      Nenhuma data final inventada: não existe fim conhecido, e afirmar um
      ("até dezembro") seria um fato que ninguém registrou.
    */
    expect(texto).not.toContain('dezembro')
  })

  it('entrada única vale de sempre em diante', () => {
    expect(propagationNotice(JAN, [JAN])).toContain('em diante')
  })

  it('inclui o ano quando a próxima está em outro', () => {
    // "de dezembro até a próxima alteração em janeiro" seria ambíguo.
    const dez = { id: 'dez', year: 2025, month: 12, amount: 4000 }
    const jan = { id: 'jan', year: 2026, month: 1, amount: 4500 }

    expect(propagationNotice(dez, [dez, jan])).toContain('janeiro de 2026')
  })

  it('omite o ano quando a próxima está no mesmo', () => {
    expect(propagationNotice(JAN, TRILHA)).not.toContain('de 2026')
  })
})

describe('monthName', () => {
  it('cobre os doze meses em português', () => {
    expect(monthName(1)).toBe('janeiro')
    expect(monthName(3)).toBe('março')
    expect(monthName(12)).toBe('dezembro')
  })
})
