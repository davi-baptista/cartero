import { describe, expect, it } from 'vitest'
import { banksForPeriod } from './bank-invoice-selection'
import { InvoiceStatus, type Invoice } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A ordem da lista de Bancos é por importância
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A página ordenava por urgência (`orderBanksByUrgency`) até virar mensal, e a
 * migração trocou isso por ordem alfabética. A justificativa — "num mês
 * fechado não há urgência a comunicar" — só vale para o passado: no mês
 * corrente a urgência é exatamente o que o usuário precisa ver primeiro, e
 * quem não tem fatura passou a aparecer na frente de quem tem.
 *
 * Este arquivo fixa o ranking completo para que ele não se perca de novo numa
 * próxima refatoração.
 *
 * ── Duas dimensões, nesta ordem ──
 *
 *   1. classe   OVERDUE → CLOSED → OPEN → PAID → sem fatura
 *   2. evento   dentro da classe, o que acontece antes vem antes
 *
 * Só a classe deixaria uma fechada que vence em 20 dias na frente de outra que
 * vence amanhã. Só a data misturaria uma aberta que fecha hoje com uma vencida
 * há três meses.
 */

const SET = { month: 9, year: 2026 }

/**
 * `closeDate` e `dueDate` explícitos: é a distância entre eles que a ordenação
 * lê, então deixá-los implícitos esconderia o que cada caso testa.
 */
function invoice(
  bankId: string,
  status: InvoiceStatus,
  closeDate: string,
  dueDate: string,
): Invoice {
  return {
    id: `${bankId}-inv`,
    userId: 'u',
    bankId,
    month: 9,
    year: 2026,
    status,
    closeDate,
    dueDate,
    totalAmount: 100,
  } as Invoice
}

const banco = (id: string, name: string) => ({ id, name })

/** Os nomes na ordem em que a lista os apresenta. */
const ordem = (
  banks: Array<{ id: string; name: string }>,
  invoices: Invoice[],
  period = SET,
) => banksForPeriod(banks, invoices, period).map((r) => r.bank.name)

describe('S1-S5: a classe de urgência decide primeiro', () => {
  it('S1: OVERDUE precede qualquer fatura não vencida', () => {
    const banks = [banco('a', 'Aberta'), banco('v', 'Vencida')]
    const invoices = [
      invoice('a', InvoiceStatus.OPEN, '2026-09-28', '2026-10-10'),
      invoice('v', InvoiceStatus.OVERDUE, '2026-09-01', '2026-09-05'),
    ]
    expect(ordem(banks, invoices)).toEqual(['Vencida', 'Aberta'])
  })

  it('S3: CLOSED precede OPEN', () => {
    /*
      Fechada já tem valor definido e data marcada; aberta ainda acumula. A
      primeira exige decisão antes.
    */
    const banks = [banco('a', 'Aberta'), banco('f', 'Fechada')]
    const invoices = [
      invoice('a', InvoiceStatus.OPEN, '2026-09-20', '2026-10-01'),
      invoice('f', InvoiceStatus.CLOSED, '2026-09-01', '2026-09-25'),
    ]
    expect(ordem(banks, invoices)).toEqual(['Fechada', 'Aberta'])
  })

  it('S5: PAID vem depois de tudo que ainda exige ação', () => {
    const banks = [banco('p', 'AAA Paga'), banco('o', 'ZZZ Aberta')]
    const invoices = [
      invoice('p', InvoiceStatus.PAID, '2026-09-01', '2026-09-10'),
      invoice('o', InvoiceStatus.OPEN, '2026-09-28', '2026-10-10'),
    ]
    /* Mesmo vindo primeiro no alfabeto, a paga cede a vez. */
    expect(ordem(banks, invoices)).toEqual(['ZZZ Aberta', 'AAA Paga'])
  })

  it('o ranking completo, do mais ao menos urgente', () => {
    /*
      O contrato inteiro numa asserção só: é isto que uma refatoração futura
      precisa quebrar para avisar que mudou a política.
    */
    const banks = [
      banco('sem', 'E Sem fatura'),
      banco('paid', 'D Paga'),
      banco('open', 'C Aberta'),
      banco('closed', 'B Fechada'),
      banco('over', 'A Vencida'),
    ]
    const invoices = [
      invoice('over', InvoiceStatus.OVERDUE, '2026-09-01', '2026-09-05'),
      invoice('closed', InvoiceStatus.CLOSED, '2026-09-02', '2026-09-20'),
      invoice('open', InvoiceStatus.OPEN, '2026-09-28', '2026-10-10'),
      invoice('paid', InvoiceStatus.PAID, '2026-09-03', '2026-09-15'),
    ]
    expect(ordem(banks, invoices)).toEqual([
      'A Vencida',
      'B Fechada',
      'C Aberta',
      'D Paga',
      'E Sem fatura',
    ])
  })
})

describe('S2/S4: dentro da classe, o evento mais próximo vem antes', () => {
  it('S2: duas CLOSED — a que vence antes lidera', () => {
    const banks = [banco('t', 'Tarde'), banco('c', 'Cedo')]
    const invoices = [
      invoice('t', InvoiceStatus.CLOSED, '2026-09-01', '2026-09-28'),
      invoice('c', InvoiceStatus.CLOSED, '2026-09-01', '2026-09-12'),
    ]
    expect(ordem(banks, invoices)).toEqual(['Cedo', 'Tarde'])
  })

  it('S4: duas OPEN — a que FECHA antes lidera', () => {
    /*
      Aberta ainda não tem vencimento a cumprir: o marco que se aproxima é o
      fechamento. Usar `dueDate` aqui inverteria a ordem sempre que os ciclos
      tivessem intervalos diferentes.
    */
    const banks = [banco('t', 'Tarde'), banco('c', 'Cedo')]
    const invoices = [
      /* "Tarde" vence ANTES, mas fecha DEPOIS — o par que separa as regras. */
      invoice('t', InvoiceStatus.OPEN, '2026-09-25', '2026-10-01'),
      invoice('c', InvoiceStatus.OPEN, '2026-09-10', '2026-10-20'),
    ]
    expect(ordem(banks, invoices)).toEqual(['Cedo', 'Tarde'])
  })

  it('duas OVERDUE — a de vencimento mais antigo lidera', () => {
    /* Mesma regra da policy anterior: a data mais próxima primeiro. */
    const banks = [banco('r', 'Recente'), banco('a', 'Antiga')]
    const invoices = [
      invoice('r', InvoiceStatus.OVERDUE, '2026-08-25', '2026-09-01'),
      invoice('a', InvoiceStatus.OVERDUE, '2026-05-25', '2026-06-01'),
    ]
    expect(ordem(banks, invoices)).toEqual(['Antiga', 'Recente'])
  })

  it('a data NÃO atropela a classe', () => {
    /*
      A aberta fecha hoje e a vencida venceu há meses. Ordenar só por data
      poria a aberta na frente — e o que exige ação é a vencida.
    */
    const banks = [banco('o', 'Aberta hoje'), banco('v', 'Vencida ha meses')]
    const invoices = [
      invoice('o', InvoiceStatus.OPEN, '2026-09-01', '2026-09-10'),
      invoice('v', InvoiceStatus.OVERDUE, '2026-05-01', '2026-05-10'),
    ]
    expect(ordem(banks, invoices)).toEqual(['Vencida ha meses', 'Aberta hoje'])
  })
})

describe('S6: a invariante de "sem fatura"', () => {
  it('S6/regressão: qualquer fatura precede a ausência dela', () => {
    /*
      O bug relatado, exatamente: em agosto o Inter (sem fatura) aparecia
      antes do Nubank, cuja fatura estava paga. A row sem fatura não tem
      obrigação, valor nem data — ela existe só para dizer que o cartão
      continua ali.
    */
    const banks = [banco('i', 'Inter'), banco('n', 'Nubank')]
    const invoices = [invoice('n', InvoiceStatus.PAID, '2026-09-01', '2026-09-10')]
    expect(ordem(banks, invoices)).toEqual(['Nubank', 'Inter'])
  })

  it('PAID e "sem fatura" NÃO empatam', () => {
    /*
      Na policy antiga os dois compartilhavam o rank 3 — sem consequência,
      porque uma fatura paga nunca era selecionada. A visão mensal as exibe, e
      com o empate a ordem cairia no nome: um banco sem fatura chamado "AAA"
      passaria à frente de uma fatura paga.

      Este caso é o que separa os dois ranks de forma observável.
    */
    const banks = [banco('a', 'AAA Sem fatura'), banco('z', 'ZZZ Paga')]
    const invoices = [invoice('z', InvoiceStatus.PAID, '2026-09-01', '2026-09-10')]
    expect(ordem(banks, invoices)).toEqual(['ZZZ Paga', 'AAA Sem fatura'])
  })

  it('vale mesmo com fatura ZERADA — ter fatura é o que conta', () => {
    const banks = [banco('a', 'AAA Sem fatura'), banco('z', 'ZZZ Zerada')]
    const zerada = {
      ...invoice('z', InvoiceStatus.OPEN, '2026-09-28', '2026-10-10'),
      totalAmount: 0,
    } as Invoice
    expect(ordem(banks, [zerada])).toEqual(['ZZZ Zerada', 'AAA Sem fatura'])
  })

  it('S7: entre bancos sem fatura, a ordem é por nome', () => {
    /*
      Sem tie-break explícito a ordem viria da resposta da API — que não é
      contrato e pode mudar sem aviso.
    */
    const banks = [banco('c', 'Caixa'), banco('a', 'Alfa'), banco('b', 'Beta')]
    expect(ordem(banks, [])).toEqual(['Alfa', 'Beta', 'Caixa'])
  })
})

describe('S8: o desempate é determinístico', () => {
  it('mesma classe e mesma data caem no nome', () => {
    const banks = [banco('z', 'Zeta'), banco('a', 'Alfa')]
    const invoices = [
      invoice('z', InvoiceStatus.CLOSED, '2026-09-01', '2026-09-20'),
      invoice('a', InvoiceStatus.CLOSED, '2026-09-01', '2026-09-20'),
    ]
    expect(ordem(banks, invoices)).toEqual(['Alfa', 'Zeta'])
  })

  it('a ordem não depende de como os bancos chegaram', () => {
    /*
      Duas entradas com a mesma composição, embaralhadas: se a saída divergir,
      alguma dimensão do comparador está caindo na ordem de inserção.
    */
    const invoices = [
      invoice('a', InvoiceStatus.CLOSED, '2026-09-01', '2026-09-20'),
      invoice('b', InvoiceStatus.CLOSED, '2026-09-01', '2026-09-20'),
      invoice('c', InvoiceStatus.OPEN, '2026-09-28', '2026-10-10'),
    ]
    const primeira = ordem(
      [banco('a', 'Alfa'), banco('b', 'Beta'), banco('c', 'Caixa')],
      invoices,
    )
    const segunda = ordem(
      [banco('c', 'Caixa'), banco('b', 'Beta'), banco('a', 'Alfa')],
      invoices,
    )
    expect(primeira).toEqual(segunda)
  })

  it('a entrada não é reordenada no lugar', () => {
    /*
      `banks` vem do cache do React Query. Ordenar em `sort` sobre ele faria
      dois consumidores verem listas diferentes.
    */
    const banks = [banco('z', 'Zeta'), banco('a', 'Alfa')]
    const original = banks.map((b) => b.name)
    banksForPeriod(banks, [], SET)
    expect(banks.map((b) => b.name)).toEqual(original)
  })
})

describe('S9/S10: a competência governa a ordem', () => {
  const banks = [banco('b1', 'Um'), banco('b2', 'Dois')]

  /* `b1` está vencida em agosto e aberta em setembro; `b2`, o inverso. */
  const invoices = [
    {
      ...invoice('b1', InvoiceStatus.OVERDUE, '2026-08-01', '2026-08-10'),
      id: 'b1-ago',
      month: 8,
    } as Invoice,
    {
      ...invoice('b1', InvoiceStatus.OPEN, '2026-09-28', '2026-10-10'),
      id: 'b1-set',
    } as Invoice,
    {
      ...invoice('b2', InvoiceStatus.PAID, '2026-08-05', '2026-08-15'),
      id: 'b2-ago',
      month: 8,
    } as Invoice,
    {
      ...invoice('b2', InvoiceStatus.CLOSED, '2026-09-02', '2026-09-20'),
      id: 'b2-set',
    } as Invoice,
  ]

  it('S9: a urgência sai da fatura DAQUELE mês', () => {
    /* Agosto: `b1` vencida vence `b2` paga. */
    expect(ordem(banks, invoices, { month: 8, year: 2026 })).toEqual([
      'Um',
      'Dois',
    ])
  })

  it('S10: trocar de mês reorganiza, porque os fatos mudaram', () => {
    /* Setembro: `b2` fechada passa à frente de `b1` aberta. */
    expect(ordem(banks, invoices, SET)).toEqual(['Dois', 'Um'])
  })

  it('a fatura de outro mês não influencia a posição', () => {
    /*
      A regressão que isto barra: voltar a consultar "a fatura atual" para
      decidir urgência. Em outubro nenhum dos dois tem fatura, então a ordem
      cai no nome — se a de setembro vazasse, "Dois" lideraria.
    */
    expect(ordem(banks, invoices, { month: 10, year: 2026 })).toEqual([
      'Dois',
      'Um',
    ])
  })
})
