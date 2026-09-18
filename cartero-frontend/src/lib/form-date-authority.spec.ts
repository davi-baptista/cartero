import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { accountToday } from './date'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ Legacy Removal V1.2 — data padrão de NOVOS registros financeiros
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O gate final de release encontrou três formulários (dívida, cobrança,
 * transação) cujo valor padrão de data para um registro NOVO vinha do
 * relógio do navegador (`formatDateValue()`/`new Date()`), não da timezone
 * da conta. Boundary observado ao vivo: conta America/Fortaleza + device
 * America/Manaus, no instante em que Fortaleza já virou o dia mas Manaus
 * ainda não — "Nova dívida" pré-preenchia o dia ANTERIOR.
 *
 * Estes componentes não têm suíte de render (Fase 10: só lógica pura, sem
 * jsdom/Testing Library) — a prova aqui é estrutural sobre o código-fonte,
 * como `account-today.spec.ts`/`bank-edit-drawer.spec.ts` já fazem.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8').replace(/\r\n/g, '\n')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DEBT_SHEET = semComentarios(ler('../app/(dashboard)/debts/debt-sheet.tsx'))
const RECEIVABLE_SHEET = semComentarios(
  ler('../app/(dashboard)/receivables/receivable-sheet.tsx'),
)
const TRANSACTION_SHEET = semComentarios(
  ler('../app/(dashboard)/transactions/transaction-sheet.tsx'),
)

// 01/09/2026 03:30 UTC: Fortaleza (UTC-3) já é 01/09 00h30 (novo mês);
// Manaus (UTC-4) ainda é 31/08 23h30 (mês anterior).
const BOUNDARY = new Date('2026-09-01T03:30:00.000Z')
// 16/09/2026 15:30 UTC: Fortaleza (UTC-3) é 16/09 12h30; Tóquio (UTC+9) já é
// 17/09 00h30 — dia seguinte no mesmo instante (mesmo par usado em
// account-today.spec.ts).
const TOKYO_BOUNDARY = new Date('2026-09-16T15:30:00.000Z')

describe('T1/T7/P1: dívida — data padrão de registro NOVO usa a timezone da conta', () => {
  it('T1: America/Fortaleza vs. device America/Manaus — segue Fortaleza', () => {
    expect(accountToday('America/Fortaleza', BOUNDARY)).toBe('2026-09-01')
    expect(accountToday('America/Manaus', BOUNDARY)).toBe('2026-08-31')
  })

  it('T7: timezone da conta diferente de Fortaleza — o padrão segue ela mesma', () => {
    expect(accountToday('Asia/Tokyo', TOKYO_BOUNDARY)).not.toBe(
      accountToday('America/Fortaleza', TOKYO_BOUNDARY),
    )
  })

  it('DEBT_SHEET usa accountToday(timeZone) para registro NOVO, nunca formatDateValue/new Date', () => {
    const bloco = DEBT_SHEET.slice(
      DEBT_SHEET.indexOf("setCreditorMode(initialPersonId"),
      DEBT_SHEET.indexOf('}, [open, editTarget, initialPersonId, timeZone, reset])'),
    )
    expect(bloco).toContain('occurredAt: accountToday(timeZone)')
  })

  it('P1: restaurar formatDateValue()/new Date() no ramo de criação derrubaria este teste', () => {
    expect(DEBT_SHEET).not.toContain('occurredAt: formatDateValue()')
    expect(DEBT_SHEET).not.toContain("import { formatDateValue } from '@/lib/date'")
  })
})

describe('T2/P2: cobrança — data padrão de registro NOVO usa a timezone da conta', () => {
  it('RECEIVABLE_SHEET usa accountToday(timeZone) para registro NOVO, nunca formatDateValue/new Date', () => {
    const bloco = RECEIVABLE_SHEET.slice(
      RECEIVABLE_SHEET.indexOf('setDebtorMode(initialPersonId'),
      RECEIVABLE_SHEET.indexOf('}, [open, editTarget, initialPersonId, timeZone, reset])'),
    )
    expect(bloco).toContain('occurredAt: accountToday(timeZone)')
  })

  it('P2: restaurar formatDateValue()/new Date() no ramo de criação derrubaria este teste', () => {
    expect(RECEIVABLE_SHEET).not.toContain('occurredAt: formatDateValue()')
    expect(RECEIVABLE_SHEET).not.toContain("import { formatDateValue } from '@/lib/date'")
  })
})

describe('T3/P3: transação — data padrão de registro NOVO usa a timezone da conta', () => {
  it('TRANSACTION_SHEET usa createDefaults?.date ?? accountToday(timeZone), nunca formatDateValue/new Date', () => {
    const bloco = TRANSACTION_SHEET.slice(
      TRANSACTION_SHEET.indexOf('reset({\n          bankId: createDefaults'),
      TRANSACTION_SHEET.indexOf('personId: undefined,\n        })\n      }\n    }'),
    )
    expect(bloco).toContain('date: createDefaults?.date ?? accountToday(timeZone)')
  })

  it('P3: restaurar formatDateValue()/new Date() no ramo de criação derrubaria este teste', () => {
    expect(TRANSACTION_SHEET).not.toContain('date: createDefaults?.date ?? formatDateValue()')
    expect(TRANSACTION_SHEET).not.toContain(
      "import { formatDateValue } from '@/lib/date'",
    )
  })

  it('createDefaults?.date explícito (ex.: origem de uma fatura) continua tendo prioridade', () => {
    // O contexto (mês da fatura) não pode ser substituído pelo "hoje" da conta.
    expect(TRANSACTION_SHEET).toContain('createDefaults?.date ?? accountToday(timeZone)')
  })
})

describe('T4/T5/T6: edição preserva a data persistida, sem tocar em accountToday', () => {
  it('T4: DEBT_SHEET em edição usa editTarget.occurredAt intacto', () => {
    const bloco = DEBT_SHEET.slice(
      DEBT_SHEET.indexOf('if (editTarget) {'),
      DEBT_SHEET.indexOf('} else {'),
    )
    expect(bloco).toContain('occurredAt: editTarget.occurredAt')
    expect(bloco).not.toContain('accountToday')
  })

  it('T5: RECEIVABLE_SHEET em edição usa editTarget.occurredAt intacto', () => {
    const bloco = RECEIVABLE_SHEET.slice(
      RECEIVABLE_SHEET.indexOf('if (editTarget) {'),
      RECEIVABLE_SHEET.indexOf('} else {'),
    )
    expect(bloco).toContain('occurredAt: editTarget.occurredAt')
    expect(bloco).not.toContain('accountToday')
  })

  it('T6: TRANSACTION_SHEET em edição usa editTarget.date intacto', () => {
    const bloco = TRANSACTION_SHEET.slice(
      TRANSACTION_SHEET.indexOf('if (editTarget) {\n        reset({'),
      TRANSACTION_SHEET.indexOf('} else {\n        reset({'),
    )
    expect(bloco).toContain('date: editTarget.date')
    expect(bloco).not.toContain('accountToday')
  })
})

describe('T8/P4: device timezone nunca vira authority financeira nestes três formulários', () => {
  it('T8: accountToday ignora o relógio local do processo — só o timeZone explícito decide', () => {
    // Mesmo instante, duas timezones de conta diferentes → resultados
    // diferentes; trocar só o "device" (não exercitado aqui, pois os
    // helpers nunca recebem device timezone) não pode influenciar o valor.
    const fortaleza = accountToday('America/Fortaleza', TOKYO_BOUNDARY)
    const tokyo = accountToday('Asia/Tokyo', TOKYO_BOUNDARY)
    expect(fortaleza).toBe('2026-09-16')
    expect(tokyo).not.toBe(fortaleza)
  })

  it('P4: nenhum dos três sheets lê Intl.DateTimeFormat().resolvedOptions() ou navigator diretamente', () => {
    for (const sheet of [DEBT_SHEET, RECEIVABLE_SHEET, TRANSACTION_SHEET]) {
      expect(sheet).not.toContain('resolvedOptions()')
      expect(sheet).not.toContain('navigator.')
    }
  })

  it('nenhum dos três sheets tem um fallback oculto para America/Fortaleza/UTC', () => {
    for (const sheet of [DEBT_SHEET, RECEIVABLE_SHEET, TRANSACTION_SHEET]) {
      expect(sheet).not.toContain("timeZone ?? 'America/Fortaleza'")
      expect(sheet).not.toContain('timeZone ?? \'UTC\'')
    }
  })
})
