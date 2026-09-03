import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROW_RESOLVED_TONE } from '@/components/ui/financial-list-row'
import { budgetDueTone } from './budget-row-view'
import {
  debtRowMeta,
  settledSettlementMeta,
  settlementRowMeta,
} from './budget-settlement-meta'
import { rowSubtextTone } from './person-period-view'
import { invoiceRowPresentation } from './invoice-row-presenter'
import { InvoiceStatus } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Uma row resolvida se lê como resolvida de relance
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O trailing de uma row quitada era verde, mas o subtexto abaixo do nome saía
 * neutro — e os dois falam do MESMO fato:
 *
 *   Curso online                             R$ 420,00
 *   Venceu em 25/08/2026 · Eva [cinza]            PAGA [verde]
 *
 * Meia linha concluída. Bancos já aplicava a regra; Orçamento e Pessoas não.
 *
 * ── E o hover deixou de acender azul ──
 *
 * O fundo do hover nunca divergiu (`hover:bg-muted/30` nas três superfícies).
 * Era o TÍTULO: `group-hover:text-primary` pintava o nome de azul só no
 * Orçamento — `--primary` é `oklch(0.640 0.210 272)` no tema dark.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const STATUS_ROW = semComentarios(ler('../components/ui/status-list-row.tsx'))
const FINANCIAL_ROW = semComentarios(
  ler('../components/ui/financial-list-row.tsx'),
)
const BUDGET = semComentarios(ler('../app/(dashboard)/budget/page.tsx'))
const PERSONS = semComentarios(ler('../app/(dashboard)/persons/page.tsx'))

describe('o token de resolvido é UM', () => {
  it('é o verde de sucesso canônico', () => {
    /* O mesmo `text-paid` de `PAGA`, `PAGO`, `RECEBIDO` e "Tudo em dia". */
    expect(ROW_RESOLVED_TONE).toBe('text-paid')
  })

  it('as três superfícies convergem para ele', () => {
    /*
      Três definições de "o verde do resolvido" divergiriam na primeira
      mudança — e a divergência que esta rodada corrige nasceu assim.
    */
    for (const [nome, fonte] of [
      ['budget-settlement-meta', ler('./budget-settlement-meta.ts')],
      ['budget-row-view', ler('./budget-row-view.ts')],
      ['person-period-view', ler('./person-period-view.ts')],
    ] as const) {
      expect(fonte, nome).toContain('ROW_RESOLVED_TONE')
    }
  })

  it('mora junto das outras primitives de row', () => {
    expect(FINANCIAL_ROW).toContain("ROW_RESOLVED_TONE = 'text-paid'")
  })
})

describe('Orçamento · Acertos com pessoas', () => {
  it('"Quitado em" fica verde', () => {
    const meta = settledSettlementMeta({
      nextItem: null,
      settledAt: '2026-08-18',
    })

    expect(meta.text).toBe('Quitado em 18/08/2026')
    expect(meta.tone).toBe(ROW_RESOLVED_TONE)
  })

  it('o fallback também', () => {
    /*
      "Acerto concluído" é o mesmo estado, só sem data defensável — a cor não
      depende de a data existir.
    */
    const meta = settledSettlementMeta({ nextItem: null, settledAt: null })

    expect(meta.text).toBe('Acerto concluído')
    expect(meta.tone).toBe(ROW_RESOLVED_TONE)
  })

  it('a row aberta NÃO fica verde', () => {
    /*
      O contrapeso: verde é conclusão. Um acerto em aberto mantém a régua de
      urgência, e pintá-lo de verde afirmaria uma quitação que não houve.
    */
    const hoje = '2026-09-10'
    const aberta = settlementRowMeta(
      'open',
      {
        nextItem: { direction: 'pay', dueDate: '2026-09-15' },
        settledAt: null,
      },
      hoje,
    )

    expect(aberta?.tone).not.toBe(ROW_RESOLVED_TONE)
  })
})

describe('Orçamento · Dívidas e Pendências anteriores', () => {
  it('o subtexto de dívida paga fica verde', () => {
    /*
      `Venceu em 25/08/2026 · Eva` ao lado de `PAGA` — os dois falando do mesmo
      fato resolvido.
    */
    expect(budgetDueTone('2026-08-25', true)).toBe(ROW_RESOLVED_TONE)
  })

  it('paga COM atraso também: a row não se contradiz', () => {
    /*
      Decisão de produto. O trailing diz `PAGA`; manter a data vermelha faria a
      mesma row afirmar duas coisas opostas. O atraso passou a ser contexto de
      qual obrigação era, não um alerta pendente.
    */
    const bemAtrasada = '2020-01-01'

    expect(budgetDueTone(bemAtrasada, true)).toBe(ROW_RESOLVED_TONE)
    expect(budgetDueTone(bemAtrasada, true)).not.toBe('text-destructive')
  })

  it('a dívida ABERTA mantém a régua de urgência', () => {
    const hoje = new Date()
    const dia = (d: number) => {
      const t = new Date(hoje)
      t.setDate(t.getDate() + d)
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    }

    expect(budgetDueTone(dia(-5), false)).toBe('text-destructive')
    expect(budgetDueTone(dia(2), false)).toBe('text-pending')
    expect(budgetDueTone(dia(40), false)).toBe('')
  })

  it('a row de dívida paga usa o token', () => {
    const paga = debtRowMeta({
      dueDate: null,
      settledAt: '2026-09-08',
      isPaid: true,
    })

    expect(paga?.text).toBe('Quitado em 08/09/2026')
    expect(paga?.tone).toBe(ROW_RESOLVED_TONE)
  })
})

describe('Pessoas · row resolvida', () => {
  it('o tom segue o ESTADO, não o prazo', () => {
    /*
      `nextItem` pode estar preenchido numa row resolvida (item de outra
      competência). Aplicar a régua temporal ali pintaria de vermelho uma
      linha que diz `PAGO`.
    */
    const residual = { direction: 'pay' as const, dueDate: '2020-01-01' }

    expect(rowSubtextTone('received', residual)).toBe(ROW_RESOLVED_TONE)
    expect(rowSubtextTone('paid', residual)).toBe(ROW_RESOLVED_TONE)
  })

  it('resolvido é verde nas duas formas de chamada', () => {
    /*
      Segundo guardião: com e sem `today`, com e sem item residual. Uma probe
      que zere o retorno do resolvido passa a matar este também.
    */
    for (const st of ['received', 'paid'] as const) {
      expect(rowSubtextTone(st, null)).toBe('text-paid')
      expect(rowSubtextTone(st, null, new Date(2026, 8, 10))).toBe('text-paid')
      expect(
        rowSubtextTone(st, { direction: 'pay', dueDate: '2026-09-15' }),
      ).toBe('text-paid')
    }
  })

  it('os dois sentidos resolvidos compartilham o verde', () => {
    expect(rowSubtextTone('received', null)).toBe(
      rowSubtextTone('paid', null),
    )
  })

  it('row aberta mantém a régua canônica', () => {
    const hoje = new Date(2026, 8, 10)
    const em = (dia: number) => ({
      direction: 'receive' as const,
      dueDate: `2026-09-${String(dia).padStart(2, '0')}`,
    })

    expect(rowSubtextTone('receivable', em(5), hoje)).toBe('text-destructive')
    expect(rowSubtextTone('debt', em(11), hoje)).toBe('text-pending')
    expect(rowSubtextTone('receivable', em(30), hoje)).toBe('')
  })

  it('sem saldo não é resolvido', () => {
    /*
      `empty` é ausência de movimento, não conclusão — parabenizar quem nunca
      teve nada afirmaria um fato que não houve.
    */
    expect(rowSubtextTone('empty', null)).not.toBe(ROW_RESOLVED_TONE)
  })

  it('a página aplica o helper', () => {
    expect(PERSONS).toContain('rowSubtextTone(status, balance.nextItem)')
  })
})

describe('Bancos já estava correto — e continua', () => {
  it('o "Venceu em" de uma fatura paga é o mesmo verde', () => {
    /*
      A regressão que esta rodada NÃO pode causar: Bancos era a referência, e o
      token compartilhado tem de bater com o que ela já fazia.
    */
    const paga = invoiceRowPresentation(
      {
        status: InvoiceStatus.PAID,
        closeDate: '2026-09-01',
        dueDate: '2026-09-10',
      },
      new Date(2026, 8, 20),
    )

    expect(paga.timingTone).toBe(ROW_RESOLVED_TONE)
    expect(paga.timingTone).toBe(paga.statusTone)
  })

  it('os outros estados não viraram verde', () => {
    for (const st of [
      InvoiceStatus.OPEN,
      InvoiceStatus.CLOSED,
      InvoiceStatus.OVERDUE,
    ]) {
      const p = invoiceRowPresentation(
        { status: st, closeDate: '2026-09-01', dueDate: '2026-09-05' },
        new Date(2026, 8, 20),
      )
      expect(p.timingTone).not.toBe(ROW_RESOLVED_TONE)
    }
  })
})

describe('o hover do Orçamento segue Bancos e Pessoas', () => {
  it('o título não acende azul', () => {
    /*
      A causa do "hover azulado": `group-hover:text-primary` no título, só
      nesta superfície. `--primary` é azul no tema dark.
    */
    expect(STATUS_ROW).not.toContain('group-hover:text-primary')
    expect(STATUS_ROW).toContain('STATUS_ROW_TITLE_CLASS = ROW_TITLE_CLASS')
  })

  it('nenhuma cor de marca no hover das rows', () => {
    for (const [nome, fonte] of [
      ['status-list-row', STATUS_ROW],
      ['financial-list-row', FINANCIAL_ROW],
    ] as const) {
      expect(fonte, nome).not.toContain('hover:text-primary')
      expect(fonte, nome).not.toContain('hover:bg-primary')
    }
  })

  it('o fundo do hover é o MESMO das três superfícies', () => {
    /*
      Este nunca divergiu — e o teste existe para que continue assim se alguém
      mexer numa das duas primitives.
    */
    expect(STATUS_ROW).toContain('hover:bg-muted/30')
    expect(FINANCIAL_ROW).toContain('hover:bg-muted/30')
  })

  it('o anel de foco também', () => {
    /*
      Faltava só aqui: navegando por teclado, o Orçamento não mostrava onde
      estava o cursor.
    */
    for (const [nome, fonte] of [
      ['status-list-row', STATUS_ROW],
      ['financial-list-row', FINANCIAL_ROW],
    ] as const) {
      expect(fonte, nome).toContain('outline-none')
      expect(fonte, nome).toContain('focus-visible:ring-3')
      expect(fonte, nome).toContain('focus-visible:ring-ring/50')
    }
  })

  it('o foco é visível nas rows clicáveis do Orçamento', () => {
    /*
      Segundo guardião do anel: o bloco de classes da row precisa dos três
      pedaços juntos — `outline-none` sem `focus-visible:ring` removeria o
      contorno nativo sem repor nada, que é pior que não ter mexido.
    */
    const shell = STATUS_ROW.slice(STATUS_ROW.indexOf('const classes = cn('))
    const bloco = shell.slice(0, shell.indexOf(')'))

    expect(bloco).toContain('outline-none')
    expect(bloco).toContain('focus-visible:ring-3')
    expect(bloco).toContain('focus-visible:ring-ring/50')
  })

  it('o retorno de toque no mobile sobrevive', () => {
    /* `active:` é a única affordance no mobile, onde não existe hover. */
    expect(STATUS_ROW).toContain('active:bg-muted/50')
  })

  it('o alvo de clique não mudou', () => {
    /* Mesma geometria: só cor e foco foram tocados. */
    expect(STATUS_ROW).toContain('px-4 py-3.5')
    expect(STATUS_ROW).toContain('sm:py-4')
  })
})

describe('nada de domínio financeiro mudou', () => {
  it('os valores continuam vindo do backend', () => {
    for (const campo of [
      'summary.totalToPay',
      'summary.totalPaid',
      'summary.totalPending',
    ]) {
      expect(BUDGET).toContain(campo)
    }
  })

  it('o valor principal segue neutro em todos os estados', () => {
    /*
      Verde é sucesso nesta rodada, e sucesso vive no subtexto e no trailing.
      O valor é um fato financeiro: R$ 420,00 é o mesmo pago ou não.
    */
    expect(STATUS_ROW).not.toContain('amountTone')
    expect(BUDGET).not.toContain('ROW_AMOUNT_TONE.in')
    expect(BUDGET).not.toContain('ROW_AMOUNT_TONE.out')
  })

  it('a ordenação não foi tocada', () => {
    /* Pessoas escolhe a policy pelo ciclo do mês; isto não mudou. */
    expect(PERSONS).toContain('sortPersonRowsForMonth(')
    expect(PERSONS).toContain('personRowsCycle(period)')
  })
})
