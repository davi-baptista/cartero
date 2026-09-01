import { formatDate } from './formatters'
import { parseInvoiceDate } from './invoice-dates'

/**
 * Prazo relativo de faturas — fonte única.
 *
 * Havia três implementações independentes: `banks/page.tsx` com `Math.ceil` e
 * sufixo compacto ("Vence em 5d"), `overview/page.tsx` com `Math.round` e
 * forma longa ("Vence em 5 dias"), e uma terceira variante para dívidas. As
 * divergências não eram só de estilo — `Math.round` sobre uma diferença que já
 * é múltipla de 24h dá o mesmo resultado, mas as duas tratavam "Fecha hoje"
 * com urgências diferentes, então a mesma fatura mudava de cor conforme a tela.
 *
 * Isto NÃO substitui o status: "Fechada" continua sendo o estado, e o prazo é
 * informação adicional que a tela mostra ao lado. Nenhuma função aqui devolve
 * algo que possa ser confundido com um estado.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Meia-noite local — compara dia civil, não instantes. */
function toCivilDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Dias civis de hoje até `date`. Positivo = futuro, 0 = hoje, negativo = passado.
 *
 * Ambos os lados são normalizados para meia-noite antes da subtração, então o
 * resultado é exato e não depende da hora em que a página foi aberta — era o
 * risco de dividir timestamps crus por 24h.
 */
export function civilDaysUntil(date: Date, today: Date = new Date()): number {
  return Math.round(
    (toCivilDay(date).getTime() - toCivilDay(today).getTime()) / MS_PER_DAY,
  )
}

/** Forma do texto: `long` = "5 dias", `short` = "5d". */
export type TimingFormat = 'long' | 'short'

function days(count: number, format: TimingFormat): string {
  return format === 'short' ? `${count}d` : `${count} ${count === 1 ? 'dia' : 'dias'}`
}

/**
 * Quando a fatura fecha, em relação a hoje.
 *
 * "Fechou há X" existe porque o cron pode não ter rodado: a data passou mas o
 * status ainda é OPEN, e omitir isso deixaria a linha sem explicação.
 */
export function formatCloseTiming(
  closeDate: Date,
  today: Date = new Date(),
  format: TimingFormat = 'long',
): string {
  const diff = civilDaysUntil(closeDate, today)
  if (diff === 0) return 'Fecha hoje'
  if (diff === 1) return 'Fecha amanhã'
  if (diff > 0) return `Fecha em ${days(diff, format)}`
  return `Fechou há ${days(-diff, format)}`
}

/** Quando a fatura vence, em relação a hoje. */
export function formatDueTiming(
  dueDate: Date,
  today: Date = new Date(),
  format: TimingFormat = 'long',
): string {
  const diff = civilDaysUntil(dueDate, today)
  if (diff === 0) return 'Vence hoje'
  if (diff === 1) return 'Vence amanhã'
  if (diff > 0) return `Vence em ${days(diff, format)}`
  return `Venceu há ${days(-diff, format)}`
}

/**
 * Mesma coisa a partir de uma data ISO — dívidas e recebíveis guardam string.
 *
 * `.slice(0, 10)` antes do split porque o campo pode vir como timestamp ISO
 * completo, e `new Date('2026-06-26T00:00:00.000Z')` cairia no dia anterior em
 * fusos negativos.
 */
export function formatDueTimingFromISO(
  iso: string,
  today: Date = new Date(),
  format: TimingFormat = 'long',
): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return formatDueTiming(new Date(year, month - 1, day), today, format)
}

/** Grau de urgência, para escolher a cor sem repetir os limites em cada tela. */
export type TimingUrgency = 'overdue' | 'today' | 'soon' | 'later'

export function timingUrgency(
  target: Date,
  today: Date = new Date(),
): TimingUrgency {
  const diff = civilDaysUntil(target, today)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff <= 2) return 'soon'
  return 'later'
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Prazo de uma fatura na visão mensal
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Numa lista com seletor de mês, contagem regressiva só faz sentido para o que
 * ainda vai acontecer. "Vence em 5d" numa fatura de março seria absurdo — e
 * "Venceu há 180d" é ruído: o que importa de um ciclo encerrado é a DATA, não
 * a distância até hoje.
 *
 * Por isso a régua é o estado, não o calendário da tela:
 *
 *   OPEN    → conta até o fechamento ("Fecha em 5d")
 *   CLOSED  → conta até o vencimento ("Vence em 3d")
 *   OVERDUE → conta desde o vencimento; é a pendência que exige ação
 *   PAID    → data factual ("Paga · venceu em 10/08"), sem contagem
 *
 * `PAID` é o caso que decide o formato: um ciclo quitado não tem prazo a
 * cumprir, e exibir contagem sobre ele sugeriria pendência onde não há.
 */
export function invoiceTimingLabel(
  invoice: { status: string; closeDate: string; dueDate: string },
  today: Date = new Date(),
): string {
  if (invoice.status === 'PAID') {
    return `Venceu em ${formatDate(invoice.dueDate)}`
  }

  if (invoice.status === 'OPEN') {
    return formatCloseTiming(parseInvoiceDate(invoice.closeDate), today, 'short')
  }

  return formatDueTiming(parseInvoiceDate(invoice.dueDate), today, 'short')
}
