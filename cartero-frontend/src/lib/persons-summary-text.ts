/**
 * ══════════════════════════════════════════════════════════════════════════
 * O resumo de Pessoas responde DUAS perguntas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O valor grande é o líquido HISTÓRICO da competência. Ele deixa duas perguntas
 * em aberto, e elas são independentes:
 *
 *   composição   "de onde veio esse saldo?"
 *   quitação     "ainda existe algo pendente?"
 *
 * A versão anterior tratava as duas como uma escolha excludente: com tudo
 * resolvido, exibia só "Tudo resolvido neste mês" e a composição DESAPARECIA.
 * Então um mês encerrado dizia R$ 1.335,77 sem nunca informar que aquilo eram
 * R$ 1.335,77 a receber e R$ 0,00 a pagar — o saldo ficava sem origem.
 *
 * Agora são linhas separadas, porque são fatos separados.
 *
 * ── Por que "Tudo em dia", e não "Tudo resolvido neste mês" ──
 *
 * É a frase que Bancos já usa para o mesmo estado, no mesmo lugar da tela, no
 * mesmo `text-paid`. Duas frases para o mesmo fato fariam o usuário procurar a
 * diferença que não existe.
 *
 * ── Mês sem movimento não recebe elogio ──
 *
 * Nunca ter tido nada com ninguém e ter quitado tudo são fatos diferentes.
 * "Tudo em dia" sobre um mês vazio afirmaria uma conclusão que não houve — é a
 * mesma razão pela qual Bancos diz "Nenhuma fatura neste mês" em vez de
 * parabenizar quem simplesmente não gastou.
 */

export interface PersonsSummary {
  /** Total histórico a receber no período. */
  toReceive: number
  /** Total histórico a pagar no período. */
  toPay: number
  /**
   * Quantas pessoas ainda têm obrigação aberta.
   *
   * CONTAGEM, não soma: R$ 200 abertos de cada lado dão líquido zero com duas
   * obrigações vivas, e um total zerado faria o resumo anunciar "Tudo em dia"
   * com trabalho de settlement pendente.
   */
  outstanding: number
  /** Quantas pessoas movimentaram algo na competência. */
  comMovimento: number
}

export type SummaryLineKind = 'empty' | 'composition' | 'settled'

export interface PersonsSummaryLine {
  kind: SummaryLineKind
  text: string
}

/** `Intl` compartilhado — instanciar por chamada custa em lista longa. */
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function money(v: number): string {
  return BRL.format(v)
}

/**
 * As linhas abaixo do total.
 *
 * No máximo duas: composição e, quando tudo está resolvido, a conclusão. Acima
 * disso o resumo começa a competir com a lista, que é o conteúdo da tela.
 *
 * Não existe linha de "Em aberto": a própria lista e os status das rows já
 * comunicam pendência, e uma terceira linha só repetiria.
 */
export function personsSummaryLines(s: PersonsSummary): PersonsSummaryLine[] {
  if (s.comMovimento === 0) {
    return [{ kind: 'empty', text: 'Nenhuma movimentação neste mês' }]
  }

  const linhas: PersonsSummaryLine[] = [
    {
      kind: 'composition',
      text: `${money(s.toReceive)} a receber · ${money(s.toPay)} a pagar`,
    },
  ]

  /*
    A conclusão é sobre o que RESTA, não sobre o histórico.

    Um mês passado com pendência vencida mantém a composição e NÃO ganha esta
    linha — dizer "Tudo em dia" com uma dívida em atraso seria falso, e a row
    urgente já aparece com seu próprio sinal.
  */
  if (s.outstanding === 0) {
    linhas.push({ kind: 'settled', text: 'Tudo em dia' })
  }

  return linhas
}
