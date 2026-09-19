import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const registerPage = readFileSync(
  resolve(__dirname, '../app/(auth)/register/page.tsx'),
  'utf8',
)

describe('registration timezone UI', () => {
  it('starts detection without rendering the fallback selector', () => {
    expect(registerPage).toContain("useState<'detecting' | 'detected' | 'failed'>('detecting')")
    expect(registerPage).toContain("detectionState === 'failed'")
    expect(registerPage).toContain("detectionState === 'detected'")
    expect(registerPage).toContain("disabled={isSubmitting || detectionState === 'detecting'}")
  })

  it('submits the detected timezone and never introduces a silent geographic fallback', () => {
    expect(registerPage).toContain('const registrationTimeZone = detectedTimeZone ?? values.timeZone')
    expect(registerPage).toContain("registerService(values.name, values.email, values.password, registrationTimeZone)")
    expect(registerPage).not.toContain("America/Sao_Paulo")
    expect(registerPage).not.toContain("America/Fortaleza")
    expect(registerPage).not.toContain("'UTC'")
  })
})
