import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dueContext, resolvedLabel } from './person-settlement-view'
import type { SettlementCompetence } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O PDF diz quando vence — sem perder quando aconteceu
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A linha do PDF mostrava só `Em 10/08/2026`, que é `occurredAt` — quando a
 * cobrança aconteceu. Quem recebia o documento lia aquilo como vencimento: no
 * caso real a cobrança era de 10/08, vencia em 28/08 e já estava atrasada, e a
 * tela dizia "Em atraso · venceu em 28/08" enquanto o PDF não dizia nada.
 *
 * As duas datas são fatos diferentes, então nenhuma substitui a outra.
 *
 * O estado sai de `dueStateOf` (via `dueContext`), a MESMA função do drawer —
 * mesma comparação por dia civil de Fortaleza, mesmo vocabulário. Um segundo
 * cálculo de atraso só para o PDF é o que este arquivo existe para impedir.
 */

const SET: SettlementCompetence = { year: 2026, month: 9 }
const HOJE = '2026-09-01'

function item(dueDate: string, extra: object = {}) {
  const [y, m] = dueDate.split('-').map(Number)
  return {
    id: 'i',
    title: 'Reembolso de viagem',
    amount: 350,
    dueDate,
    occurredAt: '2026-08-10',
    isPaid: false,
    dueMonth: { year: y, month: m },
    referenceMonth: { year: 2026, month: 8 },
    ...extra,
  }
}

describe('D1-D3: o estado do vencimento', () => {
  it('D1: pendente vencido diz que VENCEU, com a data', () => {
    /* O caso real: cobrança de 10/08 com vencimento 28/08, hoje 01/09. */
    const c = dueContext(item('2026-08-28'), SET, HOJE)
    expect(c.text).toBe('Venceu em 28/08')
    expect(c.tone).toBe('overdue')
  })

  it('D2: pendente futuro diz que VENCE — sem linguagem de atraso', () => {
    const c = dueContext(item('2026-09-15'), SET, HOJE)
    expect(c.text).toBe('Vence em 15/09')
    expect(c.tone).toBe('neutral')
    expect(c.text).not.toMatch(/venceu|atraso/i)
  })

  it('D3: vence hoje usa o vocabulário do produto', () => {
    /* "Vence hoje" já existe no drawer — não foi inventado para o PDF. */
    const c = dueContext(item('2026-09-01'), SET, HOJE)
    expect(c.text).toBe('Vence hoje')
    expect(c.tone).toBe('neutral')
  })

  it('pendente NÃO é sinônimo de vencido', () => {
    /*
      A distinção que o documento precisa comunicar: os três itens abaixo estão
      todos "pendentes", e só um está atrasado.
    */
    const tons = ['2026-08-28', '2026-09-01', '2026-09-15'].map(
      (d) => dueContext(item(d), SET, HOJE).tone,
    )
    expect(tons).toEqual(['overdue', 'neutral', 'neutral'])
  })
})

describe('D4-D5: a data original sobrevive', () => {
  const DRAWER = readFileSync(
    new URL('../components/person-statement-drawer.tsx', import.meta.url),
    'utf-8',
  )
  const GERADOR = readFileSync(new URL('./statement-pdf.ts', import.meta.url), 'utf-8')
  const code = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('D4: a linha continua imprimindo occurredAt', () => {
    expect(code(GERADOR)).toContain('Lançada em ${formatDate(item.occurredAt)}')
  })

  it('D5: o vencimento NÃO substitui a data original', () => {
    /*
      A regressão mais tentadora: trocar `occurredAt` por `dueDate` "resolveria"
      o sintoma e apagaria o fato de que a cobrança nasceu em 10/08.
    */
    const g = code(GERADOR)
    expect(g).not.toContain('formatDate(item.dueDate)')
    /* As três seções imprimem a data de origem. */
    expect(g.split('Lançada em ${formatDate(item.occurredAt)}')).toHaveLength(4)
  })

  it('as duas informações chegam ao gerador como partes distintas', () => {
    const g = code(GERADOR)
    expect(g).toContain('dueContextOf')
    expect(g).toContain('due.tone === \'overdue\' ? COLOR_DESTRUCTIVE : COLOR_MUTED')
  })

  it('a política de atraso é a do drawer, não uma cópia', () => {
    const d = code(DRAWER)
    expect(d).toContain('dueContextOf: (item) => dueContext(item, competence)')

    /*
      Nenhuma DECISÃO temporal dentro do gerador. `new Date()` existe lá, para
      a data de emissão no rodapé — o que não pode aparecer é comparação de
      vencimento contra hoje, que criaria a segunda regra de atraso.
    */
    const g = code(GERADOR)
    expect(g).not.toContain('dueStateOf')
    expect(g).not.toContain('item.dueDate <')
    expect(g).not.toContain('item.dueDate >')
    expect(g).not.toContain('isPaid ?')
  })
})

describe('D6: o ano não fica ambíguo', () => {
  it('vencimento no ano da competência sai curto', () => {
    expect(dueContext(item('2026-08-28'), SET, HOJE).text).toBe('Venceu em 28/08')
  })

  it('vencimento em OUTRO ano sai completo', () => {
    /*
      Um carry de 2025 aberto em setembro/2026: "venceu em 28/08" sugeriria
      agosto deste ano, escondendo um atraso de mais de um ano.
    */
    const c = dueContext(item('2025-08-28'), SET, HOJE)
    expect(c.text).toBe('Venceu em 28/08/2025')
    expect(c.tone).toBe('overdue')
  })
})

describe('D7: item resolvido não parece atrasado', () => {
  it('recebido informa a resolução, não o atraso', () => {
    const label = resolvedLabel(
      { dueDate: '2026-08-28', paidAt: '2026-09-05', dueMonth: { year: 2026, month: 8 } },
      'receivable',
    )
    expect(label).toMatch(/Recebido/)
  })

  it('o gerador NÃO passa contexto de vencimento nos resolvidos', () => {
    /*
      `Venceu em 28/08` sozinho num item já recebido leria como pendência
      atrasada — o oposto do que aconteceu.
    */
    const g = readFileSync(new URL('./statement-pdf.ts', import.meta.url), 'utf-8')
    const i = g.indexOf('QUITADO')
    expect(i).toBeGreaterThan(-1)
    const secao = g.slice(i, i + 1400)
    expect(secao).toContain('resolvedLabelOf')
    expect(secao).toContain('undefined')
  })

  it('sem paidAt (legado) não inventa data de resolução', () => {
    const label = resolvedLabel(
      { dueDate: '2026-08-28', paidAt: null, dueMonth: { year: 2026, month: 8 } },
      'debt',
    )
    expect(label).toBe('Venceu em 28/08')
  })
})

describe('Receivable e Debt compartilham a semântica de vencimento', () => {
  it('o estado depende do vencimento, não do tipo', () => {
    /*
      O renderer recebe um modelo já normalizado, então a regra é a mesma para
      os dois — o que muda é só o sinal e a cor do valor.
    */
    const cobranca = dueContext(item('2026-08-28'), SET, HOJE)
    const divida = dueContext(item('2026-08-28', { title: 'Divida' }), SET, HOJE)
    expect(divida).toEqual(cobranca)
  })

  it('as duas seções injetam a mesma política', () => {
    const g = readFileSync(new URL('./statement-pdf.ts', import.meta.url), 'utf-8')
    const semComentario = g.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(semComentario.split('input.dueContextOf(item)')).toHaveLength(3)
  })
})
