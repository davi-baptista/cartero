import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { InvoiceStatus, type Invoice } from '@/types'
import { summarizeBankMonth, type BankMonthRow } from './bank-invoice-selection'
import { BANK_MONTH_SECTION_ORDER, bankMonthSection, bankMonthSummaryStatus, groupBankMonthRows } from './bank-month-sections'
import { PERSON_MONTH_SECTION_ORDER, groupPersonMonthRows, personMonthSection, type PersonSectionBalance } from './person-month-sections'
import { personCompactBalanceLabel, personRowAmount, personSectionNetLabel } from './person-period-view'
import { formatCurrency } from './formatters'
import { ROW_TRAILING_LABEL_CLASS } from '@/components/ui/financial-list-row'

const BANKS_PAGE = readFileSync(new URL('../app/(dashboard)/banks/page.tsx', import.meta.url), 'utf8')
const PERSONS_PAGE = readFileSync(new URL('../app/(dashboard)/persons/page.tsx', import.meta.url), 'utf8')

function bankRow(id: string, status: InvoiceStatus | null, amount: number, reimbursable = 0): BankMonthRow<{ id: string; name: string }> {
  return {
    bank: { id, name: id },
    invoice: status ? ({ id, bankId: id, status } as Invoice) : null,
    amount,
    reimbursable,
    ownAmount: amount - reimbursable,
  }
}

function balance(values: Partial<PersonSectionBalance> = {}): PersonSectionBalance {
  return {
    receivablePending: 0, debtPending: 0,
    overdueReceivablePending: 0, overdueDebtPending: 0,
    periodReceivableTotal: 0, periodDebtTotal: 0,
    settledReceivablesCount: 0, settledDebtsCount: 0,
    ...values,
  }
}

describe('Bancos: uma seção por entidade e totais no mesmo universo', () => {
  it('separa vencida, aberta/fechada, paga e ausente; fatura zero continua fatura', () => {
    const rows = [
      bankRow('late', InvoiceStatus.OVERDUE, 100, 25),
      bankRow('open', InvoiceStatus.OPEN, 80, 10),
      bankRow('closed', InvoiceStatus.CLOSED, 20),
      bankRow('paid', InvoiceStatus.PAID, 50, 40),
      bankRow('zero', InvoiceStatus.OPEN, 0),
      bankRow('empty', null, 0),
    ]
    const result = groupBankMonthRows(rows)
    expect(result.groups.overdue.map((r) => r.bank.id)).toEqual(['late'])
    expect(result.groups.open.map((r) => r.bank.id)).toEqual(['open', 'closed', 'zero'])
    expect(result.groups.history.map((r) => r.bank.id)).toEqual(['paid'])
    expect(result.groups.noInvoice.map((r) => r.bank.id)).toEqual(['empty'])
    expect(result.totals).toEqual({ overdue: 100, open: 100, history: 50 })
    expect(result.unpaidOwn).toBe(165)
    expect(result.unpaidThirdParty).toBe(35)
    expect(result.unpaidOwn + result.unpaidThirdParty).toBe(200)
    expect(bankMonthSection(rows[4].invoice)).toBe('open')
  })
})

describe('Bancos: situação final do resumo', () => {
  it('mostra pagamento concluído só com fatura, sem alterar os totais', () => {
    const summary = summarizeBankMonth([bankRow('paid', InvoiceStatus.PAID, 1739)])
    expect(summary).toMatchObject({ total: 1739, unpaid: 0, invoiceCount: 1 })
    expect(bankMonthSummaryStatus(summary)).toEqual({ label: 'Tudo pago', tone: 'font-medium text-paid' })
  })

  it('distingue pendência normal de fatura vencida pelo status real', () => {
    const open = summarizeBankMonth([bankRow('open', InvoiceStatus.OPEN, 1183.95, 240)])
    const overdue = summarizeBankMonth([bankRow('late', InvoiceStatus.OVERDUE, 1183.95, 240)])
    expect(open).toMatchObject({ unpaid: 1183.95, overdueCount: 0, thirdParty: 240 })
    expect(bankMonthSummaryStatus(open)).toEqual({ label: 'A pagar nas faturas do mês', tone: 'text-muted-foreground' })
    expect(overdue).toMatchObject({ unpaid: 1183.95, overdueCount: 1, thirdParty: 240 })
    expect(bankMonthSummaryStatus(overdue)).toEqual({ label: 'Há faturas em atraso', tone: 'text-destructive' })
  })

  it('não interpreta mês sem fatura como pago', () => {
    const summary = summarizeBankMonth([bankRow('empty', null, 0)])
    expect(summary).toMatchObject({ total: 0, unpaid: 0, invoiceCount: 0 })
    expect(bankMonthSummaryStatus(summary)).toEqual({ label: 'Nenhuma fatura neste mês', tone: 'text-muted-foreground' })
    const zeroOpen = summarizeBankMonth([bankRow('zero', InvoiceStatus.OPEN, 0)])
    expect(zeroOpen).toMatchObject({ unpaid: 0, invoiceCount: 1, paidCount: 0 })
    expect(bankMonthSummaryStatus(zeroOpen)).toEqual({ label: 'A pagar nas faturas do mês', tone: 'text-muted-foreground' })
  })

  it('coloca composição e pago antes do status e usa azul informativo só na parte de terceiros', () => {
    const summaryStart = BANKS_PAGE.indexOf('Faturas em aberto de')
    const summaryEnd = BANKS_PAGE.indexOf('{/*', summaryStart)
    const block = BANKS_PAGE.slice(summaryStart, summaryEnd)
    expect(block.indexOf('bankSections.unpaidThirdParty')).toBeLessThan(block.indexOf('{summaryStatus.label}'))
    expect(block.indexOf('monthSummary.total - monthSummary.unpaid')).toBeLessThan(block.indexOf('{summaryStatus.label}'))
    expect(block).toContain('<span className="text-primary">{formatCurrency(bankSections.unpaidThirdParty)}</span> de outras pessoas')
    expect(block).toContain("cn('mt-0.5 text-[11px]', summaryStatus.tone)")
  })
})

describe('Pessoas: prioridade bilateral e totais brutos', () => {
  it('classifica atraso e futuro de ambos os lados independentemente do líquido', () => {
    expect(personMonthSection(balance({ receivablePending: 20, overdueReceivablePending: 20 }))).toBe('overdue')
    expect(personMonthSection(balance({ debtPending: 30, overdueDebtPending: 30 }))).toBe('overdue')
    expect(personMonthSection(balance({ receivablePending: 20 }))).toBe('open')
    expect(personMonthSection(balance({ debtPending: 30 }))).toBe('open')
  })

  it('atraso no lado oposto ao líquido lidera, sem duplicar a pessoa', () => {
    const rows = [
      { person: 'mixed', balance: balance({ receivablePending: 500, debtPending: 100, overdueDebtPending: 100, periodReceivableTotal: 500, periodDebtTotal: 100 }) },
      { person: 'future', balance: balance({ receivablePending: 40, periodReceivableTotal: 40 }) },
      { person: 'history', balance: balance({ periodReceivableTotal: 25, settledReceivablesCount: 1 }) },
      { person: 'empty', balance: balance() },
    ]
    const result = groupPersonMonthRows(rows)
    expect(result.groups.overdue.map((r) => r.person)).toEqual(['mixed'])
    expect(result.groups.open.map((r) => r.person)).toEqual(['future'])
    expect(result.groups.history.map((r) => r.person)).toEqual(['history'])
    expect(result.groups.empty.map((r) => r.person)).toEqual(['empty'])
    expect(result.totals.overdue).toEqual({ receive: 500, pay: 100 })
    expect(result.totals.open).toEqual({ receive: 40, pay: 0 })
    expect(result.totals.history).toEqual({ receive: 25, pay: 0 })
    expect(Object.values(result.groups).flat()).toHaveLength(rows.length)
  })

  it('líquido zero com dois lados abertos permanece operacional', () => {
    expect(personMonthSection(balance({ receivablePending: 200, debtPending: 200 }))).toBe('open')
    expect(personMonthSection(balance({ receivablePending: 200, debtPending: 200, overdueReceivablePending: 50 }))).toBe('overdue')
  })
})

describe('Pessoas: valor líquido compacto sem perder os lados brutos', () => {
  it('nomeia cada direção e explicita saldo quando as duas estão abertas', () => {
    expect(personCompactBalanceLabel(310, 0, 'open')).toBe('A RECEBER')
    expect(personCompactBalanceLabel(0, 250, 'open')).toBe('A PAGAR')
    expect(personCompactBalanceLabel(310, 250, 'open')).toBe('SALDO')
    expect(personCompactBalanceLabel(250, 310, 'open')).toBe('SALDO')
    expect(personCompactBalanceLabel(250, 250, 'open')).toBe('PENDÊNCIAS')
    expect(personCompactBalanceLabel(0, 0, 'open')).toBe('SEM SALDO')
  })

  it('agrega várias pessoas sem mudar os totais brutos da seção', () => {
    const grouped = groupPersonMonthRows([
      { person: 'ana', balance: balance({ receivablePending: 310 }) },
      { person: 'bia', balance: balance({ debtPending: 250 }) },
    ])
    const { receive, pay } = grouped.totals.open
    expect(grouped.groups.open).toHaveLength(2)
    expect({ receive, pay }).toEqual({ receive: 310, pay: 250 })
    expect(Math.abs(receive - pay)).toBe(60)
    expect(personCompactBalanceLabel(receive, pay, 'open')).toBe('SALDO')
    expect(personSectionNetLabel(receive, pay, 'open')).toBe(`+${formatCurrency(60)} de saldo`)
  })

  it('mantém o líquido com sinal na row e os dois lados intactos', () => {
    const mariana = { ...balance({ receivablePending: 310, debtPending: 250 }), netBalance: 60 }
    const reverse = { ...balance({ receivablePending: 250, debtPending: 310 }), netBalance: -60 }
    expect(personRowAmount(mariana)).toBe(60)
    expect(personRowAmount(reverse)).toBe(-60)
    expect(formatCurrency(personRowAmount(reverse))).toMatch(/^-/)
    expect(personCompactBalanceLabel(mariana.receivablePending, mariana.debtPending, 'open')).toBe('SALDO')
    expect(personCompactBalanceLabel(reverse.receivablePending, reverse.debtPending, 'open')).toBe('SALDO')
  })

  it('usa somente estados concluídos no histórico', () => {
    expect(personCompactBalanceLabel(310, 0, 'history')).toBe('RECEBIDO')
    expect(personCompactBalanceLabel(0, 250, 'history')).toBe('PAGO')
    expect(personCompactBalanceLabel(310, 250, 'history')).toBe('SALDO')
    expect(personCompactBalanceLabel(250, 250, 'history')).toBe('SALDO')
  })

  it('mantém as legendas curtas no trailing compartilhado do mobile', () => {
    const labels = [
      personCompactBalanceLabel(310, 0, 'open'),
      personCompactBalanceLabel(0, 250, 'open'),
      personCompactBalanceLabel(310, 250, 'open'),
      personCompactBalanceLabel(250, 250, 'open'),
      personCompactBalanceLabel(310, 0, 'history'),
      personCompactBalanceLabel(0, 250, 'history'),
      personCompactBalanceLabel(310, 250, 'history'),
      'SEM SALDO',
    ]
    expect(labels.every((label) => label.length <= 10)).toBe(true)
    expect(ROW_TRAILING_LABEL_CLASS).toContain('whitespace-nowrap')
    expect(PERSONS_PAGE).toContain('<FinancialRowTrailing amount={formatCurrency(net)} label={compactLabel}')
    expect(PERSONS_PAGE).not.toContain('trailingCompact={hasBothSides')
  })

  it('formata os totais de seção em uma linha com sinal e sem confundir saldo bilateral com obrigação', () => {
    expect(personSectionNetLabel(310, 0, 'open')).toBe(`+${formatCurrency(310)} a receber`)
    expect(personSectionNetLabel(0, 250, 'open')).toBe(`−${formatCurrency(250)} a pagar`)
    expect(personSectionNetLabel(250, 310, 'open')).toBe(`−${formatCurrency(60)} de saldo`)
    expect(personSectionNetLabel(250, 250, 'open')).toBe(`${formatCurrency(0)} de saldo`)
    expect(personSectionNetLabel(310, 0, 'history')).toBe(`+${formatCurrency(310)} recebido`)
    expect(personSectionNetLabel(0, 250, 'history')).toBe(`−${formatCurrency(250)} pago`)
    expect(personSectionNetLabel(310, 250, 'history')).toBe(`+${formatCurrency(60)} de saldo`)
  })

  it('mantém o resumo superior bruto e a row compacta em todas as larguras', () => {
    const summary = PERSONS_PAGE.slice(PERSONS_PAGE.indexOf('Valores em aberto com pessoas'), PERSONS_PAGE.indexOf('{/* List */}'))
    expect(summary).toContain('summary.openToReceive')
    expect(summary).toContain('summary.openToPay')
    expect(summary).toContain('Saldo líquido em aberto:')
    expect(PERSONS_PAGE).toContain('text-[11px] font-medium text-muted-foreground')
    expect(PERSONS_PAGE).toContain('<FinancialRowTrailing amount={formatCurrency(net)} label={compactLabel}')
    expect(PERSONS_PAGE).toContain('className="flex min-w-0 flex-wrap items-baseline')
    expect(PERSONS_PAGE).toContain("cn('ml-auto text-right text-xs font-medium sm:text-sm', ROW_AMOUNT_TONE.neutral)")
    expect(PERSONS_PAGE).toContain('personSectionNetLabel(personSections.totals[section].receive')
    expect(PERSONS_PAGE).not.toContain('className="ml-auto flex flex-col items-end gap-1 text-right"')
    expect(PERSONS_PAGE).not.toContain('trailingCompact={hasBothSides')
    expect(PERSONS_PAGE).toContain('section === \'overdue\' ? displayItem?.direction : rowLabelDirection(status, displayItem)')
    expect(PERSONS_PAGE).toContain('personSections.groups[section].map(({ person, balance }, i) => {')
  })
})

describe('Seções visíveis por competência', () => {
  it('Bancos mostra só seções com entidades, inclusive banco sem fatura', () => {
    const october = groupBankMonthRows([
      bankRow('nubank', InvoiceStatus.OVERDUE, 100),
      bankRow('inter', null, 0),
    ])
    const november = groupBankMonthRows([
      bankRow('nubank', InvoiceStatus.PAID, 100),
      bankRow('inter', InvoiceStatus.OPEN, 20),
    ])
    const visible = (groups: typeof october.groups) =>
      BANK_MONTH_SECTION_ORDER.filter((section) => groups[section].length > 0)

    expect(visible(october.groups)).toEqual(['overdue', 'noInvoice'])
    expect(visible(november.groups)).toEqual(['open', 'history'])
    expect(BANKS_PAGE).toContain('BANK_MONTH_SECTION_ORDER.filter((section) => bankSections.groups[section].length > 0).map')
    expect(BANKS_PAGE).not.toContain('Nenhum banco nesta seção.')
    expect(BANKS_PAGE).toContain('onOpenEmpty={setEmptyBankId}')
  })

  it('Pessoas mostra só seções com entidades, inclusive pessoa sem movimento', () => {
    const october = groupPersonMonthRows([
      { person: 'ana', balance: balance({ overdueDebtPending: 10, debtPending: 10 }) },
      { person: 'bia', balance: balance() },
    ])
    const november = groupPersonMonthRows([
      { person: 'ana', balance: balance({ receivablePending: 20 }) },
      { person: 'bia', balance: balance({ settledDebtsCount: 1 }) },
    ])
    const visible = (groups: typeof october.groups) =>
      PERSON_MONTH_SECTION_ORDER.filter((section) => groups[section].length > 0)

    expect(visible(october.groups)).toEqual(['overdue', 'empty'])
    expect(visible(november.groups)).toEqual(['open', 'history'])
    expect(PERSONS_PAGE).toContain('PERSON_MONTH_SECTION_ORDER.filter((section) => personSections.groups[section].length > 0).map')
    expect(PERSONS_PAGE).not.toContain('Nenhuma pessoa nesta seção.')
    expect(PERSONS_PAGE).toContain('onView={() => openPerson(person.id)}')
  })

  it('mantém um vazio geral depois de loading e erro, sem headings de seções vazias', () => {
    expect(BANKS_PAGE.indexOf('isLoading || invoicesLoading ?')).toBeLessThan(BANKS_PAGE.indexOf('!banks || banks.length === 0 ?'))
    expect(BANKS_PAGE.indexOf('isError || invoicesError ?')).toBeLessThan(BANKS_PAGE.indexOf('!banks || banks.length === 0 ?'))
    expect(BANKS_PAGE).toContain('Nenhum banco cadastrado')
    expect(PERSONS_PAGE.indexOf('isLoading || balancesLoading ?')).toBeLessThan(PERSONS_PAGE.indexOf('isSuccess && persons.length === 0 ?'))
    expect(PERSONS_PAGE.indexOf('isError || balancesError ?')).toBeLessThan(PERSONS_PAGE.indexOf('isSuccess && persons.length === 0 ?'))
    expect(PERSONS_PAGE).toContain('Nenhuma pessoa cadastrada')
    expect(BANK_MONTH_SECTION_ORDER.filter((section) => groupBankMonthRows([]).groups[section].length > 0)).toEqual([])
    expect(PERSON_MONTH_SECTION_ORDER.filter((section) => groupPersonMonthRows([]).groups[section].length > 0)).toEqual([])
  })
})
