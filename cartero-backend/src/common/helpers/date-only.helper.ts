/**
 * Date fields in the app represent a calendar day, not an instant in time.
 * Keep them at UTC noon so Fortaleza (UTC-3) never renders the previous day.
 */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function parseDateFilterStart(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

export function parseDateFilterEnd(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
}

/**
 * O dia civil de Fortaleza (UTC-3) como `YYYY-MM-DD`.
 *
 * O servidor roda em UTC: comparar instantes marcaria como vencido, durante a
 * noite, algo que ainda está no prazo para o usuário. No PRÓPRIO dia do
 * vencimento o item não está atrasado — há o dia inteiro para resolvê-lo.
 *
 * Vivia privado em `BudgetService`. Subiu para cá quando o classificador de
 * baldes passou a precisar da MESMA fronteira: duas definições de "hoje" para
 * a mesma pergunta é como o carry futuro nasceu.
 */
export function civilDay(date: Date): string {
  return new Date(date.getTime() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
