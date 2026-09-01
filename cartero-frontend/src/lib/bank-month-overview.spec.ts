import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  banksForPeriod,
  invoiceForPeriod,
  summarizeBankMonth,
} from './bank-invoice-selection'
import { InvoiceStatus, type Invoice } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Bancos é uma visão MENSAL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A lista mostrava sempre a mesma fatura — a mais urgente em aberto —, sob o
 * rótulo fixo "Fatura atual". Consultar agosto exigia entrar no banco e
 * percorrer o histórico, e comparar cartões num mês era impossível sem visitar
 * um por um.
 *
 * Agora o seletor de mês governa a lista inteira, como em Pessoas.
 *
 * A competência é `month`/`year` PERSISTIDOS, pelo mês de fechamento. Este
 * arquivo existe sobretudo para impedir que ela volte a ser derivada de uma
 * data: uma fatura que fecha em 28/09 e vence em 10/10 pertence a setembro, e
 * por `dueDate` todo cartão com vencimento no mês seguinte apareceria
 * deslocado.
 */

const SET = { month: 9, year: 2026 }
const AGO = { month: 8, year: 2026 }

function invoice(
  bankId: string,
  month: number,
  year: number,
  extra: Partial<Invoice> = {},
): Invoice {
  return {
    id: `${bankId}-${year}-${month}`,
    userId: 'u',
    bankId,
    month,
    year,
    status: InvoiceStatus.OPEN,
    /* Fecha em setembro, vence em OUTUBRO — o caso que uma regra por data erra. */
    closeDate: `${year}-${String(month).padStart(2, '0')}-28`,
    dueDate: `${year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-10`,
    totalAmount: 100,
    ...extra,
  } as Invoice
}

const banco = (id: string, name: string) => ({ id, name })

describe('B7-B9: a fatura do banco na competência', () => {
  const invoices = [
    invoice('b1', 9, 2026, { totalAmount: 180.51 }),
    invoice('b1', 8, 2026, { totalAmount: 240 }),
    invoice('b2', 8, 2026, { totalAmount: 99 }),
  ]

  it('B7: banco com fatura no mês devolve a daquele mês', () => {
    expect(invoiceForPeriod('b1', invoices, SET)?.totalAmount).toBe(180.51)
  })

  it('B8: banco com fatura só em OUTRO mês devolve null', () => {
    expect(invoiceForPeriod('b2', invoices, SET)).toBeNull()
    expect(invoiceForPeriod('b2', invoices, AGO)?.totalAmount).toBe(99)
  })

  it('B9: banco sem nenhuma fatura devolve null', () => {
    expect(invoiceForPeriod('b3', invoices, SET)).toBeNull()
  })

  it('B6: a fatura de outro mês NUNCA aparece como sendo do selecionado', () => {
    /*
      A regressão mais provável: cair de volta em "a mais recente" ou "a mais
      urgente" quando o mês não tem fatura.
    */
    expect(invoiceForPeriod('b1', invoices, { month: 7, year: 2026 })).toBeNull()
  })

  it('a competência é month/year, não o vencimento', () => {
    /*
      Todas as faturas do fixture vencem no mês SEGUINTE ao de fechamento. Se
      a resolução usasse `dueDate`, a de setembro cairia em outubro.
    */
    const set = invoiceForPeriod('b1', invoices, SET)
    expect(set?.dueDate.slice(0, 7)).toBe('2026-10')
    expect(set?.month).toBe(9)
    expect(invoiceForPeriod('b1', invoices, { month: 10, year: 2026 })).toBeNull()
  })

  it('atravessa a virada de ano sem confundir competências', () => {
    const dez = [invoice('b1', 12, 2026), invoice('b1', 1, 2027)]
    expect(invoiceForPeriod('b1', dez, { month: 12, year: 2026 })?.year).toBe(2026)
    expect(invoiceForPeriod('b1', dez, { month: 1, year: 2027 })?.year).toBe(2027)
    /* Mesmo mês, ano diferente, jamais colidem. */
    expect(invoiceForPeriod('b1', dez, { month: 12, year: 2027 })).toBeNull()
  })
})

describe('B10-B13: a lista do mês', () => {
  const banks = [
    banco('b2', 'Porto Seguro'),
    banco('b1', 'Bradesco'),
    banco('b3', 'Santander'),
  ]
  const invoices = [
    invoice('b1', 9, 2026, { totalAmount: 180.51, status: InvoiceStatus.CLOSED }),
    invoice('b2', 9, 2026, { totalAmount: 186.05, status: InvoiceStatus.OPEN }),
    invoice('b3', 8, 2026, { totalAmount: 245.59 }),
  ]

  it('B10: várias faturas do mesmo mês, uma por banco', () => {
    const rows = banksForPeriod(banks, invoices, SET)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.amount)).toEqual([180.51, 186.05, 0])
  })

  it('B9: o banco sem fatura CONTINUA na lista', () => {
    /*
      A lista é de BANCOS. Sumir com um cartão porque o mês não teve gasto
      esconderia o próprio cartão — e ele voltaria a aparecer no mês seguinte
      como se tivesse sido criado ali.
    */
    const rows = banksForPeriod(banks, invoices, SET)
    const santander = rows.find((r) => r.bank.id === 'b3')
    expect(santander).toBeDefined()
    expect(santander?.invoice).toBeNull()
    expect(santander?.amount).toBe(0)
  })

  it('a ordem é por importância; o nome só desempata', () => {
    /*
      Bradesco (CLOSED) antes de Porto (OPEN) por urgência — e Santander, sem
      fatura, por último apesar de vir antes dos dois no alfabeto se a lista
      fosse ordenada por nome.
    */
    const rows = banksForPeriod(banks, invoices, SET)
    expect(rows.map((r) => r.bank.name)).toEqual([
      'Bradesco',
      'Porto Seguro',
      'Santander',
    ])
  })

  it('B11: fatura PAGA aparece — o ciclo aconteceu', () => {
    const pagas = [
      invoice('b1', 9, 2026, { totalAmount: 500, status: InvoiceStatus.PAID }),
    ]
    const rows = banksForPeriod([banco('b1', 'Bradesco')], pagas, SET)
    expect(rows[0].invoice?.status).toBe(InvoiceStatus.PAID)
    expect(rows[0].amount).toBe(500)
  })

  it('fatura ZERADA aparece com R$ 0,00, em vez de sumir', () => {
    /*
      A seleção por urgência as ignorava, com razão: não há o que cobrar. Numa
      visão mensal, "R$ 0,00" diz que o mês não teve gasto — informação que
      some junto com a row.
    */
    const zero = [invoice('b1', 9, 2026, { totalAmount: 0 })]
    const rows = banksForPeriod([banco('b1', 'Bradesco')], zero, SET)
    expect(rows[0].invoice).not.toBeNull()
    expect(rows[0].amount).toBe(0)
  })

  it('a parte de terceiros acompanha a fatura', () => {
    const comTerceiro = [
      invoice('b1', 9, 2026, {
        totalAmount: 1000,
        reimbursable: 300,
      } as Partial<Invoice>),
    ]
    const rows = banksForPeriod([banco('b1', 'Bradesco')], comTerceiro, SET)
    expect(rows[0].amount).toBe(1000)
    expect(rows[0].ownAmount).toBe(700)
  })
})

describe('o resumo do mês', () => {
  const banks = [
    banco('b1', 'Bradesco'),
    banco('b2', 'Porto'),
    banco('b3', 'Santander'),
  ]

  it('soma as faturas da competência, pagas inclusive', () => {
    /*
      Tirar as pagas faria o total encolher sozinho quando o usuário pagasse —
      como se o gasto não tivesse existido. "Quanto ainda falta" é outra
      pergunta, e tem campo próprio.
    */
    const invoices = [
      invoice('b1', 9, 2026, { totalAmount: 100, status: InvoiceStatus.PAID }),
      invoice('b2', 9, 2026, { totalAmount: 200, status: InvoiceStatus.OPEN }),
    ]
    const s = summarizeBankMonth(banksForPeriod(banks, invoices, SET))

    expect(s.total).toBe(300)
    expect(s.unpaid).toBe(200)
    expect(s.paidCount).toBe(1)
    expect(s.invoiceCount).toBe(2)
  })

  it('conta cada status separadamente', () => {
    const invoices = [
      invoice('b1', 9, 2026, { status: InvoiceStatus.OVERDUE }),
      invoice('b2', 9, 2026, { status: InvoiceStatus.CLOSED }),
      invoice('b3', 9, 2026, { status: InvoiceStatus.OPEN }),
    ]
    const s = summarizeBankMonth(banksForPeriod(banks, invoices, SET))

    expect(s.overdueCount).toBe(1)
    expect(s.closedCount).toBe(1)
    expect(s.openCount).toBe(1)
  })

  it('B26: mês sem nenhuma fatura tem resumo zerado, não quebrado', () => {
    const s = summarizeBankMonth(banksForPeriod(banks, [], SET))
    expect(s.total).toBe(0)
    expect(s.invoiceCount).toBe(0)
    expect(s.unpaid).toBe(0)
  })

  it('o resumo bate com a soma das rows exibidas', () => {
    /*
      A reconciliação que o usuário faz de olho: o número do topo tem que ser
      a soma do que está listado abaixo.
    */
    const invoices = [
      invoice('b1', 9, 2026, { totalAmount: 180.51 }),
      invoice('b2', 9, 2026, { totalAmount: 186.05 }),
      invoice('b3', 8, 2026, { totalAmount: 999 }),
    ]
    const rows = banksForPeriod(banks, invoices, SET)
    const s = summarizeBankMonth(rows)

    expect(s.total).toBeCloseTo(
      rows.reduce((sum, r) => sum + r.amount, 0),
      2,
    )
    /* A de agosto não entra. */
    expect(s.total).toBeCloseTo(366.56, 2)
  })
})

describe('B35: nenhuma requisição por banco', () => {
  const PAGE = readFileSync(
    new URL('../app/(dashboard)/banks/page.tsx', import.meta.url),
    'utf-8',
  )
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('a lista mensal sai de UMA query de faturas', () => {
    /*
      O risco de virar N+1 é real: "a fatura deste banco neste mês" pede uma
      busca por banco. A composição acontece no cliente, sobre `['invoices']`
      que a página já carregava.
    */
    expect(code).toContain("queryKey: ['invoices']")
    expect(code).toContain('banksForPeriod(banks ?? [], invoices, period)')
  })

  it('nenhuma query é montada dentro de um map de bancos', () => {
    expect(code).not.toContain("['bank-invoices', bank.id]")
    expect(code).not.toContain('getBankInvoices(bank.id)')
    expect(code).not.toMatch(/\.map\([\s\S]{0,200}useQuery/)
  })
})

describe('B14-B15: quem NÃO aparece', () => {
  const PAGE = readFileSync(
    new URL('../app/(dashboard)/banks/page.tsx', import.meta.url),
    'utf-8',
  )

  it('a lista ativa vem de getBanks(), que já exclui sistema e arquivados', () => {
    /*
      O banco de sistema (`__system_receivables__`) e os arquivados são
      filtrados no backend. A visão mensal não mudou a FONTE — trocar
      `['banks']` por outra coleção reabriria os dois de uma vez.
    */
    expect(PAGE).toContain("queryKey: ['banks'],")
    expect(PAGE).toContain('getBanks()')
    /* Os arquivados continuam numa consulta própria, para a aba deles. */
    expect(PAGE).toContain("getBanks('ARCHIVED')")
  })

  it('a composição mensal parte da lista de bancos, não das faturas', () => {
    /*
      Montar as rows a partir de `['invoices']` traria de volta qualquer banco
      com fatura — inclusive arquivado e o de sistema, que a query de bancos
      não devolve.
    */
    expect(PAGE).toContain('banksForPeriod(banks ?? [], invoices, period)')
  })
})
