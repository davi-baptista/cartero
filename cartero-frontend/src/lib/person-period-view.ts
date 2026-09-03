import type { NextSettlementItem } from '@/lib/person-next-item'
import { timingUrgency } from '@/lib/invoice-timing'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A row de Pessoas mostra o que HOUVE, e diz separadamente se foi resolvido
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Antes o valor era o saldo em ABERTO. Um mês inteiramente quitado virava
 * R$ 0,00 em todas as linhas, com "SEM SALDO" ao lado — e a lista deixava de
 * responder "quem devia a quem naquele mês?". Reconstruir o histórico exigia
 * abrir pessoa por pessoa.
 *
 * A separação é a mesma que Bancos já usa: uma fatura paga conserva o
 * `totalAmount` e muda o STATUS para "Paga". O valor responde "quanto houve no
 * ciclo"; o status responde "isso ainda está pendente?".
 *
 *   valor    período (pendências + resolvidos), invariável ao settlement
 *   status   derivado do que RESTA em aberto
 *
 * ── Sinal ──
 *
 * Positivo: a pessoa te deve. Negativo: você deve a ela. A convenção não muda
 * — só passa a ser calculada sobre o histórico em vez do saldo aberto.
 */

export type PersonRowStatus =
  | 'receivable'
  | 'debt'
  | 'received'
  | 'paid'
  | 'empty'

/** O mínimo que a row precisa saber da competência. */
export interface PeriodBalance {
  netBalance: number
  periodReceivableTotal: number
  periodDebtTotal: number
  settledReceivablesCount: number
  settledDebtsCount: number
  nextItem?: NextSettlementItem | null
}

const EPSILON = 0.005

/** O líquido HISTÓRICO do mês — o número que a row exibe. */
export function periodNetAmount(b: PeriodBalance): number {
  return b.periodReceivableTotal - b.periodDebtTotal
}

/** A competência movimentou algo, resolvido ou não? */
export function hasPeriodActivity(b: PeriodBalance): boolean {
  return (
    b.periodReceivableTotal > EPSILON ||
    b.periodDebtTotal > EPSILON ||
    b.settledReceivablesCount > 0 ||
    b.settledDebtsCount > 0
  )
}

/**
 * O status da row.
 *
 * ── A ordem das perguntas importa ──
 *
 * Primeiro "houve movimento?", depois "restou algo?". Inverter faria um mês
 * inteiramente resolvido cair em `empty` — o bug que esta fase corrige.
 *
 * ── Misto resolvido segue o sinal do líquido ──
 *
 * Com R$ 500 recebidos e R$ 200 pagos, a row diz `RECEBIDO`. Decisão de
 * produto: menos vocabulário na lista, e a composição dos dois lados fica no
 * drawer, onde há espaço para ela.
 */
export function personRowStatus(b: PeriodBalance): PersonRowStatus {
  if (!hasPeriodActivity(b)) return 'empty'

  /* Ainda há pendência: o status fala do que resta, não do que já foi. */
  if (Math.abs(b.netBalance) > EPSILON) {
    return b.netBalance > 0 ? 'receivable' : 'debt'
  }

  /*
    Nada em aberto, mas houve movimento — o mês está resolvido.

    O líquido histórico decide a palavra. Zero histórico com movimento (R$ 200
    de cada lado, tudo quitado) cai em `received` por convenção: a lista
    precisa de UMA palavra, e "resolvido" nos dois sentidos não distingue nada
    que o valor já não diga.
  */
  return periodNetAmount(b) < -EPSILON ? 'paid' : 'received'
}

/** Copy oficial do trailing. Texto, nunca só cor. */
export const PERSON_ROW_LABEL: Record<PersonRowStatus, string> = {
  receivable: 'A RECEBER',
  debt: 'VOCÊ DEVE',
  received: 'RECEBIDO',
  paid: 'PAGO',
  empty: 'SEM SALDO',
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Tom do trailing: cor comunica ESTADO, nunca direção
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `A RECEBER` era verde e `VOCÊ DEVE` vermelho — cor por direção do dinheiro.
 * O problema é que verde já significa OUTRA coisa no resto do produto: pago,
 * resolvido, tudo em dia. Os dois estados abaixo ficavam quase idênticos:
 *
 *   Eva   R$ 462,22 [verde]   A RECEBER [verde]   ainda falta receber
 *   Eva   R$ 720,45 [verde]   RECEBIDO  [verde]   já foi recebido
 *
 * Duas situações que exigem ações opostas, pintadas da mesma cor.
 *
 * A direção já está escrita — "A RECEBER" e "VOCÊ DEVE" são texto, e o sinal
 * do valor a repete. Cor não precisava carregar essa informação, e ao carregá-la
 * ficava indisponível para o que só a cor comunica bem: o que mudou de estado.
 *
 * É a policy que `BANK_TRAILING_TONE` já aplica em Bancos: só `paid` e
 * `overdue` ganham cor; `Fatura aberta` e `Fatura fechada` são estruturais e
 * ficam muted. O verde é o mesmo `text-paid` — não um segundo verde.
 */
export const PERSON_ROW_TONE: Record<PersonRowStatus, string> = {
  /* Pendências são o estado NORMAL de uma lista de acertos. */
  receivable: 'text-muted-foreground',
  debt: 'text-muted-foreground',
  /* Conclusão — o único fato que a cor precisa anunciar aqui. */
  received: 'text-paid',
  paid: 'text-paid',
  empty: 'text-muted-foreground',
}

/** Um mês resolvido não tem mais nada a fazer nele. */
export function isResolvedStatus(status: PersonRowStatus): boolean {
  return status === 'received' || status === 'paid'
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Mês resolvido não tem subtexto
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A versão anterior devolvia "Recebido"/"Pago" aqui, para ocupar o lugar do
 * prazo — deixar "Receber em 12d" numa linha quitada afirmaria uma pendência
 * inexistente, e isso continua verdade.
 *
 * Mas o trailing já diz `RECEBIDO`, então a row passou a repetir o mesmo
 * estado duas vezes:
 *
 *   Eva
 *   Recebido        R$ 720,45
 *                    RECEBIDO
 *
 * A segunda ocorrência não acrescenta nada. A correção certa era OMITIR o
 * subtexto, não substituí-lo.
 *
 * ── Por que não "Recebido em 28/08" ──
 *
 * Seria útil com uma obrigação só. Mas uma pessoa pode ter vários itens
 * resolvidos em datas diferentes, e escolher uma seria inventar um fato — as
 * datas reais de cada um estão no drawer, onde há espaço para todas.
 */
export function rowSubtext(
  status: PersonRowStatus,
  prazo: string | null,
): string | null {
  return isResolvedStatus(status) ? null : prazo
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O tom do prazo
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Só o atraso ganhava cor, então "Receber amanhã" e "Receber em 18d" saíam no
 * mesmo cinza: a urgência aparecia apenas se o usuário lesse o número.
 *
 * A régua é `timingUrgency` — a MESMA de Bancos e da "Atenção agora", com
 * `URGENT_DAYS_WINDOW = 7`. Não é uma escolha nova: o produto tem uma régua de
 * urgência, e telas que divergem dela fazem o mesmo prazo parecer urgente num
 * lugar e não no outro.
 *
 *   atrasado   destructive   exige ação agora
 *   hoje       pending       o prazo acaba hoje
 *   ≤7 dias    pending       ainda dá tempo, mas não muito
 *   depois     muted         é informação, não alerta
 *
 * Pintar todo evento futuro encheria a lista de tons sem hierarquia.
 *
 * ── O prazo é do PRESENTE, não do mês exibido ──
 *
 * Uma dívida de julho ainda aberta mostra "Receber atrasado 65d" mesmo com
 * julho selecionado. O atraso não deixa de existir por eu estar olhando um mês
 * antigo — é o mesmo princípio de "Atenção agora", que ignora o seletor.
 */
export function subtextTone(item: NextSettlementItem | null): string {
  if (!item) return ''

  /*
    Dia civil por string, nunca `new Date('YYYY-MM-DD')` — este último é
    interpretado como UTC e, em fuso negativo, devolve o dia anterior.
  */
  const [year, month, day] = item.dueDate.slice(0, 10).split('-').map(Number)

  switch (timingUrgency(new Date(year, month - 1, day))) {
    case 'overdue':
      return 'text-destructive'
    case 'today':
    case 'soon':
      return 'text-pending'
    case 'later':
      return ''
  }
}
