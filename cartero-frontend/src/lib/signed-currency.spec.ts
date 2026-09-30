import { describe, expect, it } from 'vitest'
import { formatCurrency, formatSignedCurrency } from './formatters'

describe('signed currency used by financial histories', () => {
  it('preserves Person History hyphen-minus and Income History plus sign', () => {
    expect(formatSignedCurrency(250, 'out')).toBe(`-${formatCurrency(250)}`)
    expect(formatSignedCurrency(250, 'in')).toBe(`+${formatCurrency(250)}`)
  })
})
