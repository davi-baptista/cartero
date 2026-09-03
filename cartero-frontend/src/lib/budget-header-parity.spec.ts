import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O topo do Orçamento na anatomia de Bancos e Pessoas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * As três telas respondem a mesma classe de pergunta sobre o mês, e Bancos
 * fixou a forma:
 *
 *   label       "Faturas de setembro 2026"     ancora o número
 *   valor       R$ 1.183,95                    o fato
 *   composição  de onde ele vem                explica
 *   estado      "Tudo em dia"                  conclui
 *
 * O Orçamento divergia em três pontos:
 *
 *   · não tinha label — "R$ 1.473,85" abria o bloco sem dizer de quê;
 *   · a composição usava `mt-2 text-xs` (Bancos: `mt-0.5 text-[11px]`);
 *   · as linhas de estado viviam FORA do bloco, irmãs dele num `space-y-4`,
 *     herdando 16px de respiro em vez dos 2px do bloco.
 *
 * O terceiro era a causa do "Tudo em dia" solto: não era falta de `mt`, era
 * estar no nível errado da árvore.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const BUDGET = semComentarios(ler('../app/(dashboard)/budget/page.tsx'))
const BANKS = semComentarios(ler('../app/(dashboard)/banks/page.tsx'))
const PERSONS = semComentarios(ler('../app/(dashboard)/persons/page.tsx'))

/**
 * O bloco do resumo, delimitado pelas suas pontas reais.
 *
 * A janela precisa terminar onde o bloco termina: uma fatia larga alcançaria
 * a seção de Faturas logo abaixo e mediria o espaçamento dela — que é outro
 * contexto e legitimamente diferente.
 */
function blocoResumo(code: string): string {
  const inicio = code.indexOf('Saídas de {formatMonthYear')
  const fim = code.indexOf('Tudo em dia', inicio)

  return code.slice(inicio - 200, fim)
}

describe('linha 1: a label que ancora o número', () => {
  it('existe, e nomeia conteúdo + competência', () => {
    /*
      "R$ 1.473,85" sozinho não diz de que competência é nem do que se trata.
      "Saídas" cobre faturas, pagamentos, dívidas e acertos — nomear só um
      prometeria menos do que o total soma.
    */
    expect(BUDGET).toContain('Saídas de {formatMonthYear(period.month, period.year)}')
  })

  it('usa a MESMA escala tipográfica de Bancos', () => {
    const escala = 'text-xs font-medium text-muted-foreground'

    expect(BUDGET).toContain(escala)
    expect(BANKS).toContain(escala)
  })

  it('fica FORA do ramo de carregamento', () => {
    /*
      Não depende dos dados. Sumindo enquanto carrega, o bloco saltaria quando
      eles chegassem — e o esqueleto passa a cobrir só o valor, como em Bancos.
    */
    const i = BUDGET.indexOf('Saídas de {formatMonthYear')
    const j = BUDGET.indexOf('{isLoading ? (')

    expect(i).toBeGreaterThan(0)
    expect(j).toBeGreaterThan(i)
  })

  it('o esqueleto do valor é o de Bancos', () => {
    expect(BUDGET).toContain('<Skeleton className="mt-1.5 h-7 w-32" />')
    expect(BANKS).toContain('<Skeleton className="mt-1.5 h-7 w-32" />')
  })
})

describe('linha 2: o valor principal', () => {
  it('a escala é idêntica nas três telas', () => {
    const escala = 'text-[22px] font-semibold tabular-nums tracking-[-0.02em]'

    for (const [nome, code] of [
      ['budget', BUDGET],
      ['banks', BANKS],
      ['persons', PERSONS],
    ] as const) {
      expect(code, nome).toContain(escala)
    }
  })

  it('continua neutro', () => {
    /*
      O número não é erro, atraso nem conquista — é o custo normal da
      competência. Quem diz o estado é a linha de "Tudo em dia".
    */
    const i = BUDGET.indexOf('formatCurrency(summary.totalToPay)')
    const antes = BUDGET.slice(i - 200, i)

    expect(antes).not.toContain('text-paid')
    expect(antes).not.toContain('text-destructive')
  })

  it('o valor exibido não mudou', () => {
    /* Fase visual: nenhum número foi recalculado. */
    expect(BUDGET).toContain('formatCurrency(summary.totalToPay)')
  })
})

describe('linhas 3 e 4: o ritmo vertical', () => {
  it('a composição usa a escala de Bancos', () => {
    /* Era `mt-2 text-xs`: dois passos maiores que o padrão. */
    expect(BUDGET).toContain('mt-0.5 text-[11px] text-muted-foreground')
    expect(BANKS).toContain('mt-0.5 text-[11px] text-muted-foreground')
  })

  it('nenhuma linha do bloco usa mais `mt-2`', () => {
    const bloco = blocoResumo(BUDGET)

    expect(bloco).not.toContain('mt-2 text-xs')
  })

  it('"Tudo em dia" está DENTRO do bloco, com o mesmo `mt`', () => {
    /*
      A causa do "solto": vivia fora do `div`, irmão dele num `space-y-4`, e
      herdava 16px em vez dos 2px do bloco. Não era falta de `mt` — era nível
      errado na árvore.
    */
    expect(BUDGET).toContain('mt-0.5 text-[11px] font-medium text-paid')
  })

  it('nenhuma linha do bloco usa `text-xs` sem `mt`', () => {
    /*
      Segundo guardião do "solto": as duas linhas de estado saíam como
      `text-xs` puro, sem `mt` nenhum — e era isso que as fazia herdar o
      espaçamento do container em vez do ritmo do bloco.
    */
    const bloco = blocoResumo(BUDGET)

    expect(bloco).not.toContain('className="text-xs text-muted-foreground"')
    expect(bloco).not.toContain('className="text-xs font-medium text-paid"')
  })

  it('as linhas de estado vêm DEPOIS da composição, no mesmo pai', () => {
    /*
      Terceiro guardião, sobre a estrutura e não sobre a classe: se `hasMix` ou
      `tudoEmDia` voltarem a sair do bloco, caem fora da janela medida e este
      caso falha.
    */
    const bloco = blocoResumo(BUDGET)

    expect(bloco).toContain('{hasMix && (')
    expect(bloco).toContain('{tudoEmDia && (')
  })

  it('a divisão pago/a pagar também', () => {
    const i = BUDGET.indexOf('formatCurrency(summary.totalPaid)} pago')
    const antes = BUDGET.slice(i - 260, i)

    expect(antes).toContain('mt-0.5 text-[11px]')
  })

  it('o container não espaça mais nada por fora', () => {
    /*
      O `space-y-4` sobreviveria como código morto — com um filho por ramo do
      condicional, não espaça nada, e foi justamente ele que empurrou as linhas
      de estado. Bancos não tem equivalente.
    */
    const bloco = blocoResumo(BUDGET)

    expect(bloco).not.toContain('space-y-4')
    expect(BANKS).not.toContain('space-y-4')
  })

  it('o ritmo é uniforme: `mt-0.5` do label ao fim', () => {
    /*
      A propriedade que define "mesma sensação visual": um único passo de
      espaçamento entre todas as linhas do bloco.
    */
    const bloco = blocoResumo(BUDGET)
    /*
      `mt-[0-9.]+` e não uma alternância com `\b`: naquela, `mt-1` casaria o
      PREFIXO de `mt-1.5` e o teste acusaria um passo que não existe.
    */
    const passos = [...new Set(bloco.match(/mt-[0-9.]+/g) ?? [])].sort()

    /* `mt-1.5` é só o esqueleto de carregamento, como em Bancos. */
    expect(passos.filter((p) => p !== 'mt-1.5')).toEqual(['mt-0.5'])
  })
})

describe('sem regressão', () => {
  it('a copy das seções abaixo está intacta', () => {
    for (const copy of [
      'Pendências anteriores',
      'Venceram antes deste mês',
      'Acertos com pessoas',
      'Total das faturas',
      'Tudo em dia',
      'nada a pagar neste mês',
    ]) {
      expect(BUDGET, copy).toContain(copy)
    }
  })

  it('o cabeçalho da página não foi tocado', () => {
    /* `h1` + subtítulo continuam como estavam; a label é uma quarta linha. */
    expect(BUDGET).toContain('text-2xl font-semibold tracking-tight')
    expect(BUDGET).toContain('Quanto sai do seu bolso neste mês')
  })

  it('as rows abaixo não mudaram', () => {
    for (const marca of [
      'invoiceRowPresentation(inv)',
      'settlementRowMeta(view.status,',
      'debtRowMeta(item)',
      'apresentacao.statusLabel',
    ]) {
      expect(BUDGET, marca).toContain(marca)
    }
  })

  it('hover, foco e clique seguem no primitive', () => {
    const row = semComentarios(ler('../components/ui/status-list-row.tsx'))

    expect(row).toContain('hover:bg-muted/30')
    expect(row).toContain('focus-visible:ring-3')
    expect(row).not.toContain('group-hover:text-primary')
  })

  it('a semântica de cor do resolvido sobrevive', () => {
    expect(BUDGET).toContain('text-paid')
    expect(ler('./budget-row-view.ts')).toContain('ROW_RESOLVED_TONE')
  })

  it('nada de domínio financeiro no diff', () => {
    /* Os agregados continuam vindo fechados do backend. */
    for (const campo of [
      'summary.totalToPay',
      'summary.totalPaid',
      'summary.totalPending',
      'breakdownParts',
    ]) {
      expect(BUDGET, campo).toContain(campo)
    }
  })

  it('a acessibilidade da composição continua', () => {
    /* O `aria-label` carrega o detalhamento que a linha compacta resume. */
    expect(BUDGET).toContain('budgetBreakdownAriaLabel(')
  })
})

describe('paridade estrutural com Bancos', () => {
  it('as três telas abrem o bloco com uma label', () => {
    expect(BUDGET).toContain('Saídas de {formatMonthYear')
    expect(BANKS).toContain('Faturas de {formatMonthYear')
    expect(PERSONS).toContain('Saldo com pessoas')
  })

  it('a label vem ANTES do valor nas três', () => {
    const ordem = (code: string, label: string, valor: string) =>
      code.indexOf(label) < code.indexOf(valor) &&
      code.indexOf(label) > 0

    expect(
      ordem(BUDGET, 'Saídas de {formatMonthYear', 'formatCurrency(summary.totalToPay)'),
    ).toBe(true)
    expect(
      ordem(BANKS, 'Faturas de {formatMonthYear', 'formatCurrency(monthSummary.total)'),
    ).toBe(true)
  })
})
