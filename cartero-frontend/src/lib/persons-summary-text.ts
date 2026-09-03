/**
 * ══════════════════════════════════════════════════════════════════════════
 * A linha secundária do resumo de Pessoas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O valor grande passou a ser o LÍQUIDO HISTÓRICO da competência — o que houve
 * no mês, quitado ou não. Isso deixa uma pergunta que o número não responde:
 * **ainda falta acertar algo?**
 *
 * Antes o total era o saldo em aberto, e a resposta vinha de graça: R$ 0,00
 * significava nada pendente. Ao preservar o histórico, "R$ 350,00" passa a
 * valer tanto para um mês em aberto quanto para um já recebido, e a distinção
 * precisa de texto.
 *
 * ── Por que não copiar "Tudo em dia" de Bancos ──
 *
 * Em Bancos a frase fala de PRAZO: não há fatura vencida nem por vencer. Aqui o
 * fato é outro — as obrigações do mês foram liquidadas —, e "em dia" sugeriria
 * pontualidade, que este domínio não mede. "Tudo resolvido" diz o que houve.
 *
 * ── Mês sem movimento ≠ mês resolvido ──
 *
 * Nunca ter tido nada com ninguém e ter quitado tudo são fatos diferentes.
 * Parabenizar quem simplesmente não emprestou nem pediu nada afirmaria uma
 * conclusão que não existiu.
 */

export interface PersonsSummary {
  toReceive: number
  toPay: number
  /** Soma dos dois sentidos do que ainda está aberto. */
  outstanding: number
  /** Quantas pessoas movimentaram algo na competência. */
  comMovimento: number
}

const EPSILON = 0.005

/** `Intl` compartilhado — instanciar por chamada custa em lista longa. */
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function money(v: number): string {
  return BRL.format(v)
}

export function personsSummaryText(s: PersonsSummary): string {
  if (s.comMovimento === 0) return 'Nenhuma movimentação neste mês'

  const composicao = `${money(s.toReceive)} a receber · ${money(s.toPay)} a pagar`

  /*
    Resolvido encerra a linha.

    Repetir a composição depois de "Tudo resolvido" faria o leitor procurar o
    que ainda falta — e não falta nada.
  */
  if (s.outstanding <= EPSILON) return 'Tudo resolvido neste mês'

  /*
    Com pendência, a composição é o fato útil: diz os dois lados do mês. O
    quanto resta em aberto aparece pessoa por pessoa nas rows, que é onde a
    ação acontece.
  */
  return composicao
}
