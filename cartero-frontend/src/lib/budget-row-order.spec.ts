import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  compareBudgetRows,
  debtBudgetOrder,
  invoiceBudgetOrder,
  personBudgetOrder,
  sortBudgetRows,
  type OrderableBudgetRow,
} from './budget-row-order'
import { InvoiceStatus } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A ordem do Orçamento é híbrida: urgência primeiro, valor depois
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Ordenar tudo por valor punia quem precisa de ação: a fatura de R$ 2.000 já
 * paga liderava sobre uma de R$ 180 vencendo amanhã.
 *
 * Ordenar tudo por urgência tem o defeito simétrico: num mês inteiramente
 * quitado nada distingue as rows, e a ordem cairia no alfabeto — perdendo a
 * única leitura que ainda importa ali.
 *
 * A chave primária é o ESTADO, e é ele que escolhe a pergunta seguinte.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const row = (o: Partial<OrderableBudgetRow>): OrderableBudgetRow => ({
  open: true,
  urgency: 0,
  dueOrder: 0,
  amount: 0,
  label: '',
  ...o,
})

const ordenar = (rows: OrderableBudgetRow[]) =>
  [...rows].sort(compareBudgetRows).map((r) => r.label)

describe('S1: um item aberto pequeno vence um resolvido enorme', () => {
  it('o cenário misto da fase', () => {
    /*
      A aberta: R$ 180, vence amanhã
      B aberta: R$ 250, vence em 5d
      C paga:   R$ 2.000
    */
    const rows = [
      row({ label: 'C', open: false, amount: 2000 }),
      row({ label: 'B', open: true, dueOrder: 5, amount: 250 }),
      row({ label: 'A', open: true, dueOrder: 1, amount: 180 }),
    ]

    expect(ordenar(rows)).toEqual(['A', 'B', 'C'])
  })

  it('nem R$ 1.000.000 resolvido passa à frente de R$ 0,01 aberto', () => {
    const rows = [
      row({ label: 'gigante resolvido', open: false, amount: 1_000_000 }),
      row({ label: 'centavo aberto', open: true, amount: 0.01 }),
    ]

    expect(ordenar(rows)[0]).toBe('centavo aberto')
  })
})

describe('S2: entre abertos, urgência — nunca valor', () => {
  it('o mais urgente lidera, mesmo valendo muito menos', () => {
    const rows = [
      row({ label: 'caro e distante', open: true, dueOrder: 30, amount: 5000 }),
      row({ label: 'barato e amanhã', open: true, dueOrder: 1, amount: 10 }),
    ]

    expect(ordenar(rows)).toEqual(['barato e amanhã', 'caro e distante'])
  })

  it('o valor NÃO participa do desempate entre abertos', () => {
    /*
      Mesma urgência e mesmo prazo: quem decide é o rótulo, não o valor. Se o
      valor entrasse aqui, "urgência primeiro" seria só uma preferência.
    */
    const rows = [
      row({ label: 'aaa', open: true, dueOrder: 5, amount: 10 }),
      row({ label: 'bbb', open: true, dueOrder: 5, amount: 9999 }),
    ]

    expect(ordenar(rows)).toEqual(['aaa', 'bbb'])
  })

  it('vencido lidera sobre o que vence hoje e no futuro', () => {
    const rows = [
      row({ label: 'futuro', open: true, dueOrder: 10 }),
      row({ label: 'vencido', open: true, dueOrder: -3 }),
      row({ label: 'hoje', open: true, dueOrder: 0 }),
    ]

    expect(ordenar(rows)).toEqual(['vencido', 'hoje', 'futuro'])
  })
})

describe('S3/S4: entre resolvidos, o maior valor primeiro', () => {
  it('S3: dois resolvidos', () => {
    const rows = [
      row({ label: 'menor', open: false, amount: 100 }),
      row({ label: 'maior', open: false, amount: 700 }),
    ]

    expect(ordenar(rows)).toEqual(['maior', 'menor'])
  })

  it('S4: tudo resolvido → a lista inteira fica valor DESC', () => {
    const rows = [
      row({ label: '250', open: false, amount: 250 }),
      row({ label: '2000', open: false, amount: 2000 }),
      row({ label: '100', open: false, amount: 100 }),
      row({ label: '700', open: false, amount: 700 }),
    ]

    expect(ordenar(rows)).toEqual(['2000', '700', '250', '100'])
  })

  it('a urgência NÃO participa entre resolvidos', () => {
    /* Prazo não existe mais depois que nada exige ação. */
    const rows = [
      row({ label: 'antigo e pequeno', open: false, dueOrder: 1, amount: 10 }),
      row({ label: 'recente e grande', open: false, dueOrder: 99, amount: 900 }),
    ]

    expect(ordenar(rows)).toEqual(['recente e grande', 'antigo e pequeno'])
  })
})

describe('S6: o estado é avaliado ANTES do valor', () => {
  it('a fronteira nunca é atravessada por valor', () => {
    const abertos = [1, 2, 3].map((n) =>
      row({ label: `aberto ${n}`, open: true, amount: n }),
    )
    const resolvidos = [9000, 8000].map((n) =>
      row({ label: `resolvido ${n}`, open: false, amount: n }),
    )
    const ordem = ordenar([...resolvidos, ...abertos])

    /* Todo aberto precede todo resolvido, sem exceção. */
    const primeiroResolvido = ordem.findIndex((l) => l.startsWith('resolvido'))
    const ultimoAberto = ordem.reduce(
      (i, l, idx) => (l.startsWith('aberto') ? idx : i),
      -1,
    )
    expect(ultimoAberto).toBeLessThan(primeiroResolvido)
  })
})

describe('a fronteira aberto/resolvido é a invariante central', () => {
  /*
    Guardiões extras: a regra mais importante da lista não deve depender de
    um único assert. Cada caso abaixo falharia se a fronteira sumisse.
  */

  it('em qualquer permutação, todo aberto precede todo resolvido', () => {
    const base = [
      row({ label: 'ab-grande', open: true, dueOrder: 99, amount: 9999 }),
      row({ label: 'ab-pequeno', open: true, dueOrder: 1, amount: 1 }),
      row({ label: 're-grande', open: false, amount: 100000 }),
      row({ label: 're-pequeno', open: false, amount: 2 }),
    ]

    /* Todas as 24 permutações produzem a mesma ordem. */
    const permutar = <T,>(xs: T[]): T[][] =>
      xs.length <= 1
        ? [xs]
        : xs.flatMap((x, i) =>
            permutar([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [
              x,
              ...r,
            ]),
          )

    for (const p of permutar(base)) {
      const ordem = ordenar(p)
      expect(ordem.slice(0, 2).every((l) => l.startsWith('ab-'))).toBe(true)
      expect(ordem.slice(2).every((l) => l.startsWith('re-'))).toBe(true)
    }
  })

  it('a fronteira sobrevive ao alfabeto', () => {
    /* `Zeca` aberto ainda precede `Ana` resolvida. */
    const rows = [
      row({ label: 'Ana', open: false, amount: 5000 }),
      row({ label: 'Zeca', open: true, amount: 1 }),
    ]

    expect(ordenar(rows)).toEqual(['Zeca', 'Ana'])
  })

  it('um aberto sem prazo nem valor ainda precede um resolvido', () => {
    const rows = [
      row({ label: 'resolvido rico', open: false, amount: 7777, dueOrder: 1 }),
      row({
        label: 'aberto vazio',
        open: true,
        amount: 0,
        dueOrder: Number.MAX_SAFE_INTEGER,
      }),
    ]

    expect(ordenar(rows)[0]).toBe('aberto vazio')
  })
})

describe('S7: empates são determinísticos', () => {
  it('rows idênticas mantêm ordem estável por rótulo', () => {
    const rows = [
      row({ label: 'Zeca', open: true }),
      row({ label: 'Ana', open: true }),
      row({ label: 'Bruno', open: true }),
    ]

    expect(ordenar(rows)).toEqual(['Ana', 'Bruno', 'Zeca'])
    /* E o resultado não depende da ordem de entrada. */
    expect(ordenar([...rows].reverse())).toEqual(['Ana', 'Bruno', 'Zeca'])
  })

  it('o desempate é locale-aware', () => {
    const rows = [
      row({ label: 'Zilda', open: false, amount: 10 }),
      row({ label: 'Álvaro', open: false, amount: 10 }),
    ]

    /* Sem `localeCompare` pt-BR, `Á` (U+00C1) cairia depois de `Z`. */
    expect(ordenar(rows)).toEqual(['Álvaro', 'Zilda'])
  })

  it('centavos de ruído não decidem a ordem', () => {
    /*
      Somas de reais em ponto flutuante produzem resíduos como 0.000001. Sem
      a tolerância, eles venceriam o desempate estável por rótulo.
    */
    const rows = [
      row({ label: 'Bruno', open: false, amount: 100 }),
      row({ label: 'Ana', open: false, amount: 100.000001 }),
    ]

    expect(ordenar(rows)).toEqual(['Ana', 'Bruno'])
  })

  it('`sortBudgetRows` não muta a entrada', () => {
    const original = [{ n: 'b' }, { n: 'a' }]
    const copia = [...original]

    sortBudgetRows(original, (x) => row({ label: x.n, open: false }))

    expect(original).toEqual(copia)
  })
})

describe('§6: faturas usam a escala de status de Bancos', () => {
  const fatura = (
    status: InvoiceStatus,
    o: Partial<Parameters<typeof invoiceBudgetOrder>[0]> = {},
  ) =>
    invoiceBudgetOrder({
      status,
      closeDate: '2026-09-20',
      dueDate: '2026-09-28',
      bankName: 'Banco',
      displayedAmount: 100,
      ...o,
    })

  it('OVERDUE → CLOSED → OPEN, e PAID por último', () => {
    const rows = [
      { ...fatura(InvoiceStatus.PAID), label: 'paga' },
      { ...fatura(InvoiceStatus.OPEN), label: 'aberta' },
      { ...fatura(InvoiceStatus.OVERDUE), label: 'vencida' },
      { ...fatura(InvoiceStatus.CLOSED), label: 'fechada' },
    ]

    expect(ordenar(rows)).toEqual(['vencida', 'fechada', 'aberta', 'paga'])
  })

  it('só PAID cai no grupo resolvido', () => {
    expect(fatura(InvoiceStatus.PAID).open).toBe(false)
    for (const st of [
      InvoiceStatus.OPEN,
      InvoiceStatus.CLOSED,
      InvoiceStatus.OVERDUE,
    ]) {
      expect(fatura(st).open, st).toBe(true)
    }
  })

  it('aberta conta até o FECHAMENTO; as demais, até o vencimento', () => {
    /* O mesmo critério de `nextEventTime` em Bancos. */
    const aberta = fatura(InvoiceStatus.OPEN, {
      closeDate: '2026-09-10',
      dueDate: '2026-09-28',
    })
    const fechada = fatura(InvoiceStatus.CLOSED, {
      closeDate: '2026-09-10',
      dueDate: '2026-09-28',
    })

    expect(aberta.dueOrder).toBeLessThan(fechada.dueOrder)
  })

  it('duas faturas do mesmo status ordenam pela data', () => {
    const cedo = { ...fatura(InvoiceStatus.CLOSED, { dueDate: '2026-09-05' }), label: 'cedo' }
    const tarde = { ...fatura(InvoiceStatus.CLOSED, { dueDate: '2026-09-25' }), label: 'tarde' }

    expect(ordenar([tarde, cedo])).toEqual(['cedo', 'tarde'])
  })

  it('duas faturas PAGAS ordenam por valor, não por data', () => {
    const pequena = {
      ...fatura(InvoiceStatus.PAID, { dueDate: '2026-09-05', displayedAmount: 50 }),
      label: 'pequena',
    }
    const grande = {
      ...fatura(InvoiceStatus.PAID, { dueDate: '2026-09-25', displayedAmount: 900 }),
      label: 'grande',
    }

    expect(ordenar([pequena, grande])).toEqual(['grande', 'pequena'])
  })

  it('a data é lida por STRING, sem `new Date`', () => {
    /*
      `new Date('2026-09-01')` é meia-noite UTC e, em UTC-3, volta 31/08 — a
      armadilha que trocaria a ordem na virada do mês.
    */
    const FONTE = semComentarios(ler('./budget-row-order.ts'))

    expect(FONTE).not.toContain('new Date(')
    expect(FONTE).toContain(".slice(0, 10).split('-')")
  })
})

describe('S5: acerto resolvido usa a contribuição LÍQUIDA', () => {
  const pessoa = (o: Partial<Parameters<typeof personBudgetOrder>[0]>) =>
    personBudgetOrder({
      contribution: { isSettled: false },
      nextItem: null,
      personName: 'Pessoa',
      displayedAmount: 0,
      ...o,
    })

  it('Fabricio ordena por R$ 1, não por R$ 11', () => {
    /*
      Deve R$ 11, tem R$ 10 a receber → contribui com R$ 1 ao orçamento, e é
      isso que a row exibe. Ordenar pelo bruto o colocaria acima de uma
      dívida de R$ 5, que pesa cinco vezes mais.
    */
    const fabricio = {
      ...pessoa({
        contribution: { isSettled: true },
        personName: 'Fabricio',
        displayedAmount: 1,
      }),
      label: 'Fabricio (líquido 1)',
    }
    const outro = {
      ...pessoa({
        contribution: { isSettled: true },
        personName: 'Outro',
        displayedAmount: 5,
      }),
      label: 'Outro (5)',
    }

    expect(ordenar([fabricio, outro])).toEqual([
      'Outro (5)',
      'Fabricio (líquido 1)',
    ])
  })

  it('o valor é repassado SEM transformação', () => {
    /*
      O assert do Fabricio compara 1 contra 5, e uma escala aplicada aos dois
      preservaria a ordem — então ele sozinho não prova que o número é o
      exibido. Aqui o valor absoluto é fixado.
    */
    expect(pessoa({ displayedAmount: 1 }).amount).toBe(1)
    expect(pessoa({ displayedAmount: 437.64 }).amount).toBe(437.64)
  })

  it('a ordem NÃO lê `debtTotal` nem outro bruto', () => {
    /*
      Segundo guardião: `personBudgetOrder` recebe apenas o valor já exibido.
      Um campo bruto no contrato seria o convite para trocá-los.
    */
    const FONTE = semComentarios(ler('./budget-row-order.ts'))

    expect(FONTE).not.toContain('debtTotal')
    expect(FONTE).not.toContain('receivableAmount')
    expect(FONTE).toContain('displayedAmount')
  })

  it('"resolvido" é a COBERTURA, não o fim da relação bilateral', () => {
    /*
      `contribution.isSettled` responde "ainda vai sair dinheiro daqui?" — a
      mesma autoridade que `peopleRowView` usa para o trailing. Com
      `open.itemCount` uma row exibindo `PAGO` seria ordenada como aberta.
    */
    const coberto = pessoa({
      contribution: { isSettled: true },
      /* O recebível segue aberto, com data — e ainda assim é resolvido. */
      nextItem: { dueDate: '2026-09-10' },
    })

    expect(coberto.open).toBe(false)
  })

  it('e `nextItem` NÃO decide o estado', () => {
    /*
      Guardião de M5: derivar `open` da existência do próximo item inverteria
      os dois casos abaixo — cobertura e prazo são fatos independentes.
    */
    /* Coberto COM prazo aberto → resolvido. */
    expect(
      pessoa({ contribution: { isSettled: true }, nextItem: { dueDate: '2026-09-10' } })
        .open,
    ).toBe(false)
    /* Descoberto SEM prazo → aberto. */
    expect(
      pessoa({ contribution: { isSettled: false }, nextItem: null }).open,
    ).toBe(true)
  })

  it('acerto aberto ordena pelo próximo vencimento', () => {
    const cedo = {
      ...pessoa({ nextItem: { dueDate: '2026-09-05' }, displayedAmount: 10 }),
      label: 'cedo',
    }
    const tarde = {
      ...pessoa({ nextItem: { dueDate: '2026-09-25' }, displayedAmount: 9999 }),
      label: 'tarde',
    }

    expect(ordenar([tarde, cedo])).toEqual(['cedo', 'tarde'])
  })

  it('aberto sem data vai para o fim do grupo aberto', () => {
    const semData = { ...pessoa({ nextItem: null }), label: 'sem data' }
    const comData = {
      ...pessoa({ nextItem: { dueDate: '2026-12-31' } }),
      label: 'com data',
    }

    expect(ordenar([semData, comData])).toEqual(['com data', 'sem data'])
  })
})

describe('§8: dívidas e pendências anteriores', () => {
  const divida = (o: Partial<Parameters<typeof debtBudgetOrder>[0]>) =>
    debtBudgetOrder({
      isPaid: false,
      dueDate: '2026-09-15',
      title: 'Dívida',
      displayedAmount: 100,
      ...o,
    })

  it('aberta antes de paga, mesmo valendo menos', () => {
    const aberta = { ...divida({ displayedAmount: 10 }), label: 'aberta' }
    const paga = {
      ...divida({ isPaid: true, displayedAmount: 5000 }),
      label: 'paga',
    }

    expect(ordenar([paga, aberta])).toEqual(['aberta', 'paga'])
  })

  it('entre abertas, o vencimento decide', () => {
    const cedo = { ...divida({ dueDate: '2026-09-02' }), label: 'cedo' }
    const tarde = {
      ...divida({ dueDate: '2026-09-28', displayedAmount: 9999 }),
      label: 'tarde',
    }

    expect(ordenar([tarde, cedo])).toEqual(['cedo', 'tarde'])
  })

  it('entre pagas, o valor decide', () => {
    const p1 = {
      ...divida({ isPaid: true, displayedAmount: 300, dueDate: '2026-09-01' }),
      label: '300',
    }
    const p2 = {
      ...divida({ isPaid: true, displayedAmount: 800, dueDate: '2026-09-28' }),
      label: '800',
    }

    expect(ordenar([p1, p2])).toEqual(['800', '300'])
  })

  it('dívida paga sem data não quebra a ordem', () => {
    const semData = {
      ...divida({ isPaid: true, dueDate: null, displayedAmount: 700 }),
      label: 'sem data',
    }
    const comData = {
      ...divida({ isPaid: true, displayedAmount: 100 }),
      label: 'com data',
    }

    /* Resolvidas ordenam por valor — a data ausente é irrelevante ali. */
    expect(ordenar([comData, semData])).toEqual(['sem data', 'com data'])
  })
})

describe('S8: a página aplica o sort sem mudar seções nem totais', () => {
  const PAGE = semComentarios(ler('../app/(dashboard)/budget/page.tsx'))

  it('as quatro listas usam a autoridade compartilhada', () => {
    expect(PAGE).toContain('invoiceBudgetOrder({')
    expect(PAGE).toContain('personBudgetOrder({')
    /* Dívidas do mês e pendências anteriores. */
    expect(PAGE.match(/debtBudgetOrder\(\{/g)?.length).toBe(2)
  })

  it('o sort por valor puro foi removido', () => {
    expect(PAGE).not.toContain('.sort((a, b) => b.budget.payable - a.budget.payable)')
  })

  it('a classificação das seções NÃO mudou', () => {
    /* Os mesmos filtros de pertencimento. */
    expect(PAGE).toContain("(row) => row.kind !== 'person'")
    expect(PAGE).toContain('shouldRenderPeopleSettlement')
    expect(PAGE).toContain("Number(inv.totalAmount) > 0")
  })

  it('os totais continuam somando as rows EXIBIDAS', () => {
    /*
      Ordenar não pode mexer no que é somado: cabeçalho e lista fecham por
      construção, sobre o mesmo array.
    */
    expect(PAGE).toContain('visiblePeople.reduce(')
    expect(PAGE).toContain('standalonePriorItems.reduce(')
  })

  it('a ordem da fatura usa o valor que a row DESTACA', () => {
    /*
      A row destaca o bruto (`invoiceRowView` decompõe abaixo). Ordenar pela
      sua parte faria a sequência não explicar os números visíveis.
    */
    const bloco = PAGE.slice(
      PAGE.indexOf('invoiceBudgetOrder({'),
      PAGE.indexOf('invoiceBudgetOrder({') + 400,
    )

    expect(bloco).toContain('Number(inv.totalAmount)')
    expect(bloco).not.toContain('ownAmount')
  })

  it('a ordem do acerto usa `payable`, o líquido exibido', () => {
    const bloco = PAGE.slice(
      PAGE.indexOf('personBudgetOrder({'),
      PAGE.indexOf('personBudgetOrder({') + 400,
    )

    expect(bloco).toContain('person.budget.payable')
    expect(bloco).toContain('person.contribution')
    expect(bloco).not.toContain('debtTotal')
  })
})
