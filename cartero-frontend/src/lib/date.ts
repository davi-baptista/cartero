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
