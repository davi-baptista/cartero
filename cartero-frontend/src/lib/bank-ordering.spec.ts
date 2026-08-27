import { describe, expect, it } from 'vitest'
import { orderBanksByUrgency } from './bank-invoice-selection'
import { InvoiceStatus } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Ordem da lista de Bancos
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A prioridade é por URGÊNCIA da fatura escolhida: em atraso primeiro,
 * depois fechada, depois aberta — e banco sem fatura por último.
 *
 * O flicker que motivou este arquivo: a página tem duas queries
 * independentes (`banks` e `invoices`), e a lista renderizava assim que a
 * primeira chegava. Sem faturas, TODO banco cai na mesma prioridade e a
 * ordem vira a da API; quando a segunda resposta chegava, a lista se
 * reorganizava sozinha.
 *
 * Estes testes fixam o comparador. A correção do flicker é o gate de
 * loading, protegido em `mobile-list-pattern.spec.ts`.
 */

function invoice(over: {
  bankId: string
  status: InvoiceStatus
  closeDate: string
  dueDate: string
}) {
  return {
    id: `inv-${over.bankId}`,
    bankId: over.bankId,
    status: over.status,
    closeDate: over.closeDate,
    dueDate: over.dueDate,
    totalAmount: 100,
    reimbursable: 0,
    month: 9,
    year: 2026,
  } as never
}

const banco = (id: string, name = id) => ({ id, name })

describe('item 17: a ordem por urgência', () => {
  it('em atraso, fechada, aberta, e sem fatura por último', () => {
    const banks = [
      banco('d', 'D sem fatura'),
      banco('b', 'B aberta'),
      banco('a', 'A em atraso'),
      banco('c', 'C fechada'),
    ]

    const invoices = [
      invoice({
        bankId: 'b',
        status: InvoiceStatus.OPEN,
        closeDate: '2026-09-12',
        dueDate: '2026-09-20',
      }),
      invoice({
        bankId: 'a',
        status: InvoiceStatus.OVERDUE,
        closeDate: '2026-08-03',
        dueDate: '2026-08-10',
      }),
      invoice({
        bankId: 'c',
        status: InvoiceStatus.CLOSED,
        closeDate: '2026-09-03',
        dueDate: '2026-09-15',
      }),
    ]

    const ordem = orderBanksByUrgency(banks, invoices).map((r) => r.bank.id)

    expect(ordem).toEqual(['a', 'c', 'b', 'd'])
  })

  it('fatura PAGA não disputa posição', () => {
    // `selectBankInvoice` a descarta: ela não exige nada do usuário.
    const rows = orderBanksByUrgency(
      [banco('x')],
      [
        invoice({
          bankId: 'x',
          status: InvoiceStatus.PAID,
          closeDate: '2026-09-03',
          dueDate: '2026-09-10',
        }),
      ],
    )

    expect(rows[0].selection).toBeNull()
  })
})

describe('item 9: o desempate é determinístico', () => {
  it('mesma prioridade desempata pela data mais próxima', () => {
    const banks = [banco('tarde'), banco('cedo')]
    const invoices = [
      invoice({
        bankId: 'tarde',
        status: InvoiceStatus.OPEN,
        closeDate: '2026-09-20',
        dueDate: '2026-09-27',
      }),
      invoice({
        bankId: 'cedo',
        status: InvoiceStatus.OPEN,
        closeDate: '2026-09-05',
        dueDate: '2026-09-12',
      }),
    ]

    const ordem = orderBanksByUrgency(banks, invoices).map((r) => r.bank.id)
    expect(ordem).toEqual(['cedo', 'tarde'])
  })

  it('mesma prioridade e mesma data desempatam pelo NOME', () => {
    /*
      Sem este último critério, dois bancos empatados dependeriam da ordem
      acidental da API — e a lista poderia trocá-los entre um refetch e outro
      sem que nada tivesse mudado.
    */
    const banks = [banco('z', 'Zeta'), banco('a', 'Alfa')]
    const mesmasDatas = {
      status: InvoiceStatus.OPEN,
      closeDate: '2026-09-10',
      dueDate: '2026-09-17',
    }

    const ordem = orderBanksByUrgency(banks, [
      invoice({ bankId: 'z', ...mesmasDatas }),
      invoice({ bankId: 'a', ...mesmasDatas }),
    ]).map((r) => r.bank.name)

    expect(ordem).toEqual(['Alfa', 'Zeta'])
  })

  it('bancos sem fatura também têm ordem estável', () => {
    const ordem = orderBanksByUrgency(
      [banco('c', 'Carlos'), banco('a', 'Ana'), banco('b', 'Bruno')],
      [],
    ).map((r) => r.bank.name)

    expect(ordem).toEqual(['Ana', 'Bruno', 'Carlos'])
  })
})

describe('itens 10 e 22: estabilidade entre renders', () => {
  it('item 10: a entrada NÃO é mutada', () => {
    /*
      O array vem do cache do React Query. Reordená-lo no lugar faria dois
      consumidores enxergarem ordens diferentes — e o cache deixaria de
      refletir a resposta da API.
    */
    const banks = [banco('z', 'Zeta'), banco('a', 'Alfa')]
    const original = [...banks]

    orderBanksByUrgency(banks, [])

    expect(banks).toEqual(original)
    expect(banks[0].id).toBe('z')
  })

  it('item 22: os MESMOS dados produzem a MESMA ordem', () => {
    // Refetch em background sem mudança real não pode reordenar a lista.
    const banks = [banco('b', 'Beta'), banco('a', 'Alfa')]
    const invoices = [
      invoice({
        bankId: 'b',
        status: InvoiceStatus.OPEN,
        closeDate: '2026-09-10',
        dueDate: '2026-09-17',
      }),
    ]

    const primeira = orderBanksByUrgency(banks, invoices).map((r) => r.bank.id)
    const segunda = orderBanksByUrgency(banks, invoices).map((r) => r.bank.id)

    expect(segunda).toEqual(primeira)
  })

  it('item 22: mudança REAL de prioridade pode mudar a posição', () => {
    /*
      Isto não é flicker: se a fatura venceu, ela passou a exigir atenção e
      subir é o comportamento certo.
    */
    const banks = [banco('a', 'Alfa'), banco('b', 'Beta')]
    const base = { closeDate: '2026-09-03', dueDate: '2026-09-10' }

    const antes = orderBanksByUrgency(banks, [
      invoice({ bankId: 'b', status: InvoiceStatus.OPEN, ...base }),
    ]).map((r) => r.bank.id)

    const depois = orderBanksByUrgency(banks, [
      invoice({ bankId: 'b', status: InvoiceStatus.OVERDUE, ...base }),
    ]).map((r) => r.bank.id)

    expect(antes).toEqual(['b', 'a'])
    expect(depois).toEqual(['b', 'a'])

    // E com a prioridade invertida, a troca acontece.
    const invertido = orderBanksByUrgency(banks, [
      invoice({ bankId: 'a', status: InvoiceStatus.OPEN, ...base }),
      invoice({ bankId: 'b', status: InvoiceStatus.OVERDUE, ...base }),
    ]).map((r) => r.bank.id)

    expect(invertido).toEqual(['b', 'a'])
  })
})

describe('sem faturas, a ordem NÃO é a da API', () => {
  it('todos empatam e o nome decide', () => {
    /*
      É exatamente este estado que a lista exibia por ~1s: com `invoices`
      ainda em `[]`, nenhum banco tem `selection` e a prioridade é a mesma
      para todos.

      O comparador continua determinístico aqui — o problema era RENDERIZAR
      este estado, não a ordem que ele produz.
    */
    const semFaturas = orderBanksByUrgency(
      [banco('n', 'Nubank'), banco('b', 'Bradesco')],
      [],
    ).map((r) => r.bank.name)

    const comFaturas = orderBanksByUrgency(
      [banco('n', 'Nubank'), banco('b', 'Bradesco')],
      [
        invoice({
          bankId: 'n',
          status: InvoiceStatus.OVERDUE,
          closeDate: '2026-08-03',
          dueDate: '2026-08-10',
        }),
      ],
    ).map((r) => r.bank.name)

    expect(semFaturas).toEqual(['Bradesco', 'Nubank'])
    // Com a fatura em atraso, Nubank sobe: as duas ordens DIVERGEM.
    expect(comFaturas).toEqual(['Nubank', 'Bradesco'])
    expect(comFaturas).not.toEqual(semFaturas)
  })
})
