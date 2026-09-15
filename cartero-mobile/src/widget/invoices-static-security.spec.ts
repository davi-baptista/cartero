import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildInvoicesSignedOutSnapshot,
  parseInvoicesSnapshot,
} from './invoices-snapshot'

/*
  ── §61: o que o Invoices Snapshot NÃO pode conter ──

  O arquivo é lido por um processo sem sessão. Cada campo além do mínimo é
  superfície permanente para uma vulnerabilidade futura, em troca de nada —
  o consumidor (M6) precisa só de bankName/status/actionDate/ownAmountCents.
*/

describe('§61: campos proibidos nunca sobrevivem ao parser', () => {
  const rawWithEverything = JSON.stringify({
    version: 1,
    state: 'ready',
    generatedAt: '2026-09-15T09:00:00.000Z',
    ownerId: 'user-a',
    privacy: { hideAmounts: true },
    invoices: [
      {
        bankName: 'Banco Exemplo',
        status: 'CLOSED',
        actionDate: '2026-09-20',
        ownAmountCents: 12345,
        // Tudo que NÃO deveria sobreviver:
        invoiceId: 'invoice-1',
        bankId: 'bank-1',
        userId: 'user-a',
        month: 9,
        year: 2026,
        closeDate: '2026-09-03',
        dueDate: '2026-09-20',
        totalAmount: 999.99,
        reimbursable: 100,
        accessToken: 'tok_abc',
        refreshToken: 'ref_abc',
        Authorization: 'Bearer tok_abc',
        email: 'user@example.com',
        password: 'hunter2',
        transactions: [{ id: 'tx-1', description: 'compra' }],
        installments: 3,
        people: ['fulano'],
      },
    ],
  })

  it('parser ignora todos os campos extras e devolve só os 4 aprovados', () => {
    const parsed = parseInvoicesSnapshot(rawWithEverything)
    expect(parsed?.state).toBe('ready')
    if (parsed?.state !== 'ready') throw new Error('esperado ready')

    const keys = Object.keys(parsed.invoices[0]).sort()
    expect(keys).toEqual(['actionDate', 'bankName', 'ownAmountCents', 'status'].sort())
  })

  it('nenhum valor sensível sobrevive na serialização do snapshot resultante', () => {
    const parsed = parseInvoicesSnapshot(rawWithEverything)
    const serialized = JSON.stringify(parsed)

    for (const proibido of [
      'accessToken',
      'refreshToken',
      'Authorization',
      'Bearer',
      'email',
      'password',
      'hunter2',
      'transactions',
      'installments',
      'people',
      'invoiceId',
      'bankId',
      'userId',
      'closeDate',
      'dueDate',
      'totalAmount',
      'reimbursable',
      'user@example.com',
      'tok_abc',
    ]) {
      expect(serialized, `serializado contém "${proibido}"`).not.toContain(proibido)
    }
  })

  it('ownerId top-level PERMANECE — necessário para account binding', () => {
    const parsed = parseInvoicesSnapshot(rawWithEverything)
    expect(parsed?.state).toBe('ready')
    if (parsed?.state !== 'ready') throw new Error('esperado ready')
    expect(parsed.ownerId).toBe('user-a')
  })
})

describe('signedOut não carrega nada sensível', () => {
  it('build do estado neutro não tem ownerId nem invoices', () => {
    const built = buildInvoicesSignedOutSnapshot()
    const serialized = JSON.stringify(built)
    expect(serialized).not.toMatch(/ownerId|invoices|privacy|Cents/)
  })
})

/*
  ── N1-N8: superfície nativa do slot de Invoices ──

  Mesmo padrão de `widget-surface.spec.ts`: provar o que o código Kotlin PODE
  e NÃO PODE alcançar, porque uma regressão aqui não muda nenhuma saída de
  teste de comportamento — só abre uma porta que nada mais detecta sozinho.
*/

const NATIVE_ROOT = join(
  import.meta.dirname,
  '..',
  '..',
  'modules',
  'cartero-widget-snapshot',
  'android',
  'src',
  'main',
)

const moduleSource = readFileSync(
  join(NATIVE_ROOT, 'java', 'app', 'cartero', 'widgetsnapshot', 'CarteroWidgetSnapshotModule.kt'),
  'utf-8',
)

describe('N1-N8: módulo nativo — slot de Invoices', () => {
  it('N1: existe um path fixo para invoices, dentro do mesmo widgetDirectory (noBackupFilesDir)', () => {
    expect(moduleSource).toContain('INVOICES_FILE = "invoices-v1.json"')
    expect(moduleSource).toContain('File(widgetDirectory(), INVOICES_FILE)')
  })

  it('N2: writeInvoices e readInvoices existem como funções próprias', () => {
    expect(moduleSource).toContain('AsyncFunction("writeInvoices")')
    expect(moduleSource).toContain('AsyncFunction("readInvoices")')
  })

  it('N3: writeInvoices usa a MESMA escrita atômica compartilhada', () => {
    expect(moduleSource).toMatch(
      /writeInvoices[\s\S]{0,150}writeAtomically\(invoicesFile\(\)/,
    )
  })

  it('N4: o path do Budget (snapshot-v1.json) permanece inalterado', () => {
    expect(moduleSource).toContain('SNAPSHOT_FILE = "snapshot-v1.json"')
  })

  it('N5: o path da privacidade (privacy-v1.json) permanece inalterado', () => {
    expect(moduleSource).toContain('PRIVACY_FILE = "privacy-v1.json"')
  })

  it('N6: nenhuma API de path arbitrário — writeInvoices não aceita filename do chamador', () => {
    // A assinatura de AsyncFunction("writeInvoices") só recebe `contents:
    // String`; não há um segundo parâmetro de nome de arquivo em lugar
    // nenhum do módulo.
    const start = moduleSource.indexOf('AsyncFunction("writeInvoices")')
    const nextFn = moduleSource.indexOf('AsyncFunction("readInvoices")', start)
    const body = moduleSource.slice(start, nextFn)

    expect(body).not.toMatch(/filename|path\s*:\s*String|fileName/)
  })

  it('N7: readAtomically/writeAtomically preservam last-good em falha (mesma abstração N3 já prova ser usada)', () => {
    expect(moduleSource).toContain('atomic.failWrite(stream)')
  })

  it('N8: nenhuma chamada de updateAll para um widget de Invoices que ainda não existe', () => {
    const start = moduleSource.indexOf('AsyncFunction("writeInvoices")')
    const nextFn = moduleSource.indexOf('AsyncFunction("readInvoices")', start)
    const body = moduleSource.slice(start, nextFn)

    expect(body).not.toMatch(/updateAll|requestWidgetRefresh/)
  })
})
