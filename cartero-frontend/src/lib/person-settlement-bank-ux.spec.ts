import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const SETTLE = read('src/app/(dashboard)/persons/settle-person-dialog.tsx')
const MARK = read('src/app/(dashboard)/transactions/mark-as-paid-dialog.tsx')

describe('optional bank progressive disclosure', () => {
  it.each([
    ['person settlement', SETTLE],
    ['mark as paid', MARK],
  ])('%s keeps the collapsed state quiet', (_name, source) => {
    expect(source).toContain('Adicionar banco (opcional)')
    expect(source).not.toContain('Sem banco')
  })

  it('person settlement expands and can remove before selecting a bank', () => {
    expect(SETTLE).toContain('needsBankSelector')
    expect(SETTLE).toContain('Selecione um banco')
    expect(SETTLE).toContain('Remover banco')
    expect(SETTLE).toContain("setBankId(undefined); setShowOptionalBank(false)")
  })

  it('mark-as-paid expands and can remove before selecting a bank', () => {
    expect(MARK).toContain('showOptionalBank')
    expect(MARK).toContain('Selecione um banco')
    expect(MARK).toContain('Remover banco')
    expect(MARK).toContain("setBankId(''); setShowOptionalBank(false)")
  })

  it('credit remains required and never uses the optional affordance', () => {
    expect(SETTLE).toContain('(!isCredit || Boolean(bankId))')
    expect(MARK).toContain('bankRequired = createTransaction')
    expect(MARK).toContain("type === TransactionType.CREDIT_CARD")
    expect(MARK).toContain("type !== TransactionType.CREDIT_CARD")
  })

  it('zero-net settlement has no bank affordance', () => {
    expect(SETTLE).toContain("direction === 'inflow'")
    expect(SETTLE).toContain("direction === 'outflow'")
    expect(SETTLE).toContain("direction = net > 0 ? 'inflow' : net < 0 ? 'outflow' : 'none'")
  })
})
