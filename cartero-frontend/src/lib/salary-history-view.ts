import type { SalaryHistoryEntry } from '@/services/salary.service'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Apresentação do histórico salarial
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Cada entrada é uma ALTERAÇÃO que passa a valer numa competência e segue
 * valendo até a próxima. O usuário não recadastra o mesmo valor todo mês.
 *
 * Por isso a tela precisa dizer o INTERVALO afetado antes de salvar: corrigir
 * janeiro muda também fevereiro e março, e quem só vê "Janeiro · R$ 4.500"
 * não tem como saber disso.
 */

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/** `janeiro` — sem o ano, para a microcopy corrida. */
export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? ''
}

/** Ordena competências cronologicamente. */
function compareCompetence(
  a: { year: number; month: number },
  b: { year: number; month: number },
): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month
}

/**
 * A próxima alteração registrada depois desta.
 *
 * `null` quando a entrada é a mais recente — o valor vale dali em diante.
 * Procura entre os registros REAIS: nenhum mês é inventado.
 */
export function nextEntryAfter(
  entry: SalaryHistoryEntry,
  history: readonly SalaryHistoryEntry[],
): SalaryHistoryEntry | null {
  const posteriores = history
    .filter((candidate) => compareCompetence(candidate, entry) > 0)
    .sort(compareCompetence)

  return posteriores[0] ?? null
}

/**
 * Explica o intervalo que a edição afeta.
 *
 * Duas formas, decididas pela existência de uma próxima alteração real:
 *
 *   · com próxima  → "de janeiro até a próxima alteração registrada em abril"
 *   · sem próxima  → "de agosto em diante, até uma nova alteração salarial"
 *
 * A segunda é aberta de propósito: não há data final conhecida, e inventar uma
 * ("até dezembro") afirmaria um fato que ninguém registrou.
 */
export function propagationNotice(
  entry: SalaryHistoryEntry,
  history: readonly SalaryHistoryEntry[],
): string {
  const next = nextEntryAfter(entry, history)
  const from = monthName(entry.month)

  if (!next) {
    return `Este valor será utilizado de ${from} em diante, até uma nova alteração salarial.`
  }

  /*
    O ano só aparece quando difere do da entrada editada. "de dezembro até a
    próxima alteração registrada em janeiro" seria ambíguo entre anos.
  */
  const nextLabel =
    next.year === entry.year
      ? monthName(next.month)
      : `${monthName(next.month)} de ${next.year}`

  return `Este valor será utilizado de ${from} até a próxima alteração registrada em ${nextLabel}.`
}

/**
 * O histórico em ordem de exibição: do mais recente para o mais antigo.
 *
 * O backend já ordena assim; reordenar aqui mantém a tela correta mesmo que a
 * resposta chegue em outra ordem, sem custo relevante para uma lista curta.
 */
export function sortedHistory(
  history: readonly SalaryHistoryEntry[],
): SalaryHistoryEntry[] {
  return [...history].sort((a, b) => compareCompetence(b, a))
}
