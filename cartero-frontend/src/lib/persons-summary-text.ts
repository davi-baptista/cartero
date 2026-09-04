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
 *
 * ── O total NÃO alterna de universo ──
 *
 * O valor grande e a composição eram outstanding enquanto houvesse pendência e
 * histórico depois de tudo quitado. O mesmo lugar da tela mudava de
 * significado sem avisar: receber R$ 400 fazia o total cair de R$ 1.000 para
 * R$ 600, como se o mês tivesse movimentado menos.
 *
 * Agora o total é SEMPRE o histórico da competência, e o que ainda falta ganha
 * linha própria. Estabilidade é o ponto: o mês movimentou o que movimentou, e
 * quitar não reescreve isso.
 *
 * A diferença em relação às ROWS é intencional e permanece:
 *
 *   resumo      "quanto aconteceu no mês, e quanto ainda está aberto?"
 *   row ACTIVE  "quanto ainda falta acertar com esta pessoa?"
 *
 * ── O progresso de Pessoas é BILATERAL ──
 *
 * Bancos pode dizer "R$ X pago · R$ Y para quitar" porque a obrigação tem um
 * sentido só. Aqui podem coexistir valor a receber e valor a pagar, e resolver
 * um lado pode até AUMENTAR o módulo do líquido em aberto.
 *
 * Por isso a linha mostra os dois lados, nunca o líquido: R$ 200 abertos de
 * cada lado dão líquido zero com R$ 400 em obrigações vivas. "Em aberto: R$ 0"
 * anunciaria trabalho concluído que não foi feito — e é o mesmo caso que
 * protege o estado `A ACERTAR`.
 */

export interface PersonsSummary {
  /**
   * Total HISTÓRICO a receber no período — não diminui ao receber.
   *
   * O nome sempre disse "histórico"; a página é que alternava a origem antes
   * de chamar. Agora o contrato é cumprido.
   */
  toReceive: number
  /** Total HISTÓRICO a pagar no período — não diminui ao pagar. */
  toPay: number
  /** O que ainda falta receber na competência. */
  openToReceive: number
  /** O que ainda falta pagar na competência. */
  openToPay: number
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

export type SummaryLineKind = 'empty' | 'composition' | 'open' | 'settled'

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
 * No máximo duas: a composição histórica e, em seguida, o estado — o que ainda
 * está aberto ou a conclusão. Acima disso o resumo começa a competir com a
 * lista, que é o conteúdo da tela.
 *
 * A segunda linha é EXCLUSIVA entre `open` e `settled`: são respostas opostas
 * à mesma pergunta, e emitir as duas seria contraditório.
 */
export function personsSummaryLines(s: PersonsSummary): PersonsSummaryLine[] {
  /*
    Sem movimento não há história a contar, e nada em aberto a informar. Não
    existe linha "Em aberto: R$ 0 · R$ 0" — ruído sobre um mês que não
    aconteceu.
  */
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
    return linhas
  }

  /*
    ── Os DOIS lados, sempre ──

    A gramática é fixa mesmo quando um lado é zero: "Em aberto: R$ 437,64 a
    receber · R$ 0,00 a pagar" mantém a estrutura previsível, e o olho aprende
    onde cada número fica. Omitir dinamicamente faria a mesma linha mudar de
    forma entre dois meses.

    Nunca o líquido: R$ 200 de cada lado dariam "R$ 0" com R$ 400 abertos.
  */
  linhas.push({
    kind: 'open',
    text: `Em aberto: ${money(s.openToReceive)} a receber · ${money(s.openToPay)} a pagar`,
  })

  return linhas
}
