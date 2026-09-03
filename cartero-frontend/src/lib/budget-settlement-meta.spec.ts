import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  debtRowMeta,
  isSettlementOverdue,
  openSettlementMeta,
  settledSettlementMeta,
  settlementRowMeta,
} from './budget-settlement-meta'
import { nextItemLabel } from './person-next-item'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A row de acerto passa a dizer QUANDO
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Aberta mostrava a composição bilateral porque o payload não trazia
 * `dueDate` — metadata de recurso. Resolvida não mostrava nada, e o nome ficava
 * visualmente solto.
 *
 * Agora: prazo à esquerda quando há pendência, conclusão quando não há. Sem
 * repetir o estado que o trailing já diz.
 */

const HOJE = '2026-09-10'

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const BUDGET = ler('../app/(dashboard)/budget/page.tsx')
const BUDGET_CODE = semComentarios(BUDGET)

const aberta = (direction: 'pay' | 'receive', dueDate: string) => ({
  nextItem: { direction, dueDate },
  settledAt: null,
})

describe('F1-F3: row aberta devendo', () => {
  it('F1: futuro conta os dias', () => {
    expect(openSettlementMeta(aberta('pay', '2026-09-15'), HOJE)?.text).toBe(
      'Pagar em 5d',
    )
  })

  it('F2: amanhã tem palavra própria', () => {
    expect(openSettlementMeta(aberta('pay', '2026-09-11'), HOJE)?.text).toBe(
      'Pagar amanhã',
    )
  })

  it('F3: atraso em valor absoluto', () => {
    /* "atrasado 3d" lê melhor que "em -3d", e é o número que decide urgência. */
    expect(openSettlementMeta(aberta('pay', '2026-09-07'), HOJE)?.text).toBe(
      'Pagar atrasado 3d',
    )
  })

  it('hoje tem palavra própria', () => {
    expect(openSettlementMeta(aberta('pay', HOJE), HOJE)?.text).toBe(
      'Pagar hoje',
    )
  })
})

describe('F4: row aberta a receber', () => {
  it('as quatro formas do outro sentido', () => {
    const caso = (due: string) =>
      openSettlementMeta(aberta('receive', due), HOJE)?.text

    expect(caso('2026-09-15')).toBe('Receber em 5d')
    expect(caso('2026-09-11')).toBe('Receber amanhã')
    expect(caso(HOJE)).toBe('Receber hoje')
    expect(caso('2026-09-07')).toBe('Receber atrasado 3d')
  })

  it('nunca usa "Vence em" — quem paga quem fica explícito', () => {
    /*
      "Vence em 5d" serve a uma fatura, que tem um só sentido. Num acerto entre
      pessoas o verbo é a informação: some ele e a linha não diz de que lado
      está o dinheiro.
    */
    for (const d of ['pay', 'receive'] as const) {
      const texto = openSettlementMeta(aberta(d, '2026-09-15'), HOJE)?.text
      expect(texto).not.toContain('Vence')
      expect(texto).toMatch(/^(Pagar|Receber)/)
    }
  })

  it('o texto vem do helper canônico, não de uma cópia', () => {
    /*
      A régua de dias e o vocabulário são os de Pessoas. Uma segunda
      implementação divergiria na primeira mudança.
    */
    for (const due of ['2026-09-07', HOJE, '2026-09-11', '2026-09-15']) {
      const item = { direction: 'pay' as const, dueDate: due }
      expect(openSettlementMeta({ nextItem: item, settledAt: null }, HOJE)?.text)
        .toBe(nextItemLabel(item, HOJE))
    }
  })
})

describe('tom da metadata aberta', () => {
  it('atraso é vermelho', () => {
    expect(openSettlementMeta(aberta('pay', '2026-09-07'), HOJE)?.tone).toBe(
      'text-destructive',
    )
  })

  it('hoje e prazo curto usam o âmbar canônico', () => {
    /* A mesma janela de 7 dias de Bancos, Pessoas e "Atenção agora". */
    for (const due of [HOJE, '2026-09-11', '2026-09-17']) {
      expect(openSettlementMeta(aberta('pay', due), HOJE)?.tone).toBe(
        'text-pending',
      )
    }
  })

  it('futuro distante é neutro', () => {
    /* Pintar todo evento futuro encheria a lista de tons sem hierarquia. */
    expect(openSettlementMeta(aberta('pay', '2026-09-18'), HOJE)?.tone).toBe('')
    expect(openSettlementMeta(aberta('pay', '2026-10-30'), HOJE)?.tone).toBe('')
  })

  it('o sinal de atraso é exposto à parte', () => {
    expect(isSettlementOverdue(aberta('pay', '2026-09-07'), HOJE)).toBe(true)
    expect(isSettlementOverdue(aberta('pay', '2026-09-15'), HOJE)).toBe(false)
  })
})

describe('F5: a composição bilateral saiu da hierarquia principal', () => {
  it('a page não usa mais a metadata do peopleRowView na row', () => {
    expect(BUDGET_CODE).not.toContain('view.metadata[0]')
    expect(BUDGET_CODE).toContain('settlementRowMeta(view.status,')
  })

  it('mas continua no domínio — nada foi apagado', () => {
    /*
      `open.receivableTotal`/`debtTotal` seguem no read model, e o drawer da
      pessoa é a superfície onde a composição pertence.
    */
    const servico = semComentarios(ler('../services/budget.service.ts'))
    expect(servico).toContain('receivableTotal')
    expect(servico).toContain('debtTotal')
    expect(BUDGET_CODE).toContain('PersonStatementDrawer')
  })

  it('sem evento, a row fica sem subtexto', () => {
    /*
      `null` é resultado legítimo: saldo zero com itens dos dois lados não tem
      um sentido a destacar. Texto que não informa ocuparia a linha.
    */
    expect(openSettlementMeta({ nextItem: null, settledAt: null }, HOJE)).toBeNull()
    expect(
      openSettlementMeta({ nextItem: undefined, settledAt: null }, HOJE),
    ).toBeNull()
  })
})

describe('F7-F9: row resolvida', () => {
  it('F7/F8: data inequívoca vira "Quitado em DD/MM"', () => {
    expect(settledSettlementMeta({ nextItem: null, settledAt: '2026-08-18' }).text)
      .toBe('Quitado em 18/08/2026')
  })

  it('F9: sem data defensável, fallback honesto', () => {
    /*
      Nada aqui escolhe uma data qualquer para preencher a linha. "Acerto
      concluído" diz o que se sabe.
    */
    expect(settledSettlementMeta({ nextItem: null, settledAt: null }).text).toBe(
      'Acerto concluído',
    )
  })

  it('F10/F11: o verbo NÃO repete o trailing', () => {
    /*
      O trailing diz PAGO ou RECEBIDO. "Quitado" serve aos dois sentidos e é o
      que evita "Pago em 18/08 · PAGO" na mesma linha — a duplicação que a fase
      anterior removeu.
    */
    for (const settledAt of ['2026-08-18', null]) {
      const texto = settledSettlementMeta({ nextItem: null, settledAt }).text
      expect(texto).not.toMatch(/^Pago$/)
      expect(texto).not.toMatch(/^Recebido$/)
      expect(texto).not.toContain('Pago em')
      expect(texto).not.toContain('Recebido em')
    }
  })

  it('resolvido é sempre neutro', () => {
    /*
      Um acerto concluído não tem prazo a cumprir, e o verde já está no
      trailing. Pintar a data faria a linha comunicar sucesso duas vezes.
    */
    expect(settledSettlementMeta({ nextItem: null, settledAt: '2026-08-18' }).tone)
      .toBe('')
    expect(settledSettlementMeta({ nextItem: null, settledAt: null }).tone).toBe('')
  })

  it('a row resolvida nunca fica sem metadata', () => {
    /*
      O problema visual relatado: nome à esquerda e nada abaixo, com duas
      linhas à direita — o título parecia flutuar.
    */
    for (const settledAt of ['2026-08-18', null]) {
      const meta = settlementRowMeta('settled', { nextItem: null, settledAt })
      expect(meta).not.toBeNull()
      expect(meta!.text.length).toBeGreaterThan(0)
    }
  })
})

describe('o estado escolhe a metadata', () => {
  it('resolvida ignora um nextItem residual', () => {
    /*
      Uma linha quitada com `nextItem` preenchido (de outra competência) não
      pode exibir prazo: afirmaria pendência inexistente.
    */
    const meta = settlementRowMeta('settled', {
      nextItem: { direction: 'pay', dueDate: '2026-09-15' },
      settledAt: '2026-08-18',
    })

    expect(meta?.text).toBe('Quitado em 18/08/2026')
  })

  it('aberta ignora um settledAt residual', () => {
    const meta = settlementRowMeta(
      'open',
      {
        nextItem: { direction: 'pay', dueDate: '2026-09-15' },
        settledAt: '2026-08-18',
      },
      HOJE,
    )

    expect(meta?.text).toBe('Pagar em 5d')
  })
})

describe('F28: regressão Fabricio', () => {
  it('devendo, a metadata vem do lado da DÍVIDA', () => {
    /*
      R$ 10 a receber e R$ 11 a pagar: o recebível vence antes, então o evento
      globalmente mais urgente é dele. A row diz "VOCÊ DEVE", e exibir
      "Receber em 2d" embaixo seria correto e ilegível ao mesmo tempo.

      O backend já resolve o sentido (`open.nextItem` segue o saldo); este caso
      fixa que a apresentação não o reinterpreta.
    */
    const meta = openSettlementMeta(
      { nextItem: { direction: 'pay', dueDate: '2026-09-15' }, settledAt: null },
      HOJE,
    )

    expect(meta?.text).toBe('Pagar em 5d')
    expect(meta?.text).not.toContain('Receber')
    expect(meta?.text).not.toContain('a receber')
    expect(meta?.text).not.toContain('a pagar')
  })
})

describe('F17: row de dívida', () => {
  it('aberta mostra o prazo, com o verbo de pagamento', () => {
    expect(
      debtRowMeta(
        { dueDate: '2026-09-15', settledAt: null, isPaid: false },
        HOJE,
      )?.text,
    ).toBe('Pagar em 5d')
  })

  it('atrasada usa o vermelho canônico', () => {
    const meta = debtRowMeta(
      { dueDate: '2026-08-25', settledAt: null, isPaid: false },
      HOJE,
    )

    expect(meta?.text).toBe('Pagar atrasado 16d')
    expect(meta?.tone).toBe('text-destructive')
  })

  it('paga com data usa o mesmo "Quitado em"', () => {
    expect(
      debtRowMeta(
        { dueDate: null, settledAt: '2026-09-08', isPaid: true },
        HOJE,
      )?.text,
    ).toBe('Quitado em 08/09/2026')
  })

  it('paga sem data fala do objeto certo', () => {
    /*
      "Acerto concluído" é a frase das rows agregadas de pessoa; uma dívida é
      uma obrigação, e "Pagamento concluído" diz o mesmo sobre ela.
    */
    expect(
      debtRowMeta({ dueDate: null, settledAt: null, isPaid: true }, HOJE)?.text,
    ).toBe('Pagamento concluído')
  })

  it('sem data e aberta não inventa metadata', () => {
    expect(
      debtRowMeta({ dueDate: null, settledAt: null, isPaid: false }, HOJE),
    ).toBeNull()
  })

  it('paga nunca exibe prazo', () => {
    /* Mesmo com `dueDate` preenchido: não há prazo a cumprir. */
    expect(
      debtRowMeta(
        { dueDate: '2026-09-15', settledAt: '2026-09-08', isPaid: true },
        HOJE,
      )?.text,
    ).toBe('Quitado em 08/09/2026')
  })
})

describe('F6: a page aplica a policy sem mexer no resto', () => {
  it('as duas rows recebem metadata', () => {
    expect(BUDGET_CODE).toContain('settlementRowMeta(view.status,')
    expect(BUDGET_CODE).toContain('debtRowMeta(item)')
    expect(BUDGET_CODE).toContain('metaAcerto')
    expect(BUDGET_CODE).toContain('metaDivida')
  })

  it('amount e trailing seguem intactos', () => {
    expect(BUDGET_CODE).toContain('peopleRowStatusLabel(view.status, view.direction)')
    expect(BUDGET_CODE).toContain('amount={quitado ? view.amount : Math.abs(view.amount)}')
    expect(BUDGET_CODE).toContain('cfg.trailingLabel')
  })

  it('probe 12: a fatura não foi tocada', () => {
    /* Invoice já estava correta: mesma metadata, mesmo trailing. */
    expect(BUDGET_CODE).toContain('invoiceRowPresentation(inv)')
    expect(BUDGET_CODE).toContain('apresentacao.timingLabel')
    expect(BUDGET_CODE).toContain('apresentacao.statusLabel')
  })

  it('probe 31: a row não ganha um terceiro nível à esquerda', () => {
    /*
      Prazo E composição juntos empilhariam três linhas do lado esquerdo. A
      metadata é UMA.
    */
    const bloco = BUDGET_CODE.slice(
      BUDGET_CODE.indexOf('visiblePeople.map('),
      BUDGET_CODE.indexOf('visiblePeople.map(') + 2400,
    )
    const metas = bloco.match(/meta=\{/g) ?? []
    expect(metas.length).toBe(1)
  })

  it('probe 10: o domínio financeiro não passa por aqui', () => {
    const meta = semComentarios(ler('./budget-settlement-meta.ts'))
    /* Nenhuma aritmética de valor: o helper só escolhe texto e tom. */
    expect(meta).not.toContain('totalToPay')
    expect(meta).not.toContain('payable')
    expect(meta).not.toContain('amount')
  })

  it('probe 6: nenhum cálculo de dias com milissegundos', () => {
    /*
      A conversão de fuso vive nos helpers canônicos (`civilDay` no backend,
      `diasEntre` no frontend). Um `getTime()/86400000` local produziria
      off-by-one em fuso negativo.
    */
    const meta = ler('./budget-settlement-meta.ts')
    expect(meta).not.toContain('86400000')
    expect(meta).not.toContain('getTime()')
    expect(meta).not.toContain('toISOString')
  })
})
