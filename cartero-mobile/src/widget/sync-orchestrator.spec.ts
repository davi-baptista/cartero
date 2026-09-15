import { describe, expect, it, vi } from 'vitest'
import { syncWidgetSnapshots } from './sync-orchestrator'
import { SnapshotSync } from './snapshot-sync'
import { InvoicesSync } from './invoices-sync'
import type { SnapshotStore } from '../../modules/cartero-widget-snapshot/src'

/*
  ── O que este arquivo protege ──

  A authority que os triggers do app chamam. A propriedade central: uma
  falha de Budget ou de Invoices nunca pode derrubar o outro, e nenhuma das
  duas pode derrubar a sessão — snapshot sync é sempre side effect resiliente.
*/

function createStore() {
  let snap: string | null = null
  let inv: string | null = null
  let priv: string | null = null

  const store: SnapshotStore = {
    write: vi.fn(async (v: string) => {
      snap = v
    }),
    read: vi.fn(async () => snap),
    writePrivacy: vi.fn(async (v: string) => {
      priv = v
    }),
    readPrivacy: vi.fn(async () => priv),
    writeInvoices: vi.fn(async (v: string) => {
      inv = v
    }),
    readInvoices: vi.fn(async () => inv),
    refreshWidget: vi.fn(async () => {}),
    location: vi.fn(async () => '/no_backup/cartero-widget/snapshot-v1.json'),
  }

  return store
}

describe('S46/S47: isolamento de falha entre Budget e Invoices', () => {
  it('Budget sucesso + Invoices falha: Budget é persistido mesmo assim', async () => {
    const store = createStore()

    const budget = new SnapshotSync({
      store,
      fetchBudget: async () => ({ totalToPay: 100, totalPaid: 50, totalPending: 50 }),
      currentOwnerId: () => 'user-a',
      now: () => new Date('2026-09-15T12:00:00.000Z'),
    })

    const invoices = new InvoicesSync({
      store,
      fetchActionableInvoices: async () => {
        throw new Error('502')
      },
      currentOwnerId: () => 'user-a',
      now: () => new Date('2026-09-15T12:00:00.000Z'),
    })

    await syncWidgetSnapshots({ budget, invoices })

    expect(store.write).toHaveBeenCalled()
  })

  it('Invoices sucesso + Budget falha: Invoices é persistido mesmo assim', async () => {
    const store = createStore()

    const budget = new SnapshotSync({
      store,
      fetchBudget: async () => {
        throw new Error('502')
      },
      currentOwnerId: () => 'user-a',
      now: () => new Date('2026-09-15T12:00:00.000Z'),
    })

    const invoices = new InvoicesSync({
      store,
      fetchActionableInvoices: async () => ({ items: [] }),
      currentOwnerId: () => 'user-a',
      now: () => new Date('2026-09-15T12:00:00.000Z'),
    })

    await syncWidgetSnapshots({ budget, invoices })

    expect(store.writeInvoices).toHaveBeenCalled()
  })

  it('S48: os dois falham, mas a chamada ao orquestrador não rejeita (auth continua)', async () => {
    const store = createStore()

    const budget = new SnapshotSync({
      store,
      fetchBudget: async () => {
        throw new Error('offline')
      },
      currentOwnerId: () => 'user-a',
    })

    const invoices = new InvoicesSync({
      store,
      fetchActionableInvoices: async () => {
        throw new Error('offline')
      },
      currentOwnerId: () => 'user-a',
    })

    await expect(syncWidgetSnapshots({ budget, invoices })).resolves.toBeUndefined()
  })

  it('não usa Promise.all de um jeito que uma rejeição derrube a outra chamada', async () => {
    // Verificação estrutural adicional: o orquestrador usa allSettled, cujo
    // contrato garante que NENHUMA promise rejeitada propaga para quem
    // chamou syncWidgetSnapshots — os testes acima já provam isso
    // comportamentalmente (nenhum throw chega ao await de fora).
    const store = createStore()
    let budgetAttempted = false
    let invoicesAttempted = false

    const budget = new SnapshotSync({
      store,
      fetchBudget: async () => {
        budgetAttempted = true
        throw new Error('falha')
      },
      currentOwnerId: () => 'user-a',
    })
    const invoices = new InvoicesSync({
      store,
      fetchActionableInvoices: async () => {
        invoicesAttempted = true
        return { items: [] }
      },
      currentOwnerId: () => 'user-a',
    })

    await syncWidgetSnapshots({ budget, invoices })

    // Ambos foram de fato tentados — nenhum foi pulado por causa do outro.
    expect(budgetAttempted).toBe(true)
    expect(invoicesAttempted).toBe(true)
  })
})

describe('coalescing entre os dois syncs', () => {
  it('3 disparos quase simultâneos: no máximo 1 requisição de Budget e 1 de Invoices em voo', async () => {
    const store = createStore()
    let budgetCalls = 0
    let invoicesCalls = 0

    const budget = new SnapshotSync({
      store,
      fetchBudget: async () => {
        budgetCalls += 1
        return { totalToPay: 1, totalPaid: 1, totalPending: 0 }
      },
      currentOwnerId: () => 'user-a',
    })
    const invoices = new InvoicesSync({
      store,
      fetchActionableInvoices: async () => {
        invoicesCalls += 1
        return { items: [] }
      },
      currentOwnerId: () => 'user-a',
    })

    await Promise.all([
      syncWidgetSnapshots({ budget, invoices }),
      syncWidgetSnapshots({ budget, invoices }),
      syncWidgetSnapshots({ budget, invoices }),
    ])

    expect(budgetCalls).toBe(1)
    expect(invoicesCalls).toBe(1)
  })

  it('depois de completar, um novo disparo executa de novo', async () => {
    const store = createStore()
    let budgetCalls = 0
    let invoicesCalls = 0

    const budget = new SnapshotSync({
      store,
      fetchBudget: async () => {
        budgetCalls += 1
        return { totalToPay: 1, totalPaid: 1, totalPending: 0 }
      },
      currentOwnerId: () => 'user-a',
    })
    const invoices = new InvoicesSync({
      store,
      fetchActionableInvoices: async () => {
        invoicesCalls += 1
        return { items: [] }
      },
      currentOwnerId: () => 'user-a',
    })

    await syncWidgetSnapshots({ budget, invoices })
    await syncWidgetSnapshots({ budget, invoices })

    expect(budgetCalls).toBe(2)
    expect(invoicesCalls).toBe(2)
  })
})
