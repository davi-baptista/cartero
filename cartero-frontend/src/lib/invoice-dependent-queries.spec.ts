import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import { invalidateInvoiceDependents } from './invoice-dependent-queries'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O que precisa revalidar quando uma fatura muda de status
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A O3.2 fez cada cobrança automática carregar `sourceDeleteBlockReason`,
 * derivado da fatura da compra de origem. Sem invalidar as listas que trazem
 * esse campo, uma tela já carregada continuaria dizendo `null` depois de a
 * fatura virar PAID — e ofereceria "Excluir compra e cobrança" para algo que
 * o backend recusa.
 *
 * Não é falha de segurança: a guarda continua no delete. É a UI prometendo o
 * que não cumpre, que era o defeito que a O3.2 veio fechar.
 */

/** Registra as chaves invalidadas, sem subir um QueryClient de verdade. */
function spyClient() {
  const invalidateQueries = vi.fn()
  return {
    qc: { invalidateQueries } as unknown as QueryClient,
    keys: () =>
      invalidateQueries.mock.calls.map(
        ([arg]) => (arg as { queryKey: unknown[] }).queryKey,
      ),
  }
}

describe('itens 2, 4 e 5: as dependências certas', () => {
  it('invalida as duas superfícies que carregam a capability', () => {
    const { qc, keys } = spyClient()

    invalidateInvoiceDependents(qc, { invoiceId: 'inv-1', bankId: 'bank-1' })
    const chaves = keys().map((k) => k[0])

    /* A lista de A Receber e as pendências do extrato da pessoa. */
    expect(chaves).toContain('receivables')
    expect(chaves).toContain('person-statement')
  })

  it('mantém o que já era invalidado', () => {
    const { qc, keys } = spyClient()

    invalidateInvoiceDependents(qc, { invoiceId: 'inv-1', bankId: 'bank-1' })
    const chaves = keys()

    expect(chaves).toContainEqual(['invoice', 'inv-1'])
    expect(chaves).toContainEqual(['bank-invoices', 'bank-1'])
    /* Pagar não invalidava `budget`; reabrir sim. As duas mexem no mesmo fato. */
    expect(chaves.map((k) => k[0])).toContain('budget')
  })

  it('item 12: o statement é invalidado por PREFIXO', () => {
    /*
      A chave real é `['person-statement', personId, início, fim]`. Montá-la à
      mão exigiria saber quais pessoas e meses estão em cache — e erraria em
      silêncio ao esquecer uma. O prefixo alcança todas as variantes.
    */
    const { qc, keys } = spyClient()

    invalidateInvoiceDependents(qc, { invoiceId: 'inv-1' })
    const statement = keys().find((k) => k[0] === 'person-statement')

    expect(statement).toEqual(['person-statement'])
  })

  it('sem fatura ou banco, não inventa chave com undefined', () => {
    /*
      O drawer abre sem fatura selecionada. `['invoice', undefined]` não
      casaria com nada e mascararia o engano.
    */
    const { qc, keys } = spyClient()

    invalidateInvoiceDependents(qc, { invoiceId: null, bankId: null })

    for (const chave of keys()) {
      expect(chave).not.toContain(undefined)
      expect(chave).not.toContain(null)
    }
  })
})

describe('item 3: nada de invalidação global', () => {
  it('a lista é deliberada', () => {
    const { qc, keys } = spyClient()

    invalidateInvoiceDependents(qc, { invoiceId: 'inv-1', bankId: 'bank-1' })

    /* Toda chamada leva `queryKey` — nenhuma varre o cache inteiro. */
    for (const chave of keys()) expect(chave.length).toBeGreaterThan(0)

    const raizes = new Set(keys().map((k) => k[0]))
    expect(raizes).toEqual(
      new Set([
        'invoice',
        'bank-invoices',
        'invoices',
        'budget',
        'receivables',
        'person-statement',
      ]),
    )
  })
})

describe('itens 1 e 7: as duas mutations usam a mesma lista', () => {
  const DRAWER = readFileSync(
    new URL('../components/invoice-details-drawer.tsx', import.meta.url),
    'utf-8',
  )

  it('pagar e reabrir passam pelo helper', () => {
    /*
      Eram duas listas escritas à mão, e já divergiam: reabrir invalidava
      `budget`, pagar não. Mexem no mesmo fato — `Invoice.status`.
    */
    const chamadas = DRAWER.match(/invalidateInvoiceDependents\(/g) ?? []
    expect(chamadas.length).toBe(2)
  })

  it('nenhuma das duas mutations de STATUS mantém lista própria', () => {
    /*
      Mira só os dois `onSuccess` de status. `invalidateAfterTxChange` tem
      lista própria de propósito: editar uma transação dentro da fatura muda o
      TOTAL dela, não o `status` — e não mexe na capability de exclusão. Fora
      do escopo de O3.3.
    */
    const statusMutations = DRAWER.slice(
      DRAWER.indexOf('const markPaidMut'),
      DRAWER.indexOf('function invalidateAfterTxChange'),
    ).replace(/\/\*[\s\S]*?\*\//g, '')

    expect(statusMutations).not.toContain("queryKey: ['invoice', invoiceId]")
    expect(statusMutations).not.toContain("queryKey: ['bank-invoices', bankId]")
    expect(statusMutations).toContain('invalidateInvoiceDependents')
  })
})
