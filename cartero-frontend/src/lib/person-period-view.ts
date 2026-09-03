import type { NextSettlementItem } from '@/lib/person-next-item'
import { timingUrgency } from '@/lib/invoice-timing'
import { formatDate } from '@/lib/formatters'
import { ROW_RESOLVED_TONE } from '@/components/ui/financial-list-row'

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
  /* ACTIVE: ainda falta acertar, e o saldo tem um lado. */
  | 'receivable'
  | 'debt'
  /* ACTIVE com saldo zero: os dois lados abertos se anulam no líquido. */
  | 'toSettle'
  /* SETTLED: a competência terminou de ser liquidada. */
  | 'finalBalance'
  /* EMPTY: não houve atividade. */
  | 'empty'

/** O mínimo que a row precisa saber da competência. */
export interface PeriodBalance {
  /** Outstanding: quanto AINDA falta acertar. Muda ao quitar. */
  netBalance: number
  /** Outstanding, por lado. */
  receivablePending: number
  debtPending: number
  /** Histórico: quanto a competência MOVIMENTOU. Invariável ao settlement. */
  periodReceivableTotal: number
  periodDebtTotal: number
  settledReceivablesCount: number
  settledDebtsCount: number
  nextItem?: NextSettlementItem | null
  /** `YYYY-MM-DD` da liquidação integral, ou `null`. */
  settledAt?: string | null
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
/**
 * ══════════════════════════════════════════════════════════════════════════
 * A row tem dois MODOS, e o número muda de significado entre eles
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   ACTIVE    "quanto ainda falta acertar?"    → outstanding
 *   SETTLED   "qual foi o saldo do mês?"       → histórico
 *   EMPTY     não houve atividade              → zero
 *
 * A fase anterior fez a row exibir o histórico para não perder o valor do mês
 * quando tudo era quitado. Correto no fim, mas cedo demais no meio: com R$ 500
 * a receber e R$ 300 já recebidos, a row seguia dizendo R$ 500 — e o número
 * útil ali é R$ 200, o que falta.
 *
 * ── Por que o modo NÃO pode sair de `netBalance === 0` ──
 *
 * Com R$ 200 abertos de cada lado o líquido é zero e as duas obrigações
 * continuam vivas. `personRowStatus` decidia por `Math.abs(netBalance)`, então
 * essa pessoa caía no ramo resolvido — a row dizia RECEBIDO com trabalho de
 * settlement pendente.
 *
 * A pergunta certa é "existe pendência?", e ela se responde pelos LADOS
 * (`receivablePending`/`debtPending`), não pelo líquido deles.
 */
export function hasOpenObligation(b: PeriodBalance): boolean {
  return b.receivablePending > EPSILON || b.debtPending > EPSILON
}

/** O líquido do que AINDA falta acertar — o valor do modo ACTIVE. */
export function outstandingNetAmount(b: PeriodBalance): number {
  return b.receivablePending - b.debtPending
}

/**
 * O status da row.
 *
 * ── A ordem das perguntas ──
 *
 *   1. há pendência?     → ACTIVE (mesmo com líquido zero)
 *   2. houve atividade?  → SETTLED
 *   3. nenhuma das duas  → EMPTY
 *
 * Pendência vem primeiro de propósito: é o único estado que pede ação, e
 * confundi-lo com resolvido é o erro mais caro dos três.
 */
export function personRowStatus(b: PeriodBalance): PersonRowStatus {
  if (hasOpenObligation(b)) {
    const liquido = outstandingNetAmount(b)

    /*
      Líquido zero COM pendência: não há um lado do saldo para nomear, e
      chamar de "A RECEBER" ou "VOCÊ DEVE" escolheria um arbitrariamente.
      `A ACERTAR` diz o que é verdade — falta acertar, nos dois sentidos.
    */
    if (Math.abs(liquido) <= EPSILON) return 'toSettle'

    return liquido > 0 ? 'receivable' : 'debt'
  }

  if (!hasPeriodActivity(b)) return 'empty'

  /*
    Sem pendência e com atividade: a competência foi integralmente liquidada.

    O valor volta a ser o HISTÓRICO, e é justamente por isso que o trailing
    muda para `SALDO FINAL`: um número que "cresce" depois da quitação
    pareceria bug sem a indicação explícita de que a base mudou.

    Um estado só para os dois sentidos — o sinal do valor já diz qual foi, e
    `RECEBIDO`/`PAGO` prometeriam um sentido que o líquido zero não tem.
  */
  return 'finalBalance'
}

/**
 * Copy oficial do trailing. Texto, nunca só cor.
 *
 * `SALDO FINAL` substituiu `RECEBIDO`/`PAGO` no estado resolvido: o número
 * daquela row é o saldo HISTÓRICO do mês, não o que falta, e a mudança de
 * base precisa estar dita. "Recebido" descreveria o evento sem avisar que o
 * valor ao lado passou a significar outra coisa.
 *
 * `A ACERTAR` é o líquido zero com pendência: nenhum dos dois sentidos manda,
 * mas há trabalho a fazer.
 */
export const PERSON_ROW_LABEL: Record<PersonRowStatus, string> = {
  receivable: 'A RECEBER',
  debt: 'VOCÊ DEVE',
  toSettle: 'A ACERTAR',
  finalBalance: 'SALDO FINAL',
  empty: 'SEM SALDO',
}

/**
 * Tom do trailing.
 *
 * Cor comunica ESTADO, nunca direção: `A RECEBER` era verde e `VOCÊ DEVE`
 * vermelho, e o verde colidia com o verde de resolvido — um recebível em
 * aberto saía igual a um já recebido.
 *
 * `A ACERTAR` é muted como as outras pendências: é o estado normal de uma
 * lista de acertos, e o âmbar fica reservado ao prazo.
 */
export const PERSON_ROW_TONE: Record<PersonRowStatus, string> = {
  receivable: 'text-muted-foreground',
  debt: 'text-muted-foreground',
  toSettle: 'text-muted-foreground',
  /* Conclusão — o único fato que a cor precisa anunciar aqui. */
  finalBalance: ROW_RESOLVED_TONE,
  empty: 'text-muted-foreground',
}

/** A competência terminou de ser liquidada? */
export function isResolvedStatus(status: PersonRowStatus): boolean {
  return status === 'finalBalance'
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O valor da row, pelo modo
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   ACTIVE    outstanding — "quanto ainda falta"
 *   SETTLED   histórico   — "qual foi o saldo do mês"
 *   EMPTY     zero
 *
 * A troca é deliberada e sinalizada: em ACTIVE o trailing diz A RECEBER /
 * VOCÊ DEVE / A ACERTAR; em SETTLED diz `SALDO FINAL`, que é o aviso de que a
 * base do número mudou.
 *
 * Sem esse aviso, quitar o último item faria o valor SUBIR (de R$ 200 que
 * faltavam para R$ 500 que houve no mês) e pareceria bug.
 */
export function personRowAmount(b: PeriodBalance): number {
  return hasOpenObligation(b) ? outstandingNetAmount(b) : periodNetAmount(b)
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Mês resolvido diz QUANDO terminou
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A versão original devolvia "Recebido"/"Pago" aqui, para ocupar o lugar do
 * prazo. O trailing já dizia `RECEBIDO`, então a row exibia o mesmo estado
 * duas vezes:
 *
 *   Eva
 *   Recebido        R$ 720,45
 *                    RECEBIDO
 *
 * A correção foi OMITIR — o que resolveu a duplicação e deixou a row resolvida
 * sem nada à esquerda, com o nome parecendo flutuar ao lado de duas linhas.
 *
 * `Quitado em 18/08` resolve os dois problemas: não repete o trailing, e
 * responde uma pergunta que ele não responde.
 *
 *   esquerda   QUANDO o acerto terminou
 *   trailing   COMO terminou (`PAGO` / `RECEBIDO`)
 *
 * ── Por que "Quitado", e não "Pago em"/"Recebido em" ──
 *
 * Um verbo único serve aos dois sentidos e evita a repetição: "Pago em 18/08"
 * ao lado de `PAGO` seria a duplicação de volta, só com uma data no meio.
 *
 * ── Sem data confiável, `Acerto concluído` ──
 *
 * Vários itens podem ter sido resolvidos em dias diferentes, e o backend só
 * afirma `settledAt` quando ele é defensável. Sem ele, a linha diz o que sabe
 * — não uma data escolhida para preencher espaço.
 */
export function rowSubtext(
  status: PersonRowStatus,
  prazo: string | null,
  /** `YYYY-MM-DD` civil, ou `null` quando não há data defensável. */
  settledAt?: string | null,
): string | null {
  if (!isResolvedStatus(status)) return prazo

  return settledAt
    ? `Quitado em ${formatDate(settledAt)}`
    : 'Acerto concluído'
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
export function subtextTone(
  item: NextSettlementItem | null,
  /* Injetável para teste; em produção é sempre o relógio real. */
  today: Date = new Date(),
): string {
  if (!item) return ''

  /*
    Dia civil por string, nunca `new Date('YYYY-MM-DD')` — este último é
    interpretado como UTC e, em fuso negativo, devolve o dia anterior.
  */
  const [year, month, day] = item.dueDate.slice(0, 10).split('-').map(Number)

  switch (timingUrgency(new Date(year, month - 1, day), today)) {
    case 'overdue':
      return 'text-destructive'
    case 'today':
    case 'soon':
      return 'text-pending'
    case 'later':
      return ''
  }
}

/**
 * O tom do subtexto da row, pelo seu ESTADO.
 *
 * `subtextTone` responde sobre um PRAZO, e uma row resolvida não tem prazo: o
 * `nextItem` dela pode estar preenchido (item de outra competência), e aplicar
 * a régua temporal ali pintaria de vermelho uma linha que diz `PAGO`.
 *
 * Resolvido usa `ROW_RESOLVED_TONE` — o mesmo verde do trailing, e o mesmo que
 * Bancos aplica ao "Venceu em" de uma fatura paga. Os dois falam do mesmo
 * fato, e sair em cores diferentes fazia a row parecer meio-concluída.
 */
export function rowSubtextTone(
  status: PersonRowStatus,
  item: NextSettlementItem | null,
  today?: Date,
): string {
  if (isResolvedStatus(status)) return ROW_RESOLVED_TONE

  return subtextTone(item, today)
}
