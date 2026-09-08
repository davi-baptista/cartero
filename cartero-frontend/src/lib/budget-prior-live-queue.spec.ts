import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { budgetContextLabel, peopleRowView } from './people-settlement-view'
import type { BudgetSummary } from '@/services/budget.service'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * `Pendências anteriores` é uma FILA VIVA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A seção respondia "o que veio de trás?" misturando dois universos: o que
 * ainda está aberto e o que foi pago nesta competência. O segundo grupo
 * chegava lá porque a competência de uma dívida PAGA era o mês do pagamento —
 * uma dívida de janeiro paga em março era uma "pendência anterior" de março.
 *
 * ── O contrato V2 ──
 *
 *   Pendências anteriores = obrigações vencidas e ATUALMENTE não resolvidas.
 *
 * Enquanto a dívida de janeiro segue aberta, ela aparece em janeiro (seção
 * normal) e na fila de fevereiro, março, abril… Ao ser resolvida, some de
 * TODOS os meses posteriores e permanece só em janeiro, como paga.
 *
 * A retroatividade é intencional, e vem de uma separação de autoridade:
 *
 *   BUDGET   competência + obrigação atrasada ainda aberta
 *   EXTRATO  a data real em que o dinheiro se moveu
 *
 * "Em que mês eu paguei isso?" é pergunta do Extrato. Deslocar a dívida para
 * o mês do desembolso fazia o Budget respondê-la, e obrigava o usuário a
 * saber a resposta para a tela ficar organizada.
 *
 * Este arquivo fixa o lado do FRONTEND: a copy que não pode afirmar mês de
 * pagamento, a ordem das seções, e a ausência do ramo "paga" nas rows da
 * fila.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const BUDGET = ler('../app/(dashboard)/budget/page.tsx')
const BUDGET_CODE = semComentarios(BUDGET)
const CONTRATO = ler('../services/budget.service.ts')
const CONTRATO_CODE = semComentarios(CONTRATO)
const VIEW_CODE = semComentarios(ler('./people-settlement-view.ts'))

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

type PersonSettlement = BudgetSummary['peopleSettlements'][number]

function person(over: {
  paidInCompetence?: number
  openDueInMonth?: number
  debtTotal?: number
  openDebtTotal?: number
  itemCount?: number
}): PersonSettlement {
  /*
    Sem `as`: o fixture é o tipo REAL do contrato. Um cast deixaria a forma
    divergir em silêncio quando `peopleSettlements` mudar — e é justamente o
    typecheck que este arquivo usa como detector de consumidor desatualizado.
  */
  return {
    personId: 'p1',
    personName: 'Eva',
    budget: {
      receivableDueInMonth: 0,
      openDueInMonth: over.openDueInMonth ?? 0,
      currentOpenPrior: 0,
      paidInCompetence: over.paidInCompetence ?? 0,
      receivableAmount: 0,
      payable: over.debtTotal ?? 0,
      debtTotal: over.debtTotal ?? 0,
      automaticReceivable: 0,
    },
    open: {
      receivableInMonth: 0,
      debtInMonth: 0,
      priorOverdueReceivable: 0,
      priorOverdueDebt: 0,
      receivableTotal: 0,
      debtTotal: over.openDebtTotal ?? 0,
      net: -(over.openDebtTotal ?? 0),
      priorOverdueNet: 0,
      hasOverdue: false,
      automaticReceivable: 0,
      itemCount: over.itemCount ?? 0,
      nextItem: null,
    },
    settled: {
      settledAt: null,
      itemCount: 0,
    },
    contribution: {
      planned: over.debtTotal ?? 0,
      paid: over.paidInCompetence ?? 0,
      remaining: over.openDebtTotal ?? 0,
      isSettled: (over.itemCount ?? 0) === 0,
      settledAt: null,
    },
  }
}

// ─── F1-F3: a nomenclatura e a copy antigas não sobreviveram ────────────────

describe('F1-F3: nada afirma o mês do pagamento', () => {
  it('F1: `paidInMonth` não existe mais como campo do contrato', () => {
    /*
      O nome afirmava o MÊS DO PAGAMENTO, que a V2 deixou de usar para
      posicionar qualquer coisa. Renomear em vez de manter um alias é
      deliberado: o typecheck é o detector de consumidor antigo, e um alias
      legado deixaria o consumidor errado compilando em silêncio.
    */
    expect(CONTRATO_CODE).not.toMatch(/\bpaidInMonth\b/)
    expect(CONTRATO_CODE).toContain('paidInCompetence')

    /* `priorItems` perdeu o campo de quitação — a fila é toda aberta. */
    expect(CONTRATO_CODE).not.toMatch(/\bpaidInMonth: boolean\b/)
  })

  it('F1: a tela não lê nenhum campo de quitação da fila', () => {
    expect(BUDGET_CODE).not.toMatch(/item\.paidIn\w+/)
  })

  it('F2: a copy `pagas neste mês` desapareceu', () => {
    expect(VIEW_CODE).not.toContain('pagas neste mês')
    expect(BUDGET_CODE).not.toContain('pagas neste mês')
  })

  it('F3: a copy `quitados neste mês` desapareceu', () => {
    expect(VIEW_CODE).not.toContain('quitados neste mês')
    expect(BUDGET_CODE).not.toContain('quitados neste mês')
  })

  it('não vaza o jargão "competência" para a UI', () => {
    /*
      O usuário não precisa aprender o vocabulário interno para ler a tela.
      O termo vive nos comentários e nos nomes de campo, nunca numa string
      renderizada.
    */
    expect(VIEW_CODE).not.toMatch(/'[^']*competência[^']*'/i)
    expect(VIEW_CODE).not.toMatch(/`[^`]*competência[^`]*`/i)
  })
})

// ─── F4: o valor quitado continua explicando a linha ────────────────────────

describe('F4: `R$ X já quitados`', () => {
  it('a row exibe o quitado da competência sem datá-lo', () => {
    const view = peopleRowView(
      person({ paidInCompetence: 300, debtTotal: 400, openDebtTotal: 100, itemCount: 1 }),
      brl,
    )

    expect(view.metadata.some((m) => m.includes('já quitados'))).toBe(true)
    expect(view.metadata.some((m) => m.includes('300'))).toBe(true)
  })

  it('o rótulo acessível diz o mesmo', () => {
    const label = budgetContextLabel(
      person({ paidInCompetence: 330, debtTotal: 330 }),
      brl,
    )

    expect(label).toContain('já quitados')
    expect(label).toContain('330')
  })

  it('sem valor quitado, nenhuma frase é inventada', () => {
    const label = budgetContextLabel(person({ debtTotal: 0 }), brl)
    expect(label).toBeNull()
  })
})

// ─── F5: sem repetição temporal ─────────────────────────────────────────────

describe('F5: o contexto não repete a competência', () => {
  it('a frase não nomeia mês nem ano — o seletor já diz qual é', () => {
    const label = budgetContextLabel(
      person({ paidInCompetence: 330, debtTotal: 330 }),
      brl,
    )!

    expect(label).not.toMatch(/orçamento de \w+ \d{4}/)
    expect(label).not.toMatch(/\b\d{4}\b/)
    expect(label).not.toContain('neste mês')
  })

  it('a mesma pessoa não recebe duas frases para o mesmo dinheiro', () => {
    /*
      `openDueInMonth` e `paidInCompetence` são buckets DISJUNTOS: aberta que
      vence aqui, e paga que vence aqui. Cada uma ganha uma frase, e o valor
      não pode aparecer nas duas.
    */
    const label = budgetContextLabel(
      person({ openDueInMonth: 300, paidInCompetence: 200, debtTotal: 500 }),
      brl,
    )!

    expect(label).toContain('300')
    expect(label).toContain('200')
    expect(label.match(/300/g)).toHaveLength(1)
    expect(label.match(/200/g)).toHaveLength(1)
  })
})

// ─── F6-F7: a seção e o seu lugar ───────────────────────────────────────────

describe('F6-F7: a seção da fila viva', () => {
  const posicao = (marcador: string) => BUDGET.indexOf(marcador)

  it('F6: `Pendências anteriores` vem ANTES de `Faturas`', () => {
    /*
      Ela era a ÚLTIMA seção operacional, depois de Faturas, Acertos e
      Dívidas. O que já venceu exige mais ação do que o que ainda tem prazo,
      e ficava abaixo de tudo que ainda vai acontecer.
    */
    const fila = posicao('Pendências anteriores\n')
    const faturas = posicao('{/* Invoice list */}')
    const acertos = posicao('Acertos com pessoas\n')

    expect(fila).toBeGreaterThan(-1)
    expect(faturas).toBeGreaterThan(-1)
    expect(fila).toBeLessThan(faturas)
    expect(fila).toBeLessThan(acertos)
  })

  it('F6: mas continua DEPOIS do resumo — o total emoldura a leitura', () => {
    expect(posicao('summary.totalToPay')).toBeLessThan(
      posicao('Pendências anteriores\n'),
    )
  })

  it('F7: fila vazia não renderiza a seção', () => {
    /*
      "Pendências anteriores — R$ 0,00" seria ruído: afirmaria uma categoria
      que não tem conteúdo. Sem a seção, Faturas sobe naturalmente ao topo.
    */
    expect(BUDGET_CODE).toContain('hasPriorSection')
    expect(BUDGET_CODE).toMatch(
      /hasPriorSection\s*=\s*\n?\s*standalonePriorItems\.length > 0 \|\| priorInvoices\.length > 0/,
    )
    expect(BUDGET_CODE).toContain('{!isLoading && hasPriorSection && (')
  })

  it('a copy temporal da seção é preservada', () => {
    expect(BUDGET).toContain('Venceram antes deste mês.')
  })
})

// ─── F8-F11: as rows da fila ────────────────────────────────────────────────

describe('F8-F11: as rows da fila viva', () => {
  const bloco = (marcador: string, tamanho = 2600) =>
    BUDGET_CODE.slice(
      BUDGET_CODE.indexOf(marcador),
      BUDGET_CODE.indexOf(marcador) + tamanho,
    )

  it('F8: a dívida da fila renderiza como aberta e em atraso', () => {
    const row = bloco('standalonePriorItems.map(')

    expect(row).toContain('EM ATRASO')
    expect(row).toContain("tone=\"negative\"")
    /* O vencimento ORIGINAL — nunca reescrito como se fosse deste mês. */
    expect(row).toContain('Venceu em {formatDate(item.dueDate)}')
  })

  it('F9: a fatura da fila renderiza pelo presenter canônico', () => {
    /*
      O MESMO `invoiceRowPresentation` de Bancos e da seção Faturas. Um
      segundo caminho de apresentação para a mesma entidade foi exatamente o
      que fez as duas telas divergirem antes da Fase UI-ALIGN.
    */
    const row = bloco('priorInvoices.map(')

    expect(row).toContain('invoiceRowPresentation(inv)')
    expect(row).toContain('apresentacao.statusLabel')
    expect(row).toContain('apresentacao.timingLabel')
    /* Preserva a identidade de fatura: banco e ícone próprios. */
    expect(row).toContain('bankDisplayName(inv.bank')
    expect(row).toContain('icon={CreditCard}')
  })

  it('F10: a fatura da fila usa a SUA PARTE, não o bruto', () => {
    /*
      Row, total da seção e `totalToPay` têm de ter UMA base. O backend soma
      `ownAmount` no total; exibir `totalAmount` faria a soma das linhas não
      fechar com o cabeçalho quando houvesse valor de outras pessoas.
    */
    const row = bloco('priorInvoices.map(')
    expect(row).toContain('amount={inv.ownAmount}')
    expect(row).not.toContain('amount={inv.totalAmount}')

    expect(BUDGET_CODE).toMatch(/priorInvoicesTotal[\s\S]{0,120}inv\.ownAmount/)
  })

  it('F10: o total da seção soma dívidas e faturas na mesma base', () => {
    expect(BUDGET_CODE).toContain(
      'standalonePriorTotal = standaloneDebtPriorTotal + priorInvoicesTotal',
    )
  })

  it('F11: não existe ramo `PAGA` em lugar nenhum da fila', () => {
    /*
      A seção contém SÓ obrigação aberta — um item resolvido aqui é estado
      INVÁLIDO, quebra de contrato do backend. Uma badge "PAGA" defensiva
      mascararia a regressão: a tela exibiria um rótulo plausível em vez de
      deixar a falha aparecer.
    */
    const dividas = bloco('standalonePriorItems.map(')
    expect(dividas).not.toContain('PAGA')
    expect(dividas).not.toContain('text-paid')
    /* Sem ternário de estado: o trailing é constante. */
    expect(dividas).not.toMatch(/\?\s*'PAGA'/)

    const faturas = bloco('priorInvoices.map(')
    expect(faturas).not.toContain("tone={'positive'}")
    expect(faturas).toContain('tone="negative"')
  })

  it('F11: o contrato não expõe estado de quitação na fila', () => {
    /*
      A ausência do campo é o que torna o ramo inexprimível. Enquanto ele não
      existir no tipo, nenhuma tela consegue renderizar "paga" por engano.
    */
    const priorItems = CONTRATO_CODE.slice(
      CONTRATO_CODE.indexOf('priorItems: Array<'),
      CONTRATO_CODE.indexOf('priorItems: Array<') + 300,
    )

    expect(priorItems).not.toMatch(/paid/i)
    expect(priorItems).not.toMatch(/settled/i)
    expect(priorItems).not.toMatch(/isResolved/i)
  })
})
