import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const page = readFileSync(
  resolve(__dirname, '../app/(dashboard)/commitments/page.tsx'),
  'utf8',
)

describe('Parcelas — posição estrutural da série', () => {
  it('apresenta a próxima posição X/Y com metadata estrutural', () => {
    expect(page).toContain('Próxima ${next.index}/${item.totalCount}')
    expect(page).toContain('next.index} de {item.totalCount}')
    expect(page).not.toContain('pagas')
    expect(page).not.toContain('faltam pagar')
  })

  it('usa amount e competência da próxima occurrence real', () => {
    expect(page).toContain('formatCurrency(next.amount)')
    expect(page).toContain('monthLabel(next)')
    expect(page).not.toContain('installmentAmount')
  })

  it('preserva wording singular/plural para futureCount', () => {
    expect(page).toContain("count === 1 ? '' : 's'")
    expect(page).toContain('futureLabel(item.futureCount)')
    expect(page).not.toContain('não pagas')
    expect(page).not.toContain('saldo devedor')
  })

  it('calcula barra como posição original anterior à próxima occurrence', () => {
    expect(page).toContain('((next.index - 1) / item.totalCount) * 100')
    expect(page).toContain('aria-hidden')
    expect(page).toContain('Posição da série: próxima parcela')
    expect(page).not.toContain('role="progressbar"')
  })

  it('mantém o mês final condicional ao read model', () => {
    expect(page).toContain('item.endsAt && ` · termina ${monthLabel(item.endsAt)}`')
  })
})
