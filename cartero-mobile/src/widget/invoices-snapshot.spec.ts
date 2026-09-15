import { describe, expect, it } from 'vitest'
import {
  INVOICES_SNAPSHOT_VERSION,
  buildInvoicesSignedOutSnapshot,
  parseInvoicesSnapshot,
} from './invoices-snapshot'

/*
  ── O que este arquivo protege ──

  O Invoices Snapshot é lido por um processo sem sessão e sem HTTP: se o
  parser aceitar algo que o backend nunca mandaria, o widget desenha um
  número inventado sem que nada em volta acuse erro.
*/

const OWNER = 'user-a'

function readySnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    version: 1,
    state: 'ready',
    generatedAt: '2026-09-15T09:00:00.000Z',
    ownerId: OWNER,
    privacy: { hideAmounts: true },
    invoices: [
      {
        bankName: 'Banco Exemplo',
        status: 'CLOSED',
        actionDate: '2026-09-20',
        ownAmountCents: 12345,
      },
    ],
    ...overrides,
  })
}

describe('S1: READY válido faz parse', () => {
  it('parseia o shape completo corretamente', () => {
    const parsed = parseInvoicesSnapshot(readySnapshot())
    expect(parsed).toEqual({
      version: 1,
      state: 'ready',
      generatedAt: '2026-09-15T09:00:00.000Z',
      ownerId: OWNER,
      privacy: { hideAmounts: true },
      invoices: [
        {
          bankName: 'Banco Exemplo',
          status: 'CLOSED',
          actionDate: '2026-09-20',
          ownAmountCents: 12345,
        },
      ],
    })
  })

  it('aceita lista vazia como READY válido (S25)', () => {
    const parsed = parseInvoicesSnapshot(readySnapshot({ invoices: [] }))
    expect(parsed).toMatchObject({ state: 'ready', invoices: [] })
  })
})

describe('S2: signedOut válido faz parse', () => {
  it('parseia o estado neutro', () => {
    const raw = JSON.stringify({
      version: 1,
      state: 'signedOut',
      generatedAt: '2026-09-15T09:00:00.000Z',
    })
    expect(parseInvoicesSnapshot(raw)).toEqual({
      version: 1,
      state: 'signedOut',
      generatedAt: '2026-09-15T09:00:00.000Z',
    })
  })

  it('não sobrevive ownerId/invoices/privacy no signedOut', () => {
    const built = buildInvoicesSignedOutSnapshot(new Date('2026-09-15T10:00:00.000Z'))
    expect(built).not.toHaveProperty('ownerId')
    expect(built).not.toHaveProperty('invoices')
    expect(built).not.toHaveProperty('privacy')
    expect(JSON.stringify(built)).not.toMatch(/Cents|bankName/)
  })
})

describe('S3: arquivo ausente é neutro/seguro', () => {
  it('null devolve null', () => {
    expect(parseInvoicesSnapshot(null)).toBeNull()
  })

  it('string vazia devolve null', () => {
    expect(parseInvoicesSnapshot('')).toBeNull()
  })
})

describe('S4: JSON corrompido é neutro/seguro', () => {
  it('JSON truncado não lança e devolve null', () => {
    expect(() => parseInvoicesSnapshot('{"version":1,"state":"rea')).not.toThrow()
    expect(parseInvoicesSnapshot('{"version":1,"state":"rea')).toBeNull()
  })

  it('array no lugar de objeto devolve null', () => {
    expect(parseInvoicesSnapshot('[1,2,3]')).toBeNull()
  })
})

describe('S5: versão desconhecida é rejeitada com segurança', () => {
  it('version=2 não é lida como V1', () => {
    const raw = readySnapshot({ version: 2 })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })

  it('version ausente é rejeitada', () => {
    const value = JSON.parse(readySnapshot())
    delete value.version
    expect(parseInvoicesSnapshot(JSON.stringify(value))).toBeNull()
  })
})

describe('S6: READY sem ownerId é inválido', () => {
  it('ownerId ausente', () => {
    const value = JSON.parse(readySnapshot())
    delete value.ownerId
    expect(parseInvoicesSnapshot(JSON.stringify(value))).toBeNull()
  })

  it('ownerId vazio', () => {
    expect(parseInvoicesSnapshot(readySnapshot({ ownerId: '' }))).toBeNull()
  })
})

describe('S7: READY com invoice malformada é inválido', () => {
  it('bankName ausente invalida o snapshot inteiro', () => {
    const raw = readySnapshot({
      invoices: [{ status: 'CLOSED', actionDate: '2026-09-20', ownAmountCents: 100 }],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })

  it('ownAmountCents não-inteiro invalida', () => {
    const raw = readySnapshot({
      invoices: [
        { bankName: 'X', status: 'OPEN', actionDate: '2026-09-20', ownAmountCents: 12.5 },
      ],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })

  it('invoices não é array', () => {
    expect(parseInvoicesSnapshot(readySnapshot({ invoices: 'não é lista' }))).toBeNull()
  })

  it('um item inválido invalida a lista inteira, não descarta só ele', () => {
    const raw = readySnapshot({
      invoices: [
        { bankName: 'Válido', status: 'OPEN', actionDate: '2026-09-20', ownAmountCents: 100 },
        { bankName: '', status: 'OPEN', actionDate: '2026-09-20', ownAmountCents: 100 },
      ],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })
})

describe('S8: status desconhecido é inválido', () => {
  it('PAID não é aceito — o backend nunca deveria mandar isso', () => {
    const raw = readySnapshot({
      invoices: [{ bankName: 'X', status: 'PAID', actionDate: '2026-09-20', ownAmountCents: 100 }],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })

  it('status arbitrário é inválido', () => {
    const raw = readySnapshot({
      invoices: [
        { bankName: 'X', status: 'QUALQUER_COISA', actionDate: '2026-09-20', ownAmountCents: 100 },
      ],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })
})

describe('S9: surface fechada — campos extras da resposta crua não entram', () => {
  it('parser ignora bankId/invoiceId/totalAmount mesmo se presentes no JSON', () => {
    const raw = JSON.stringify({
      version: 1,
      state: 'ready',
      generatedAt: '2026-09-15T09:00:00.000Z',
      ownerId: OWNER,
      privacy: { hideAmounts: true },
      invoices: [
        {
          bankName: 'Banco Exemplo',
          status: 'CLOSED',
          actionDate: '2026-09-20',
          ownAmountCents: 12345,
          // Campos que NUNCA deveriam sobreviver ao parse:
          bankId: 'bank-internal-id',
          invoiceId: 'invoice-internal-id',
          totalAmount: 999.99,
          closeDate: '2026-09-03',
          dueDate: '2026-09-20',
        },
      ],
    })

    const parsed = parseInvoicesSnapshot(raw)
    expect(parsed?.state).toBe('ready')
    if (parsed?.state !== 'ready') throw new Error('esperado ready')

    expect(Object.keys(parsed.invoices[0]).sort()).toEqual(
      ['actionDate', 'bankName', 'ownAmountCents', 'status'].sort(),
    )
    expect(parsed.invoices[0]).not.toHaveProperty('closeDate')
    expect(parsed.invoices[0]).not.toHaveProperty('dueDate')
    expect(parsed.invoices[0]).not.toHaveProperty('bankId')
    expect(parsed.invoices[0]).not.toHaveProperty('invoiceId')
    expect(parsed.invoices[0]).not.toHaveProperty('totalAmount')
  })
})

describe('civil date (§53)', () => {
  it('preserva o dia sem depender de timezone', () => {
    const raw = readySnapshot({
      invoices: [
        { bankName: 'X', status: 'OPEN', actionDate: '2026-09-01', ownAmountCents: 100 },
      ],
    })
    const parsed = parseInvoicesSnapshot(raw)
    expect(parsed?.state).toBe('ready')
    if (parsed?.state !== 'ready') throw new Error('esperado ready')
    expect(parsed.invoices[0].actionDate).toBe('2026-09-01')
  })

  it('rejeita data civilmente impossível (2026-13-40)', () => {
    const raw = readySnapshot({
      invoices: [
        { bankName: 'X', status: 'OPEN', actionDate: '2026-13-40', ownAmountCents: 100 },
      ],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })

  it('rejeita timestamp completo em vez de dia civil', () => {
    const raw = readySnapshot({
      invoices: [
        {
          bankName: 'X',
          status: 'OPEN',
          actionDate: '2026-09-01T03:00:00.000Z',
          ownAmountCents: 100,
        },
      ],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })
})

describe('version export', () => {
  it('é 1 — igual ao Budget por coincidência de número, não de schema', () => {
    expect(INVOICES_SNAPSHOT_VERSION).toBe(1)
  })
})
