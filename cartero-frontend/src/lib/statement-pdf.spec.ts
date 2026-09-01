import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  belongsToCompetence,
  openItemsFor,
  summarizeCompetence,
  competenceBalanceLabel,
} from './person-settlement-view'
import type { SettlementCompetence } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O PDF de Pessoa é mensal — inteiro
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Dois defeitos coexistiam num PDF rotulado "setembro 2026": ele imprimia o
 * saldo e as pendências ALL-TIME (R$ 13.080 e 38 itens onde setembro tinha
 * R$ 770 e 5), e produzia uma única página física — com 87 itens o cursor
 * chegava a 1312mm numa página de 297mm, então o texto entrava no stream do
 * PDF mas ficava fora da área visível.
 *
 * O escopo é testado sobre a autoridade canônica (`openItemsFor` +
 * `summarizeCompetence`), a MESMA que o drawer usa — o ponto da correção é
 * não haver uma segunda regra temporal só para o PDF.
 */

const SET: SettlementCompetence = { year: 2026, month: 9 }
const HOJE = '2026-09-01'

/** Um item em aberto, com a competência derivada do vencimento. */
function item(id: string, dueDate: string, amount: number, extra: object = {}) {
  const [y, m] = dueDate.split('-').map(Number)
  return {
    id,
    title: id,
    amount,
    dueDate,
    occurredAt: '2026-08-24',
    isPaid: false,
    dueMonth: { year: y, month: m },
    referenceMonth: { year: 2026, month: 8 },
    ...extra,
  }
}

describe('M1-M4: o mês seleciona os itens', () => {
  it('M1: cobrança que vence no mês entra', () => {
    expect(belongsToCompetence(item('a', '2026-09-10', 500), SET, HOJE)).toBe(true)
  })

  it('M2: cobrança de outro mês fica fora', () => {
    /* Parcela de 2028 numa série de 24x jamais pertenceu a setembro. */
    expect(belongsToCompetence(item('b', '2028-05-10', 500), SET, HOJE)).toBe(false)
    expect(belongsToCompetence(item('c', '2026-11-20', 330), SET, HOJE)).toBe(false)
  })

  it('M3: dívida do mês entra', () => {
    expect(belongsToCompetence(item('d', '2026-09-20', 330), SET, HOJE)).toBe(true)
  })

  it('M4: dívida de outro mês fica fora', () => {
    /*
      Mês FUTURO. Um vencimento passado e ainda aberto seria carry — que
      pertence à competência de propósito, e é a distinção que este caso
      precisa respeitar para não testar a regra errada.
    */
    expect(belongsToCompetence(item('e', '2026-12-20', 330), SET, HOJE)).toBe(false)
  })

  it('carry: venceu antes e AINDA está aberto entra', () => {
    /*
      Não é exceção ao recorte: é a pergunta do drawer ("o que preciso acertar
      nesta competência?"), e uma dívida de julho não paga continua sendo.
    */
    expect(belongsToCompetence(item('f', '2026-07-15', 90), SET, HOJE)).toBe(true)
  })

  it('resolvido não entra na lista em aberto', () => {
    expect(
      belongsToCompetence(item('g', '2026-09-10', 500, { isPaid: true }), SET, HOJE),
    ).toBe(false)
  })
})

describe('M5: série longa não vem inteira', () => {
  /* 24 parcelas mensais a partir de setembro/2026 — o caso do PDF real. */
  const serie = Array.from({ length: 24 }, (_, i) => {
    const mes = 9 + i
    const y = 2026 + Math.floor((mes - 1) / 12)
    const m = ((mes - 1) % 12) + 1
    return item(`Duster ${i + 1}/24`, `${y}-${String(m).padStart(2, '0')}-10`, 500)
  })

  it('somente a parcela da competência aparece', () => {
    const doMes = openItemsFor(serie, SET, HOJE)
    expect(doMes).toHaveLength(1)
    expect(doMes[0].id).toBe('Duster 1/24')
  })

  it('as 23 restantes ficam fora', () => {
    /* O PDF antigo imprimia todas — inclusive vencimentos de 2028. */
    const fora = serie.filter((i) => !belongsToCompetence(i, SET, HOJE))
    expect(fora).toHaveLength(23)
  })

  it('a data da COMPRA não decide a competência', () => {
    /*
      Todas as parcelas compartilham `occurredAt` de agosto. Se o filtro fosse
      pela origem, a série inteira entraria ou sairia junta — que é exatamente
      o sintoma relatado.
    */
    expect(new Set(serie.map((i) => i.occurredAt)).size).toBe(1)
    expect(openItemsFor(serie, SET, HOJE)).toHaveLength(1)
  })
})

describe('M6: os totais são a soma dos itens impressos', () => {
  const receivables = [
    item('TESTE 1/12', '2026-07-15', 90),
    item('TESTE 2/12', '2026-08-15', 90),
    item('Duster 1/24', '2026-09-10', 500),
    item('TESTE 3/12', '2026-09-15', 90),
    item('Duster 9/24', '2027-05-10', 500),
  ]
  const debts = [
    item('Divida Setembro', '2026-09-20', 330),
    item('Divida Novembro', '2026-11-20', 330),
  ]

  it('resumo e lista falam do mesmo universo', () => {
    const mR = openItemsFor(receivables, SET, HOJE)
    const mD = openItemsFor(debts, SET, HOJE)
    const s = summarizeCompetence(mR, mD, SET, HOJE)

    expect(s.receivableTotal).toBe(770)
    expect(s.debtTotal).toBe(330)
    expect(s.net).toBe(440)
    expect(s.itemCount).toBe(mR.length + mD.length)
    expect(s.itemCount).toBe(5)
  })

  it('o total NÃO é o all-time', () => {
    /* A regressão exata: 13.080 e 38 itens sob um título de setembro. */
    const todos = summarizeCompetence(receivables, debts, SET, HOJE)
    expect(todos.receivableTotal).toBe(1270)
    const mensal = summarizeCompetence(
      openItemsFor(receivables, SET, HOJE),
      openItemsFor(debts, SET, HOJE),
      SET,
      HOJE,
    )
    expect(mensal.receivableTotal).not.toBe(todos.receivableTotal)
  })
})

describe('M7: trocar de mês troca o documento', () => {
  const serie = [
    item('Duster 1/24', '2026-09-10', 500),
    item('Duster 2/24', '2026-10-10', 500),
  ]

  it('outubro traz a parcela de outubro', () => {
    const out = openItemsFor(serie, { year: 2026, month: 10 }, '2026-10-01')
    expect(out.map((i) => i.id)).toContain('Duster 2/24')
  })

  it('cada mês tem seu próprio total', () => {
    const s9 = summarizeCompetence(openItemsFor(serie, SET, HOJE), [], SET, HOJE)
    const OUT = { year: 2026, month: 10 }
    const s10 = summarizeCompetence(
      openItemsFor(serie, OUT, '2026-10-01'),
      [],
      OUT,
      '2026-10-01',
    )
    /* Em outubro a de setembro virou carry — dois itens, não um. */
    expect(s9.itemCount).toBe(1)
    expect(s10.itemCount).toBe(2)
  })
})

describe('M8: mês sem itens', () => {
  it('o resumo é vazio, não zero disfarçado', () => {
    const s = summarizeCompetence([], [], SET, HOJE)
    expect(s.isEmpty).toBe(true)
    expect(s.itemCount).toBe(0)
  })

  it('a linguagem não afirma quitação da relação', () => {
    /*
      "Tudo acertado" seria falso: a pessoa pode ter pendência em novembro. O
      documento é de um mês, e só pode falar dele.
    */
    expect(competenceBalanceLabel(summarizeCompetence([], [], SET, HOJE))).toBe(
      'Nada a acertar',
    )
  })
})

describe('o PDF é alimentado pelo universo MENSAL', () => {
  const DRAWER = readFileSync(
    new URL('../components/person-statement-drawer.tsx', import.meta.url),
    'utf-8',
  )
  /* Sem comentários: a prosa cita os nomes antigos e casaria com as buscas. */
  const code = DRAWER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  /** O objeto passado a `generateStatementPdf`. */
  const chamada = (() => {
    const i = code.indexOf('generateStatementPdf({')
    expect(i, 'a chamada do gerador desapareceu').toBeGreaterThan(-1)
    return code.slice(i, code.indexOf('})', i))
  })()

  it('o resumo impresso é o da competência', () => {
    /*
      Este é o bug, em uma linha: `summary` é all-time por contrato (Fase 8B) e
      o cabeçalho do documento sempre foi mensal. Os testes de política acima
      passam com a política CORRETA existindo e não sendo usada — só uma
      asserção sobre a chamada pega isso.
    */
    expect(chamada).toContain('summary: context.monthSummary')
    expect(chamada).not.toContain('summary: context.summary')
  })

  it('as listas impressas são as da competência', () => {
    expect(chamada).toContain('pendingReceivables: context.monthReceivables')
    expect(chamada).toContain('pendingDebts: context.monthDebts')
  })

  it('as listas all-time NÃO chegam ao documento', () => {
    /*
      `data.pending` é all-time por contrato (Fase 8B) e deixou de ser lido no
      drawer: nem o card, nem a lista, nem o PDF são all-time, e o WhatsApp usa
      os totais de `summary`. Ler de novo daqui reabriria o bug.
    */
    expect(chamada).not.toContain('context.pendingReceivables')
    expect(chamada).not.toContain('context.pendingDebts')
    expect(code).not.toContain('data?.pending.receivables')
    expect(code).not.toContain('data?.pending.debts')
  })

  it('o mês do rótulo e o mês dos números têm a mesma origem', () => {
    /*
      `periodLabel` vem de `period`, e `monthSummary`/`month*` de `competence`,
      que é construída do MESMO `period`. Se o rótulo passasse a ter fonte
      própria, o documento poderia voltar a divergir de si mesmo.
    */
    expect(code).toContain('const competence = { year: period.year, month: period.month }')
    expect(code).toContain('formatMonthYear(period.month, period.year)')
  })

  it('a competência do PDF é derivada pela política compartilhada', () => {
    /* Nunca um filtro próprio do PDF — a regra tem uma dona só. */
    expect(code).toContain('openItemsFor(settlementReceivables, competence)')
    expect(code).toContain('openItemsFor(settlementDebts, competence)')
    expect(code).toContain('summarizeCompetence(')
  })
})
