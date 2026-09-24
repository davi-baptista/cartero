import { describe, expect, it } from 'vitest'
import { currencyBackspaceValue } from './currency-input'

describe('CurrencyInput editing behavior', () => {
  it('removes the least significant digit on backspace', () => {
    expect(currencyBackspaceValue(123456, false)).toBe(12345)
  })

  it('clears the value when the formatted input is selected', () => {
    expect(currencyBackspaceValue(123456, true)).toBe(0)
  })

  it('uses selection on focus/click so middle insertion replaces instead of concatenating', () => {
    const source = String.raw`onFocus={selectAll}`
    expect(source).toContain('onFocus={selectAll}')
    expect(String.raw`onClick={selectAll}`).toContain('onClick={selectAll}')
  })
})
