import {
  monthCycleOf,
  type MonthCycle,
} from '@/lib/bank-month-summary-lines'
import { formatDateValue } from '@/lib/date'
import {
  personPriorityRank,
  type NextSettlementItem,
  type SortablePerson,
} from '@/lib/person-next-item'
import { hasPeriodActivity, type PeriodBalance } from '@/lib/person-period-view'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A ordem depende da PERGUNTA, e a pergunta muda com o mês
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A lista tinha uma ordem só: urgência. Faz todo sentido no mês corrente, onde
 * a pergunta é "quem precisa da minha atenção?".
 *
 * Num mês já encerrado essa pergunta não tem resposta útil — nada mais vai
 * vencer ali. Sem evento futuro, `personPriorityRank` empatava quase todo mundo
 * no mesmo grupo e o desempate caía no nome, então um mês inteiramente
 * resolvido saía em ordem alfabética. A pergunta do passado é outra:
 *
 *   presente/futuro   "quem precisa da minha atenção?"     → urgência
 *   passado           "quem movimentou mais dinheiro?"     → magnitude
 *
 * O contraste é intencional. Aplicar magnitude ao mês corrente colocaria uma
 * relação grande já resolvida acima de uma dívida vencendo hoje.
 */

/**
 * O que a ordenação precisa saber de cada pessoa.
 *
 * As duas fontes se sobrepõem em `nextItem` — obrigatório para a urgência,
 * opcional no balanço. Declarado aqui na forma mais estrita das duas, para que
 * a página não possa passar uma linha sem o campo que a urgência exige.
 */
export interface OrderablePerson
  extends Omit<SortablePerson, 'nextItem'>,
    Omit<PeriodBalance, 'nextItem'> {
  name: string
  nextItem: NextSettlementItem | null
}

/**
 * A magnitude histórica: `abs` do líquido do período.
 *
 * ── Por que `abs` e não o valor assinado ──
 *
 *   Ana   +R$ 700     Bruno  -R$ 500     Célia  +R$ 300
 *
 * Assinado daria Ana, Célia, Bruno — os R$ 500 que eu paguei ao Bruno
 * afundariam para o fim justamente por serem negativos, quando foram a segunda
 * relação mais relevante do mês. Magnitude responde "quanto dinheiro passou por
 * aqui", que é a pergunta do histórico.
 *
 * ── Por que o líquido e não o movimento bruto ──
 *
 * Com R$ 1.000 a receber e R$ 900 a pagar, o bruto é R$ 1.900 e o líquido
 * R$ 100. A row EXIBE R$ 100, e a ordem tem de explicar o que está na tela:
 * ordenar por 1.900 colocaria essa pessoa no topo com o menor número visível da
 * lista, e a ordenação pareceria aleatória.
 */
export function historicalMagnitude(b: PeriodBalance): number {
  return Math.abs(b.periodReceivableTotal - b.periodDebtTotal)
}

/**
 * Ordena para um mês PASSADO: relevância financeira.
 *
 * ── Três níveis, nesta ordem ──
 *
 *   1. teve atividade?          quem não teve vai para o fim
 *   2. magnitude do líquido     maior primeiro
 *   3. nome                     desempate estável
 *
 * O nível 1 existe por um caso específico: R$ 200 recebidos e R$ 200 pagos, tudo
 * quitado, dão magnitude ZERO — e sem ele essa pessoa cairia junto de quem nunca
 * teve nada com você. São fatos diferentes, e a fase anterior gastou um contrato
 * inteiro para distingui-los; a ordenação não pode voltar a confundi-los.
 *
 * ── A ordem NÃO olha status de quitação ──
 *
 * R$ 700 recebidos ficam acima de R$ 300 recebidos, e também acima de R$ 300 em
 * aberto. No passado o que ordena é o tamanho da relação, não se ela foi
 * resolvida — o status está escrito no trailing de cada row.
 */
export function comparePastRows(a: OrderablePerson, b: OrderablePerson): number {
  const ativoA = hasPeriodActivity(a)
  const ativoB = hasPeriodActivity(b)
  if (ativoA !== ativoB) return ativoA ? -1 : 1

  const magA = historicalMagnitude(a)
  const magB = historicalMagnitude(b)
  /* Centavo de tolerância: resíduo de float não deve decidir posição. */
  if (Math.abs(magA - magB) > 0.005) return magB - magA

  return a.name.localeCompare(b.name)
}

/**
 * Ordena para o mês CORRENTE ou FUTURO: urgência operacional.
 *
 * Delega a `personPriorityRank`, a policy já existente (atrasado → hoje →
 * futuro → tem saldo sem data → sem saldo). Reimplementá-la aqui criaria duas
 * definições de urgência que divergiriam na primeira mudança.
 */
export function compareUrgencyRows(
  a: OrderablePerson,
  b: OrderablePerson,
  today?: string,
): number {
  const rankA = personPriorityRank(a, today)
  const rankB = personPriorityRank(b, today)
  if (rankA !== rankB) return rankA - rankB

  /* Dentro do grupo, a data mais próxima lidera. */
  const diaA = a.nextItem?.dueDate.slice(0, 10)
  const diaB = b.nextItem?.dueDate.slice(0, 10)
  if (diaA && diaB && diaA !== diaB) return diaA < diaB ? -1 : 1

  return a.name.localeCompare(b.name)
}

/**
 * A policy de ordenação, escolhida pelo ciclo do mês exibido.
 *
 * Uma função em vez de `if` na página: qual pergunta a lista responde é uma
 * decisão de produto, e ela precisa estar num lugar onde possa ser lida e
 * testada sem montar a tela.
 *
 * Recebe o CICLO, não o mês. A página observa a competência global
 * (`useMonthPeriod`) e não resolve "hoje" por conta própria — resolver o mês
 * corrente em dois lugares foi exatamente o que uma fase anterior desfez.
 * `personRowsCycle` faz a ponte, com o mesmo `monthCycleOf` de Bancos.
 */
export function sortPersonRowsForMonth<T extends OrderablePerson>(
  people: readonly T[],
  cycle: MonthCycle,
  today?: string,
): T[] {
  /*
    Cópia deliberada: a lista vem do cache do React Query, e ordenar no lugar
    faria dois consumidores verem ordens diferentes.
  */
  return [...people].sort(
    cycle === 'past'
      ? comparePastRows
      : (a, b) => compareUrgencyRows(a, b, today),
  )
}

/**
 * O ciclo do mês exibido, resolvido aqui e não na página.
 *
 * `monthCycleOf` é o helper canônico (o mesmo de Bancos); o "hoje" vem de
 * `formatDateValue`, a régua de dia civil de Fortaleza que o resto de Pessoas
 * já usa. Concentrar isso no helper mantém a página livre de uma segunda
 * noção de mês corrente.
 */
export function personRowsCycle(
  period: { month: number; year: number },
  today: string = formatDateValue(),
): MonthCycle {
  const [year, month] = today.slice(0, 10).split('-').map(Number)
  return monthCycleOf(period, { month, year })
}
