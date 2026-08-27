import { describe, expect, it } from 'vitest'
import { formatCloseTiming, formatDueTiming } from './invoice-timing'
import { selectBankInvoice } from './bank-invoice-selection'
import { InvoiceStatus } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Vocabulário temporal da fatura na lista de Bancos
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A segunda linha do banco responde "preciso agir agora?". Qual verbo usar
 * depende do estado da fatura escolhida:
 *
 *   ABERTA  → ainda vai fechar  → "Fecha…"
 *   demais  → já fechou         → "Vence…"
 *
 * `selectBankInvoice` resolve isso em `referenceDate`, alternando entre
 * fechamento e vencimento. Sem essa troca, uma fatura já fechada diria
 * "Fecha em -3 dias" — a contagem incoerente que o item 1 proíbe.
 */

/** 10/09/2026, meio-dia — longe das bordas do dia. */
const HOJE = new Date(2026, 8, 10, 12)

const dia = (d: number) => new Date(2026, 8, d, 12)

describe('formatCloseTiming — fatura ainda aberta', () => {
  it('fecha hoje', () => {
    expect(formatCloseTiming(dia(10), HOJE)).toBe('Fecha hoje')
  })

  it('fecha amanhã tem forma própria', () => {
    // "Fecha em 1 dia" soa mecânico onde a língua tem uma palavra.
    expect(formatCloseTiming(dia(11), HOJE)).toBe('Fecha amanhã')
  })

  it('fecha em X dias', () => {
    expect(formatCloseTiming(dia(12), HOJE)).toBe('Fecha em 2 dias')
  })

  it('a forma curta cabe na linha do banco', () => {
    expect(formatCloseTiming(dia(12), HOJE, 'short')).toContain('2')
  })

  it('nunca produz contagem negativa', () => {
    /*
      Já fechou: o texto muda de tempo verbal em vez de exibir "-3 dias".
      Este é o caso que a lista de Bancos evita trocando para o vencimento.
    */
    const passado = formatCloseTiming(dia(7), HOJE)

    expect(passado).toContain('Fechou')
    expect(passado).not.toContain('-')
  })
})

describe('formatDueTiming — fatura já fechada', () => {
  it('vence hoje', () => {
    expect(formatDueTiming(dia(10), HOJE)).toBe('Vence hoje')
  })

  it('vence em X dias', () => {
    expect(formatDueTiming(dia(15), HOJE)).toBe('Vence em 5 dias')
  })

  it('vencida usa passado, não contagem negativa', () => {
    const passado = formatDueTiming(dia(5), HOJE)

    expect(passado).toBe('Venceu há 5 dias')
    expect(passado).not.toContain('-')
  })
})

/** Fatura mínima para a seleção. */
function invoice(over: {
  id: string
  status: InvoiceStatus
  closeDate: string
  dueDate: string
}) {
  return {
    id: over.id,
    /* O filtro descarta faturas de outro banco na primeira linha. */
    bankId: 'bank-1',
    status: over.status,
    closeDate: over.closeDate,
    dueDate: over.dueDate,
    totalAmount: 100,
    reimbursable: 0,
    month: 9,
    year: 2026,
  } as never
}

describe('a referência muda com o estado da fatura', () => {
  it('ABERTA aponta para o fechamento', () => {
    const escolhida = selectBankInvoice('bank-1', [
      invoice({
        id: 'i1',
        status: InvoiceStatus.OPEN,
        closeDate: '2026-09-12',
        dueDate: '2026-09-20',
      }),
    ])

    expect(escolhida?.status).toBe(InvoiceStatus.OPEN)
    expect(formatCloseTiming(escolhida!.referenceDate, HOJE)).toBe(
      'Fecha em 2 dias',
    )
  })

  it('FECHADA aponta para o vencimento', () => {
    /*
      É o que evita "Fecha em -3 dias": a fatura fechou, e o que importa
      agora é quando ela vence.
    */
    const escolhida = selectBankInvoice('bank-1', [
      invoice({
        id: 'i1',
        status: InvoiceStatus.CLOSED,
        closeDate: '2026-09-07',
        dueDate: '2026-09-15',
      }),
    ])

    expect(formatDueTiming(escolhida!.referenceDate, HOJE)).toBe(
      'Vence em 5 dias',
    )
  })

  it('sem fatura, não há nada a dizer', () => {
    // O banco não inventa R$ 0,00 nem prazo — a linha 2 simplesmente some.
    expect(selectBankInvoice('bank-1', [])).toBeNull()
  })

  it('a seleção expõe a fatura, permitindo o link direto', () => {
    /*
      `?invoiceId=` é o mesmo parâmetro que a página de faturas já lê para
      abrir o drawer — clicar no banco pula o passo intermediário.
    */
    const escolhida = selectBankInvoice('bank-1', [
      invoice({
        id: 'inv-atual',
        status: InvoiceStatus.OPEN,
        closeDate: '2026-09-12',
        dueDate: '2026-09-20',
      }),
    ])

    expect(escolhida?.invoice.id).toBe('inv-atual')
  })
})
