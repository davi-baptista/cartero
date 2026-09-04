import { formatDateValue } from '@/lib/date'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O próximo acerto de uma pessoa, em texto
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A linha de Pessoas dizia quanto ("R$ 462,22 · A RECEBER") e não dizia
 * quando. Uma cobrança vencida há três dias e outra que só vence no fim do mês
 * ficavam idênticas na lista.
 *
 * O backend devolve o item mais urgente como DADO — sentido e data. Aqui ele
 * vira a frase curta que a row exibe.
 *
 * ── O verbo carrega a direção ──
 *
 * "Vence em 4d" obrigaria o leitor a lembrar quem deve a quem. "Receber" e
 * "Pagar" resolvem isso na primeira palavra, que é onde o olho chega antes.
 *
 * ── Dia civil, comparado por string ──
 *
 * `formatDateValue` já devolve `YYYY-MM-DD` no fuso de Fortaleza, e o backend
 * envia a data no mesmo formato. Comparar as duas strings evita construir
 * `Date` a partir de uma data sem hora — a armadilha que desloca o dia em
 * fuso negativo e faria "vence hoje" virar "atrasado 1d" à meia-noite.
 */

export type SettlementDirection = 'receive' | 'pay'

/**
 * O sentido que a FRASE revela — nem sempre o do item.
 *
 * Uma pessoa com R$ 300 em aberto de cada lado tem líquido zero e pendências
 * vivas: a row diz `A ACERTAR`, porque nenhum dos dois sentidos manda. Mas a
 * data continua vindo de um item concreto, que tem lado — e a frase saía
 * `Receber em 7d` ao lado de um status que acabara de afirmar não haver
 * direção.
 *
 * `settle` existe para esse caso: a data permanece real, o verbo é que deixa
 * de escolher um lado que o saldo não escolheu.
 */
export type LabelDirection = SettlementDirection | 'settle'

export interface NextSettlementItem {
  direction: SettlementDirection
  /** `YYYY-MM-DD`, dia civil. */
  dueDate: string
}

const VERBO: Record<LabelDirection, string> = {
  receive: 'Receber',
  pay: 'Pagar',
  /*
    "Acertar" serve aos dois sentidos sem afirmar nenhum — a mesma escolha que
    `A ACERTAR` faz no trailing. Um verbo direcional aqui contradiria o status
    a poucos pixels de distância.
  */
  settle: 'Acertar',
}

/**
 * Dias civis entre duas datas. Positivo = futuro.
 *
 * O `.slice(0, 10)` é defensivo: hoje o backend envia `YYYY-MM-DD`, mas um
 * timestamp ISO chegando aqui produziria `NaN` no `Number('02T00:00:00')` e a
 * row exibiria "Receber em NaNd". Cortar o dia primeiro custa nada e mantém a
 * função correta nos dois formatos.
 */
function diasEntre(de: string, ate: string): number {
  const MS_POR_DIA = 24 * 60 * 60 * 1000
  const [ay, am, ad] = de.slice(0, 10).split('-').map(Number)
  const [by, bm, bd] = ate.slice(0, 10).split('-').map(Number)
  /*
    `Date.UTC` sobre componentes já normalizados: as duas pontas são
    construídas do mesmo jeito, então a diferença é exata e não depende do
    fuso de quem está lendo.
  */
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_POR_DIA,
  )
}

/**
 * A frase da row, ou `null` quando não há nada a destacar.
 *
 * `null` é um resultado legítimo e frequente: pessoa sem pendência, ou com
 * saldo líquido zero. A row fica sem subtexto em vez de exibir "Sem
 * pendências" — texto que ocupa a linha para não dizer nada.
 */
export function nextItemLabel(
  item: NextSettlementItem | null | undefined,
  today: string = formatDateValue(),
  /*
    Quem chama sabe se a row é bilateral: o status vem do LÍQUIDO, e o item
    não tem como saber que o outro lado o anula. Sobrescrever aqui mantém a
    escolha da data intacta — só a palavra muda.
  */
  direction: LabelDirection = item?.direction ?? 'receive',
): string | null {
  if (!item) return null

  const verbo = VERBO[direction]
  const dias = diasEntre(today, item.dueDate)

  if (dias < 0) {
    /*
      Atraso em valor absoluto: "atrasado 3d" lê melhor que "em -3d", e é o
      número que o usuário usa para decidir a urgência.
    */
    return `${verbo} atrasado ${Math.abs(dias)}d`
  }
  if (dias === 0) return `${verbo} hoje`
  if (dias === 1) return `${verbo} amanhã`
  return `${verbo} em ${dias}d`
}

/**
 * O item está em atraso?
 *
 * Separado do texto porque quem desenha decide a cor. Só o atraso ganha tom de
 * atenção — pintar todos os estados transformaria a lista numa árvore de
 * Natal, e no mobile a legibilidade importa mais que a decoração.
 */
export function isNextItemOverdue(
  item: NextSettlementItem | null | undefined,
  today: string = formatDateValue(),
): boolean {
  if (!item) return false
  /* Mesmo recorte de dia do `diasEntre`: comparar `2026-09-02T00:00` com
     `2026-09-02` daria "menor" e marcaria como atraso um item de hoje. */
  return item.dueDate.slice(0, 10) < today.slice(0, 10)
}

// ─── Ordem da lista ──────────────────────────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Quem precisa de atenção primeiro
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `GET /persons` faz `findMany` sem `orderBy`, então a lista chegava na ordem
 * que o Postgres devolvesse — sem contrato. Na prática, pessoas com
 * "R$ 0,00 · SEM SALDO" apareciam antes de quem tinha cobrança atrasada.
 *
 * A régua é a mesma de Bancos: urgência primeiro, proximidade depois, estados
 * sem ação no fim.
 *
 *   0. atrasado         venceu e continua aberto
 *   1. vence hoje       o prazo acaba hoje
 *   2. futuro           ordenado pela data mais próxima
 *   3. tem saldo        sem evento datado utilizável
 *   4. sem saldo        nada a acertar
 *
 * ── O item que ordena é o item EXIBIDO ──
 *
 * `nextItem` é o mesmo que produz o subtexto da row. Ordenar por um evento
 * invisível faria a lista parecer embaralhada: uma linha dizendo "Receber em
 * 12d" passaria à frente de outra com "Pagar amanhã" por causa de uma
 * obrigação que ninguém vê.
 *
 * ── Saldo zero não é o mesmo que nada a fazer ──
 *
 * Uma pessoa pode ter R$ 500 de cada lado: saldo líquido zero, duas
 * obrigações abertas. Quem decide o último grupo é a AUSÊNCIA de evento, não
 * o valor do saldo — e o backend só devolve `nextItem: null` quando não há
 * pendência do lado que o saldo aponta.
 *
 * ── Valor não é urgência ──
 *
 * R$ 1.000 vencendo em 30 dias não é mais urgente que R$ 50 vencidos ontem.
 * O montante não participa da ordem.
 */
export type PersonPriorityRank = 0 | 1 | 2 | 3 | 4 | 5

/**
 * O mínimo para posicionar uma pessoa na lista.
 *
 * ── Por que `hasActivity` é necessário ──
 *
 * O rank decidia os dois últimos grupos por `Math.abs(netBalance)`, que é
 * OUTSTANDING — e zera no settlement. Uma pessoa com −R$ 1 quitados e outra
 * que nunca teve nada ficavam com o mesmo `netBalance: 0` e caíam no mesmo
 * grupo, com o nome desempatando:
 *
 *   Breno      R$ 48,48   SALDO FINAL
 *   C6         R$ 0,00    SEM SALDO     ← atravessou
 *   Fabricio  -R$ 1,00    SALDO FINAL
 *
 * Não era o sinal do amount cruzando a fronteira: era a fronteira não existir.
 * O rank foi escrito quando a lista ainda não distinguia resolvido de vazio, e
 * `netBalance` não carrega essa diferença.
 */
export interface SortablePerson {
  name: string
  netBalance: number
  nextItem: NextSettlementItem | null | undefined
  /**
   * Houve movimento financeiro na competência, resolvido ou não?
   *
   * `false` é o único caso de "SEM SALDO", e o que separa o grupo 4 do 5.
   * Opcional para não quebrar quem ordena sem contexto de competência — a
   * ausência é lida como "não sei", e o comportamento anterior é mantido.
   */
  hasActivity?: boolean
}

const SEM_SALDO = 0.005

export function personPriorityRank(
  person: SortablePerson,
  today: string = formatDateValue(),
): PersonPriorityRank {
  const item = person.nextItem

  if (item) {
    const dia = item.dueDate.slice(0, 10)
    if (dia < today) return 0
    if (dia === today) return 1
    return 2
  }

  /* Sem evento datado, mas com saldo em aberto: ainda há algo a acertar. */
  if (Math.abs(person.netBalance) > SEM_SALDO) return 3

  /*
    ── A fronteira que faltava ──

    Sem pendência, restam dois fatos MUITO diferentes:

      4  houve movimento e foi resolvido   ("SALDO FINAL")
      5  não houve movimento               ("SEM SALDO")

    Separá-los é o que impede uma pessoa sem nenhuma relação no mês de
    aparecer entre duas que tiveram — o que acontecia porque os dois estados
    compartilhavam `netBalance: 0`.

    `undefined` cai em 4: sem saber se houve atividade, tratar como resolvido
    preserva a ordem anterior para quem ordena fora de uma competência.
  */
  return person.hasActivity === false ? 5 : 4
}

/**
 * Ordena por importância, sem mutar a entrada.
 *
 * A cópia é deliberada: a lista vem do cache do React Query, e ordenar no
 * lugar faria dois consumidores verem ordens diferentes.
 */
export function sortPeopleByPriority<T extends SortablePerson>(
  people: readonly T[],
  today: string = formatDateValue(),
): T[] {
  return [...people].sort((a, b) => {
    const rankA = personPriorityRank(a, today)
    const rankB = personPriorityRank(b, today)
    if (rankA !== rankB) return rankA - rankB

    /*
      Dentro do mesmo grupo, a data mais próxima lidera. Vale para os três
      grupos com evento: entre atrasados, o mais antigo é o mais urgente;
      entre futuros, o que vence antes.
    */
    const diaA = a.nextItem?.dueDate.slice(0, 10)
    const diaB = b.nextItem?.dueDate.slice(0, 10)
    if (diaA && diaB && diaA !== diaB) return diaA < diaB ? -1 : 1

    /* Tie-break estável: sem ele a ordem viria da resposta da API. */
    return a.name.localeCompare(b.name)
  })
}
