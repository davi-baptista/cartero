export function parseDateOnly(dateString: string): Date {
  const [year, month, day] = dateString.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatDateValue(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function todayDateValue(): string {
  return formatDateValue()
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ3 — dia civil "de hoje" pela timezone financeira da conta
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `timeZone` vem de `User.timeZone` (TZ1). `null` é conta legada — preserva
 * EXATAMENTE `formatDateValue`, isto é, o dia civil do NAVEGADOR, como
 * sempre foi. Só contas com timezone configurada passam a usar essa
 * timezone (IANA, via `Intl`) em vez do relógio do navegador.
 *
 * Nunca um offset fixo, nunca `America/Fortaleza` como default — a
 * distinção entre "conta com timezone" e "legado" precisa ficar explícita
 * em quem chama, nunca escondida atrás de `timeZone ?? 'America/Fortaleza'`.
 */
export function accountToday(timeZone: string | null, now: Date = new Date()): string {
  if (timeZone === null) return formatDateValue(now)

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return `${lookup.year}-${lookup.month}-${lookup.day}`
}

/** Mesma authority de `accountToday`, devolvendo um `Date` local em vez de string. */
export function accountTodayDate(timeZone: string | null, now: Date = new Date()): Date {
  return parseDateOnly(accountToday(timeZone, now))
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O dia civil de um INSTANTE, em Fortaleza (UTC-3)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Espelha `civilDay` do backend, e existe pela mesma razão: um `slice(0, 10)`
 * num ISO devolve o dia em UTC, não o dia que a pessoa viveu.
 *
 * Um pagamento em 04/09 às 00h30 UTC aconteceu em 03/09 às 21h30 aqui. O
 * backend dizia 03/09 na lista de Pessoas e o drawer dizia 04/09 para o MESMO
 * registro — a mesma data com dois dias diferentes na mesma tela.
 *
 * Use para converter um TIMESTAMP (`paidAt`, `createdAt`). Campos que já são
 * dia civil (`dueDate` como `YYYY-MM-DD`) não passam por aqui: reconvertê-los
 * introduziria o deslocamento que este helper existe para remover.
 */
export function civilDayOf(instant: string | Date): string {
  /*
    Um valor que JA e dia civil passa intacto.

    `paidAt` chega das duas formas: instante ISO completo quando o backend
    gravou `new Date()`, e `YYYY-MM-DD` quando a data foi informada. Converter
    o segundo devolveria o dia ANTERIOR — `new Date('2026-05-01')` e meia-noite
    UTC, e subtrair 3h cai em 30/04.

    A guarda vem antes de qualquer parsing porque o erro que ela evita e
    silencioso: um dia a menos continua sendo uma data plausivel.
  */
  if (typeof instant === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(instant)) {
    return instant
  }

  const date = typeof instant === 'string' ? new Date(instant) : instant
  return new Date(date.getTime() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

/**
 * `civilDayOf`, mas ciente da timezone financeira da conta (TZ2/TZ3).
 *
 * `timeZone === null` preserva `civilDayOf` INTACTO — a mesma -3h fixa de
 * Fortaleza que toda conta legada sempre teve. Só contas com
 * `User.timeZone` configurado resolvem o dia civil do instante pela sua
 * própria timezone (IANA, via `Intl`), nunca por um offset fixo.
 */
export function accountCivilDayOf(
  instant: string | Date,
  timeZone: string | null,
): string {
  if (typeof instant === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(instant)) {
    return instant
  }

  if (timeZone === null) return civilDayOf(instant)

  const date = typeof instant === 'string' ? new Date(instant) : instant
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return `${lookup.year}-${lookup.month}-${lookup.day}`
}
