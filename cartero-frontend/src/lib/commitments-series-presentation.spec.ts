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

  it('expÃµe true outstanding na summary da prÃ³pria parte', () => {
    expect(page).toContain('outstandingLabel(item.outstandingCount)')
    expect(page).toContain('item.outstandingAmount')
    expect(page).toContain('totals.installmentsOutstanding')
    expect(page).toContain('Próxima a pagar')
    expect(page).not.toContain('totals.installmentsRemaining')
    expect(page).not.toContain('em parcelas futuras ')
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
  it('preserva a copy final da pÃ¡gina e da seÃ§Ã£o prÃ³pria', () => {
    expect(page).toContain('Acompanhe suas compras parceladas,')
    expect(page).toContain('o que ainda falta pagar e o impacto nos ')
    expect(page).toContain('title="Parcelas em aberto"')
    expect(page).toContain('formatCurrency(total)} em aberto')
    expect(page).toContain('outstandingLabel(item.outstandingCount)')
  })

  it('permite wrap mobile na metadata principal sem remover a metadata', () => {
    expect(page).toContain('break-words text-[11px] leading-4 text-muted-foreground md:truncate')
    expect(page).toContain('formatCurrency(next.amount)')
    expect(page).toContain('monthLabel(next)')
    expect(page).not.toContain('truncate text-[11px] text-muted-foreground')
  })
})
