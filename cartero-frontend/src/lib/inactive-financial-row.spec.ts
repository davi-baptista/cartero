import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')

const ROW = read('../components/ui/financial-list-row.tsx')
const PERSONS = read('../app/(dashboard)/persons/page.tsx')
const BANKS = read('../app/(dashboard)/banks/page.tsx')

describe('inactive financial row authority', () => {
  it('owns the stronger muted shell, avatar and trailing tokens', () => {
    expect(ROW).toContain('ROW_INACTIVE_ROW_CLASS')
    expect(ROW).toContain('text-muted-foreground hover:bg-transparent')
    expect(ROW).toContain('ROW_INACTIVE_AVATAR_CLASS')
    expect(ROW).toContain('ROW_INACTIVE_TRAILING_CLASS')
    expect(ROW).not.toContain('opacity-40')
    expect(ROW).not.toContain('opacity-50')
  })

  it('both lists consume the shared inactive variant', () => {
    expect(PERSONS).toContain('inactive={isEmpty}')
    expect(PERSONS).toContain('ROW_INACTIVE_AVATAR_CLASS')
    expect(PERSONS).toContain('ROW_INACTIVE_TRAILING_CLASS')
    expect(BANKS).toContain('inactive={invoice === null}')
    expect(BANKS).toContain('ROW_INACTIVE_AVATAR_CLASS')
    expect(BANKS).toContain('ROW_INACTIVE_TRAILING_CLASS')
  })

  it('active rows keep their existing interactive path', () => {
    expect(PERSONS).toContain('interactive={!isEmpty}')
    expect(BANKS).toContain('interactive={invoice !== null}')
    expect(ROW).toContain('interactive && !inactive')
  })
})
