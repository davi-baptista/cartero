import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  competenceCard,
  competenceCardSign,
  competenceHasActivity,
  type CompetenceCardSource,
} from './person-competence-card'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O card do drawer não apaga o histórico do mês
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Abrindo um mês passado já quitado, o topo dizia "Nada a acertar · R$ 0,00":
 * verdade sobre a pendência, e inútil como leitura — o mês pode ter
 * movimentado centenas de reais, e para saber quanto o usuário tinha de somar
 * as linhas do histórico abaixo.
 *
 * A causa é a mesma que a lista de Pessoas já corrigiu: o resumo saía de
 * `openItemsFor(...)`, que filtra só o que está EM ABERTO.
 *
 *   ABERTA    "quanto ainda falta acertar?"   → saldo em aberto
 *   QUITADA   "qual foi o saldo do mês?"      → saldo histórico
 *   VAZIA     nada houve                      → zero
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DRAWER = semComentarios(
  ler('../components/person-statement-drawer.tsx'),
)

function fonte(p: Partial<CompetenceCardSource> = {}): CompetenceCardSource {
  return {
    openReceivableTotal: 0,
    openDebtTotal: 0,
    openItemCount: 0,
    settledReceivableTotal: 0,
    settledDebtTotal: 0,
    settledItemCount: 0,
    settledAt: null,
    ...p,
  }
}

describe('competência ABERTA: o saldo a acertar', () => {
  it('a receber', () => {
    const c = competenceCard(
      fonte({ openReceivableTotal: 500, openItemCount: 2 }),
    )

    expect(c.mode).toBe('open')
    expect(c.label).toBe('Saldo a receber')
    expect(c.net).toBe(500)
    expect(c.showSettleAction).toBe(true)
    expect(c.settledNote).toBeNull()
  })

  it('a pagar', () => {
    const c = competenceCard(fonte({ openDebtTotal: 330, openItemCount: 1 }))

    expect(c.label).toBe('Saldo a pagar')
    expect(c.net).toBe(-330)
    expect(competenceCardSign(c)).toBe('-')
  })

  it('líquido zero COM pendência continua ABERTA', () => {
    /*
      R$ 200 de cada lado se anulam, mas há duas obrigações vivas. Chamar isso
      de quitado seria o mesmo erro que a lista de Pessoas corrigiu.
    */
    const c = competenceCard(
      fonte({
        openReceivableTotal: 200,
        openDebtTotal: 200,
        openItemCount: 2,
      }),
    )

    expect(c.mode).toBe('open')
    expect(c.label).toBe('Saldo a acertar')
    expect(c.net).toBe(0)
    expect(c.showSettleAction).toBe(true)
    expect(c.settledNote).toBeNull()
  })

  it('a composição é a do universo EM ABERTO', () => {
    /*
      Com item resolvido e item aberto, a composição fala do que falta — o
      histórico só assume quando nada resta.
    */
    const c = competenceCard(
      fonte({
        openReceivableTotal: 200,
        openItemCount: 1,
        settledReceivableTotal: 300,
        settledItemCount: 1,
      }),
    )

    expect(c.receivableTotal).toBe(200)
    expect(c.net).toBe(200)
    expect(c.net).not.toBe(500)
  })
})

describe('competência QUITADA: o saldo final do mês', () => {
  it('a regressão relatada: não mostra R$ 0,00', () => {
    /*
      Mês passado inteiramente recebido. O card dizia "Nada a acertar ·
      R$ 0,00" e o histórico de R$ 500 desaparecia da leitura rápida.
    */
    const c = competenceCard(
      fonte({
        settledReceivableTotal: 500,
        settledItemCount: 2,
        settledAt: '2026-08-18',
      }),
    )

    expect(c.mode).toBe('settled')
    expect(c.net).toBe(500)
    expect(c.net).not.toBe(0)
    expect(c.label).toBe('Saldo final do mês')
  })

  it('o título nomeia o que o número é', () => {
    /*
      "Nada a acertar" fala de pendência; mantê-lo sobre um valor histórico
      faria os dois se contradizerem.
    */
    const c = competenceCard(
      fonte({ settledDebtTotal: 330, settledItemCount: 1 }),
    )

    expect(c.label).not.toBe('Nada a acertar')
    expect(c.label).toBe('Saldo final do mês')
  })

  it('mês pago tem líquido negativo', () => {
    const c = competenceCard(
      fonte({
        settledDebtTotal: 330,
        settledItemCount: 1,
        settledAt: '2026-08-18',
      }),
    )

    expect(c.net).toBe(-330)
    expect(competenceCardSign(c)).toBe('-')
  })

  it('a composição é a do HISTÓRICO', () => {
    const c = competenceCard(
      fonte({
        settledReceivableTotal: 500,
        settledDebtTotal: 200,
        settledItemCount: 3,
      }),
    )

    expect(c.receivableTotal).toBe(500)
    expect(c.debtTotal).toBe(200)
    expect(c.net).toBe(300)
  })

  it('com data defensável, diz quando', () => {
    const c = competenceCard(
      fonte({
        settledReceivableTotal: 500,
        settledItemCount: 2,
        settledAt: '2026-08-18',
      }),
    )

    expect(c.settledNote).toBe('Quitado em 18/08/2026')
  })

  it('sem data, fallback honesto', () => {
    /*
      Vários itens podem ter sido resolvidos em dias diferentes, e o drawer só
      afirma a data quando todos os resolvidos têm `paidAt`.
    */
    const c = competenceCard(
      fonte({ settledReceivableTotal: 500, settledItemCount: 2 }),
    )

    expect(c.settledNote).toBe('Tudo quitado')
  })

  it('não oferece ação de quitar', () => {
    /* Não há o que quitar — e o botão prometeria uma ação sem efeito. */
    const c = competenceCard(
      fonte({ settledReceivableTotal: 500, settledItemCount: 2 }),
    )

    expect(c.showSettleAction).toBe(false)
  })

  it('líquido zero QUITADO não é vazio', () => {
    /*
      R$ 200 de cada lado, tudo liquidado: o líquido é zero, mas houve
      movimento. "Nada a acertar" afirmaria que nunca teve nada com a pessoa.
    */
    const c = competenceCard(
      fonte({
        settledReceivableTotal: 200,
        settledDebtTotal: 200,
        settledItemCount: 2,
        settledAt: '2026-08-20',
      }),
    )

    expect(c.mode).toBe('settled')
    expect(c.net).toBe(0)
    expect(c.label).toBe('Saldo final do mês')
    expect(c.settledNote).toBe('Quitado em 20/08/2026')
  })
})

describe('competência VAZIA', () => {
  it('nada houve: continua "Nada a acertar"', () => {
    const c = competenceCard(fonte())

    expect(c.mode).toBe('empty')
    expect(c.label).toBe('Nada a acertar')
    expect(c.net).toBe(0)
    expect(c.settledNote).toBeNull()
    expect(c.showSettleAction).toBe(false)
  })

  it('os três estados de R$ 0,00 se distinguem', () => {
    /*
      O mesmo número, três significados — e a razão de o título e a nota
      existirem.
    */
    const aberto = competenceCard(
      fonte({ openReceivableTotal: 200, openDebtTotal: 200, openItemCount: 2 }),
    )
    const quitado = competenceCard(
      fonte({
        settledReceivableTotal: 200,
        settledDebtTotal: 200,
        settledItemCount: 2,
      }),
    )
    const vazio = competenceCard(fonte())

    expect([aberto.net, quitado.net, vazio.net]).toEqual([0, 0, 0])
    expect(new Set([aberto.mode, quitado.mode, vazio.mode]).size).toBe(3)
    expect(new Set([aberto.label, quitado.label, vazio.label]).size).toBe(3)
  })

  it('atividade é medida por CONTAGEM, não por valor', () => {
    /* Item de R$ 0 é raro mas legítimo — e continua sendo movimento. */
    expect(competenceHasActivity(fonte({ settledItemCount: 1 }))).toBe(true)
    expect(competenceHasActivity(fonte({ openItemCount: 1 }))).toBe(true)
    expect(competenceHasActivity(fonte())).toBe(false)
  })
})

describe('a ordem das perguntas', () => {
  it('pendência vence histórico', () => {
    /*
      Com item resolvido E item aberto, o card fala do que falta. Inverter
      faria uma competência com pendência exibir o saldo histórico.
    */
    const c = competenceCard(
      fonte({
        openDebtTotal: 100,
        openItemCount: 1,
        settledReceivableTotal: 900,
        settledItemCount: 2,
        settledAt: '2026-08-05',
      }),
    )

    expect(c.mode).toBe('open')
    expect(c.net).toBe(-100)
    expect(c.settledNote).toBeNull()
  })

  it('um settledAt residual não transforma em quitada', () => {
    const c = competenceCard(
      fonte({
        openDebtTotal: 50,
        openItemCount: 1,
        settledItemCount: 1,
        settledAt: '2026-08-05',
      }),
    )

    expect(c.mode).toBe('open')
    expect(c.showSettleAction).toBe(true)
  })
})

describe('o drawer aplica a policy', () => {
  it('o card sai do helper, não de `monthSummary` cru', () => {
    expect(DRAWER).toContain('competenceCard({')
    expect(DRAWER).toContain('cardCompetencia.label')
    expect(DRAWER).toContain('cardCompetencia.net')
    expect(DRAWER).not.toContain('competenceBalanceLabel(monthSummary)')
  })

  it('o histórico da competência alimenta o card', () => {
    /*
      O dado já vinha no payload (`period.settled*`, recortado por
      `belongsToHistoryCompetence` no backend) — faltava chegar ao card.
    */
    expect(DRAWER).toContain('data?.period.settledReceivableTotal')
    expect(DRAWER).toContain('data?.period.settledDebtTotal')
  })

  it('o valor do card é neutro', () => {
    /*
      Era verde/vermelho por direção — a mesma cor que a lista de Pessoas já
      removeu, porque o verde colidia com o verde de "quitado".
    */
    const bloco = DRAWER.slice(
      DRAWER.indexOf('cardCompetencia.label'),
      DRAWER.indexOf('cardCompetencia.label') + 900,
    )

    expect(bloco).not.toContain('text-receivable')
    expect(bloco).not.toContain('text-destructive')
    expect(bloco).toContain('competenceCardSign(cardCompetencia)')
  })

  it('o CTA some quando não há o que quitar', () => {
    expect(DRAWER).toContain('cardCompetencia.showSettleAction ?')
    expect(DRAWER).toContain('cardCompetencia.settledNote')
  })

  it('a nota de conclusão usa o verde de sucesso', () => {
    expect(DRAWER).toContain('text-paid')
  })
})

describe('o histórico ficou legível', () => {
  it('nenhum item resolvido é tachado', () => {
    /*
      O `line-through` cortava o nome E o valor. Um item histórico precisa
      continuar legível — a lista existe para ser consultada, não só para
      mostrar que algo acabou.
    */
    expect(DRAWER).not.toContain('line-through')
  })

  it('mas continua visualmente secundário', () => {
    /* O cinza já diz "isto é passado", sem custar legibilidade. */
    expect(DRAWER).toContain("item.isPaid && 'text-muted-foreground'")
    expect(DRAWER).toContain("? 'text-muted-foreground'")
  })

  it('e mantém o subtítulo de resolução', () => {
    expect(DRAWER).toContain('resolvedLabel')
  })
})

describe('a tipografia acompanha o drawer de Fatura', () => {
  const FATURA = semComentarios(
    ler('../components/invoice-details-drawer.tsx'),
  )

  it('os cabeçalhos de seção usam a mesma escala', () => {
    const escala = 'text-[11px] font-medium text-muted-foreground'

    expect(FATURA).toContain(escala)
    expect(DRAWER).toContain(escala)
  })

  it('os vazios de seção também', () => {
    expect(DRAWER).toContain('py-6 text-center text-[11px] text-muted-foreground')
  })
})
