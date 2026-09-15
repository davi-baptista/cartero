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

  M6.2: o item persistido tem exatamente 4 campos — bankName, status,
  actionDate, totalAmountCents. `ownAmountCents` chega do backend (que expõe
  os dois valores), mas nunca sobrevive ao parse: é tratado como qualquer
  outro campo interno (bankId, closeDate, dueDate) que este arquivo já
  descartava.
*/

const OWNER = 'user-a'

function readySnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    version: 2,
    state: 'ready',
    generatedAt: '2026-09-15T09:00:00.000Z',
    ownerId: OWNER,
    privacy: { hideAmounts: true },
    invoices: [
      {
        bankName: 'Banco Exemplo',
        status: 'CLOSED',
        actionDate: '2026-09-20',
        totalAmountCents: 22345,
      },
    ],
    ...overrides,
  })
}

describe('S1: READY válido faz parse', () => {
  it('parseia o shape completo corretamente', () => {
    const parsed = parseInvoicesSnapshot(readySnapshot())
    expect(parsed).toEqual({
      version: 2,
      state: 'ready',
      generatedAt: '2026-09-15T09:00:00.000Z',
      ownerId: OWNER,
      privacy: { hideAmounts: true },
      invoices: [
        {
          bankName: 'Banco Exemplo',
          status: 'CLOSED',
          actionDate: '2026-09-20',
          totalAmountCents: 22345,
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
      version: 2,
      state: 'signedOut',
      generatedAt: '2026-09-15T09:00:00.000Z',
    })
    expect(parseInvoicesSnapshot(raw)).toEqual({
      version: 2,
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
  it('version=1 (formato pré-M6.2, sem totalAmountCents) não é lida como V2', () => {
    const raw = readySnapshot({ version: 1 })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })

  it('version=3 (futura, desconhecida) não é lida como V2', () => {
    const raw = readySnapshot({ version: 3 })
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
      invoices: [{ status: 'CLOSED', actionDate: '2026-09-20', totalAmountCents: 100 }],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })

  it('totalAmountCents ausente invalida (M6.2: único campo monetário, obrigatório na V2)', () => {
    const raw = readySnapshot({
      invoices: [{ bankName: 'X', status: 'OPEN', actionDate: '2026-09-20' }],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })

  it('totalAmountCents não-inteiro invalida', () => {
    const raw = readySnapshot({
      invoices: [
        { bankName: 'X', status: 'OPEN', actionDate: '2026-09-20', totalAmountCents: 12.5 },
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
        { bankName: 'Válido', status: 'OPEN', actionDate: '2026-09-20', totalAmountCents: 100 },
        { bankName: '', status: 'OPEN', actionDate: '2026-09-20', totalAmountCents: 100 },
      ],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })
})

describe('S8: status desconhecido é inválido', () => {
  it('PAID não é aceito — o backend nunca deveria mandar isso', () => {
    const raw = readySnapshot({
      invoices: [
        { bankName: 'X', status: 'PAID', actionDate: '2026-09-20', totalAmountCents: 100 },
      ],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })

  it('status arbitrário é inválido', () => {
    const raw = readySnapshot({
      invoices: [
        {
          bankName: 'X',
          status: 'QUALQUER_COISA',
          actionDate: '2026-09-20',
          totalAmountCents: 100,
        },
      ],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })
})

describe('S9: surface fechada — campos extras da resposta crua não entram', () => {
  it('parser ignora bankId/invoiceId/closeDate/dueDate/totalAmount mesmo se presentes no JSON', () => {
    const raw = JSON.stringify({
      version: 2,
      state: 'ready',
      generatedAt: '2026-09-15T09:00:00.000Z',
      ownerId: OWNER,
      privacy: { hideAmounts: true },
      invoices: [
        {
          bankName: 'Banco Exemplo',
          status: 'CLOSED',
          actionDate: '2026-09-20',
          totalAmountCents: 22345,
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
      ['actionDate', 'bankName', 'totalAmountCents', 'status'].sort(),
    )
    expect(parsed.invoices[0]).not.toHaveProperty('closeDate')
    expect(parsed.invoices[0]).not.toHaveProperty('dueDate')
    expect(parsed.invoices[0]).not.toHaveProperty('bankId')
    expect(parsed.invoices[0]).not.toHaveProperty('invoiceId')
    expect(parsed.invoices[0]).not.toHaveProperty('totalAmount')
  })
})

describe('S10 (M6.2): ownAmountCents nunca sobrevive ao parse, mesmo presente no JSON bruto', () => {
  it('item com ownAmountCents no raw JSON não o propaga ao snapshot parseado', () => {
    const raw = JSON.stringify({
      version: 2,
      state: 'ready',
      generatedAt: '2026-09-15T09:00:00.000Z',
      ownerId: OWNER,
      privacy: { hideAmounts: true },
      invoices: [
        {
          bankName: 'Banco Exemplo',
          status: 'CLOSED',
          actionDate: '2026-09-20',
          totalAmountCents: 100000,
          // Valor DIFERENTE de totalAmountCents, para que a presença
          // acidental do campo seja observável e não coincidência numérica.
          ownAmountCents: 70000,
        },
      ],
    })

    const parsed = parseInvoicesSnapshot(raw)
    expect(parsed?.state).toBe('ready')
    if (parsed?.state !== 'ready') throw new Error('esperado ready')

    // Mutation guard (F1): se o parser voltar a persistir ownAmountCents,
    // esta asserção de chaves falha primeiro.
    expect(Object.keys(parsed.invoices[0]).sort()).toEqual(
      ['actionDate', 'bankName', 'totalAmountCents', 'status'].sort(),
    )
    expect(parsed.invoices[0]).not.toHaveProperty('ownAmountCents')
    expect(JSON.stringify(parsed)).not.toContain('ownAmountCents')
    expect(parsed.invoices[0].totalAmountCents).toBe(100000)
  })
})

describe('civil date (§53)', () => {
  it('preserva o dia sem depender de timezone', () => {
    const raw = readySnapshot({
      invoices: [
        { bankName: 'X', status: 'OPEN', actionDate: '2026-09-01', totalAmountCents: 100 },
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
        { bankName: 'X', status: 'OPEN', actionDate: '2026-13-40', totalAmountCents: 100 },
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
          totalAmountCents: 100,
        },
      ],
    })
    expect(parseInvoicesSnapshot(raw)).toBeNull()
  })
})

describe('version export', () => {
  it('é 2 — M6.2 trocou ownAmountCents por totalAmountCents, mudança de FORMA', () => {
    expect(INVOICES_SNAPSHOT_VERSION).toBe(2)
  })
})
