import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Hierarquia dos cabeçalhos de seção do Orçamento
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O resumo financeiro inline vivia DENTRO do `h2` e herdava
 * `text-[15px] font-semibold` — só o peso era sobrescrito. "Faturas" e
 * "R$ 888,74 sua parte · R$ 472,36 de outras pessoas" disputavam a mesma
 * hierarquia, e o cabeçalho ficava pesado.
 *
 * A suíte é de lógica pura, sem DOM, então aqui o alvo é a COMPOSIÇÃO: uma
 * classe compartilhada entre as duas seções. Sem isso, cada uma poderia
 * receber ajustes independentes e divergir na primeira mudança — que é
 * exatamente o que já aconteceu antes com o `mb-*` dos cabeçalhos.
 */

const PAGE = readFileSync(
  new URL('../app/(dashboard)/budget/page.tsx', import.meta.url),
  'utf-8',
)

describe('itens 36-37: título e resumo têm hierarquias distintas', () => {
  it('existe uma classe própria para o resumo inline', () => {
    expect(PAGE).toContain('const SECTION_SUMMARY_CLASS')
  })

  it('item 22: Faturas e Acertos compartilham a MESMA classe', () => {
    // Uma definição, dois usos — nunca dois estilos paralelos.
    const usos = PAGE.match(/SECTION_SUMMARY_CLASS/g) ?? []
    expect(usos.length).toBe(3)
  })

  it('item 26: o resumo é menor que o título, não o contrário', () => {
    const titulo = PAGE.match(
      /const SECTION_TITLE_CLASS = '([^']+)'/,
    )?.[1]
    const resumo = PAGE.match(
      /const SECTION_SUMMARY_CLASS =\s*'([^']+)'/,
    )?.[1]

    expect(titulo).toContain('text-[15px]')
    expect(titulo).toContain('font-semibold')

    // O resumo perde peso e tamanho; os títulos ficam como estavam.
    expect(resumo).toContain('text-[12px]')
    expect(resumo).toContain('font-normal')
    expect(resumo).not.toContain('font-semibold')
  })

  it('item 18/23: as cores semânticas permanecem', () => {
    // Terceiros em verde; a receber verde e a pagar vermelho.
    expect(PAGE).toContain('text-receivable')
    expect(PAGE).toContain('text-destructive')
  })
})

describe('itens 34-35: o topo foi simplificado', () => {
  it('o subtítulo explica o número principal', () => {
    expect(PAGE).toContain(
      'Quanto sai do seu bolso neste mês em faturas, pagamentos e dívidas.',
    )
  })

  it('item 3: o label acima do total saiu', () => {
    expect(PAGE).not.toContain('Total a pagar no mês')
  })

  it('item 4: a microcopy genérica abaixo saiu', () => {
    expect(PAGE).not.toContain('Inclui sua parte das faturas')
  })

  it('item 8: o bloco de renda saiu inteiro', () => {
    for (const trecho of [
      'Renda do mês',
      'comprometido',
      'Definir renda',
      'acima da renda',
      'livres',
    ]) {
      expect(PAGE).not.toContain(trecho)
    }
  })

  it('item 13: os divisores do bloco de renda saíram junto', () => {
    // Eram exclusivos daquele bloco; sem ele virariam linhas órfãs.
    expect(PAGE).not.toContain('border-y border-border/60')
  })

  it('item 5: o total continua vindo de `totalToPay`', () => {
    expect(PAGE).toContain('summary.totalToPay')
  })

  it('item 7: o topo não repete pendências anteriores', () => {
    /*
      Elas são ditas onde os itens aparecem — a seção "Pendências anteriores"
      e "Acertos com pessoas". No topo empilhavam frases sob o número.
    */
    expect(PAGE).not.toContain('de pendências\n                  anteriores em aberto')
    expect(PAGE).not.toContain('anteriores pagas neste mês\n                </p>')
  })
})
