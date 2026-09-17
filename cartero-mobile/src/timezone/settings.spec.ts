import { describe, expect, it } from 'vitest'
import { acknowledgeOnce, mismatchKey } from './settings'

describe('mobile timezone acknowledgement', () => {
  it('acknowledges one exact mismatch and allows a new pair', async () => {
    const values = new Map<string, string>()
    const store = {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => { values.set(key, value) },
    }
    expect(await acknowledgeOnce(store, 'a', 'America/Fortaleza', 'Europe/Lisbon')).toBe(true)
    expect(await acknowledgeOnce(store, 'a', 'America/Fortaleza', 'Europe/Lisbon')).toBe(false)
    expect(await acknowledgeOnce(store, 'b', 'America/Fortaleza', 'Europe/Lisbon')).toBe(true)
    expect(values.has(mismatchKey('a', 'America/Fortaleza', 'Europe/Lisbon'))).toBe(true)
  })
})
