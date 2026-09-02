import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { invoiceTimingClass, invoiceTimingLabel } from './invoice-timing'
import { INVOICE_STATUS_TEXT } from './invoice-status'
import { InvoiceStatus } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A cor comunica urgência — sem virar árvore de Natal
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A lista de Bancos ficou legível e muda: "Fecha amanhã" e "Fecha em 12d"
 * saíam no mesmo cinza, então a urgência só aparecia para quem lesse o número.
 *
 * Duas fontes de cor, cada uma com um trabalho:
 *
 *   subtexto (esquerda)   URGÊNCIA — quão perto está o prazo
 *   status (trailing)     ESTADO   — em que ponto do ciclo a fatura está
 *
 * O que este arquivo protege é a CONTENÇÃO. É fácil colorir tudo e perder a
 * hierarquia: se cada elemento tem sua cor, nenhum se destaca. Só as pontas
 * da urgência ganham tom, e o valor fica neutro de propósito.
 */

/** Relógio fixo: um teste que dependesse do dia real quebraria amanhã. */
const HOJE = new Date('2026-09-02T12:00:00.000Z')

function invoice(
  status: InvoiceStatus,
  closeDate: string,
  dueDate: string,
) {
  return { status, closeDate, dueDate }
}

describe('a cor do prazo segue a urgência', () => {
  it('atrasado usa o tom de alerta', () => {
    const vencida = invoice(InvoiceStatus.OVERDUE, '2026-08-01', '2026-08-10')
    expect(invoiceTimingClass(vencida, HOJE)).toBe('text-destructive')
  })

  it('fecha hoje e fecha amanhã pedem atenção', () => {
    /* O caso que motivou a mudança: "Fecha amanhã" era cinza. */
    expect(
      invoiceTimingClass(invoice(InvoiceStatus.OPEN, '2026-09-02', '2026-09-10'), HOJE),
    ).toBe('text-pending')
    expect(
      invoiceTimingClass(invoice(InvoiceStatus.OPEN, '2026-09-03', '2026-09-10'), HOJE),
    ).toBe('text-pending')
  })

  it('prazo distante NÃO ganha cor', () => {
    /*
      A contenção: colorir "em 12d" encheria a lista de tons sem hierarquia.
      Informação que não é urgente não deve competir pela atenção.
    */
    expect(
      invoiceTimingClass(invoice(InvoiceStatus.OPEN, '2026-09-20', '2026-09-28'), HOJE),
    ).toBe('text-muted-foreground')
  })

  it('a fronteira dos 2 dias é onde a cor para', () => {
    const aos2 = invoice(InvoiceStatus.OPEN, '2026-09-04', '2026-09-12')
    const aos3 = invoice(InvoiceStatus.OPEN, '2026-09-05', '2026-09-12')
    expect(invoiceTimingClass(aos2, HOJE)).toBe('text-pending')
    expect(invoiceTimingClass(aos3, HOJE)).toBe('text-muted-foreground')
  })

  it('fatura fechada mede o VENCIMENTO, não o fechamento', () => {
    /*
      Já fechou: o prazo que corre agora é o de pagar. Medir o fechamento
      diria "atrasado" sobre um evento que aconteceu e estava previsto.
    */
    const fechada = invoice(InvoiceStatus.CLOSED, '2026-08-28', '2026-09-03')
    expect(invoiceTimingClass(fechada, HOJE)).toBe('text-pending')
  })

  it('fatura paga não tem prazo a cumprir', () => {
    /*
      Um ciclo quitado não corre contra o calendário. A cor dele vem do
      status (verde), não da distância até uma data que já passou — senão a
      linha diria "atrasado" sobre algo resolvido.
    */
    const paga = invoice(InvoiceStatus.PAID, '2026-07-28', '2026-08-05')
    expect(invoiceTimingClass(paga, HOJE)).toBe('text-muted-foreground')
    expect(invoiceTimingLabel(paga, HOJE)).toContain('Venceu em')
  })
})

describe('o estado usa a paleta que o produto já tem', () => {
  it('cada status tem a cor canônica', () => {
    /*
      Não é uma paleta nova: `INVOICE_STATUS_TEXT` é a mesma que o detalhe da
      fatura usa. O mesmo fato não podia ter duas cores em duas telas.
    */
    expect(INVOICE_STATUS_TEXT[InvoiceStatus.OPEN]).toBe('text-primary')
    expect(INVOICE_STATUS_TEXT[InvoiceStatus.CLOSED]).toBe('text-pending')
    expect(INVOICE_STATUS_TEXT[InvoiceStatus.OVERDUE]).toBe('text-destructive')
    expect(INVOICE_STATUS_TEXT[InvoiceStatus.PAID]).toBe('text-paid')
  })

  it('os quatro estados são cobertos', () => {
    /* Um status sem cor cairia em `undefined` e sairia sem classe. */
    for (const status of Object.values(InvoiceStatus)) {
      expect(INVOICE_STATUS_TEXT[status], status).toBeTruthy()
    }
  })
})

describe('a contenção visual da row', () => {
  const PAGE = readFileSync(
    new URL('../app/(dashboard)/banks/page.tsx', import.meta.url),
    'utf-8',
  )
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('o valor fica NEUTRO', () => {
    /*
      O valor é o dado principal da linha. Colori-lo junto do status faria os
      dois competirem pela mesma informação; com um só colorido, o olho sabe
      onde olhar.
    */
    const amount = code.slice(
      code.indexOf('function MonthInvoiceAmount'),
      code.indexOf('function BankRow'),
    )
    expect(amount).toContain('ROW_AMOUNT_CLASS')
    expect(amount).not.toContain('INVOICE_STATUS_TEXT')
    expect(amount).not.toContain('text-destructive')
    expect(amount).not.toContain('text-paid')
  })

  it('a badge NÃO voltou para a linha do nome', () => {
    /*
      O ganho de largura da fase anterior: 56px → 471px no mobile. A cor
      substitui a badge, não a traz de volta.
    */
    const rowAtiva = code.slice(
      code.indexOf('function BankRow'),
      code.indexOf('function RowSkeleton'),
    )
    expect(rowAtiva).not.toContain('titleAdornment=')
    /*
      Nenhuma pílula na row ativa. A badge "Arquivado" da outra aba continua
      existindo — ela identifica a seção, não o estado de uma fatura.
    */
    expect(rowAtiva).not.toContain('rounded-full')
  })

  it('a competência continua fora da row', () => {
    const trailing = code.slice(
      code.indexOf('trailing={', code.indexOf('function BankRow')),
      code.indexOf('function RowSkeleton'),
    )
    expect(trailing).not.toContain('{monthLabel}')
  })

  it('banco sem fatura fica cinza, sem tom de estado', () => {
    /*
      O mês sem fatura não é bom nem ruim: verde sugeriria "em dia", âmbar
      sugeriria pendência, e nenhuma das duas coisas aconteceu.
    */
    expect(code).toContain("'text-muted-foreground/70'")
  })
})

describe('o resumo do topo diz o que falta pagar', () => {
  const PAGE = readFileSync(
    new URL('../app/(dashboard)/banks/page.tsx', import.meta.url),
    'utf-8',
  )
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('"em aberto" aparece sempre que houver algo a pagar', () => {
    /*
      A condição anterior era `paidCount > 0`, então a informação desaparecia
      justamente quando o mês inteiro estava em aberto — o caso em que ela
      mais importa.
    */
    expect(code).toContain('monthSummary.unpaid > 0 ?')
    expect(code).not.toContain('monthSummary.paidCount > 0 && (')
  })

  it('mês quitado diz "tudo pago" em vez de R$ 0,00', () => {
    /* Mesma informação, sem um número que o leitor precisa interpretar. */
    expect(code).toContain('tudo pago')
    expect(code).toContain('text-paid')
  })

  it('mês sem fatura não inventa contagem', () => {
    expect(code).toContain('Nenhuma fatura neste mês')
  })
})
