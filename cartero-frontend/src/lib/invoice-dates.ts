export const DEFAULT_INVOICE_DAYS_AFTER_CLOSE = 7

/**
 * Cálculo PROSPECTIVO de datas de fatura.
 *
 * Serve para uma única pergunta: quando fecharia/venceria uma fatura de uma
 * competência que AINDA NÃO EXISTE — usado onde a interface projeta um cenário
 * a partir da configuração do cartão.
 *
 * Para uma fatura real, use `invoice.closeDate` / `invoice.dueDate`. Elas são
 * congeladas na criação e são a fonte de verdade; recalcular pela configuração
 * atual era o que fazia as datas de uma fatura paga mudarem quando o cartão
 * era reconfigurado.
 *
 * `parseInvoiceDate` converte as strings ISO que a API devolve.
 */

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function dateForDay(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, Math.min(day, daysInMonth(year, month)))
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function intervalDays(daysAfterClose?: number): number {
  return Math.max(1, daysAfterClose ?? DEFAULT_INVOICE_DAYS_AFTER_CLOSE)
}

/**
 * Data ISO de fatura vinda da API, como dia local.
 *
 * O backend ancora essas datas em 3h UTC. `new Date(iso)` num fuso negativo
 * cairia no dia anterior, então o dia é extraído do texto — a mesma precaução
 * que `parseDateOnly` toma com os outros campos de data.
 */
export function parseInvoiceDate(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Vencimento prospectivo de uma competência.
 *
 * O parâmetro `daysAfterClose` foi removido: ele era declarado e nunca usado,
 * porque o vencimento depende só do dia configurado. Manter um argumento morto
 * sugeria que ele influenciava o resultado.
 */
export function getInvoiceDueDate(
  year: number,
  month: number,
  dueDay: number,
): Date {
  // A competência sempre segue o mês do vencimento; o fechamento é que pode
  // cair no mês anterior.
  return dateForDay(year, month, dueDay)
}

/** Fechamento prospectivo: o vencimento menos o intervalo, em dias corridos. */
export function getInvoiceCloseDate(
  year: number,
  month: number,
  dueDay: number,
  daysAfterClose?: number,
): Date {
  return addDays(
    getInvoiceDueDate(year, month, dueDay),
    -intervalDays(daysAfterClose),
  )
}
