export type RecurringCreateKind = 'income' | 'expense'
export type RecurringExpenseMode = 'automatic' | 'manual'
export type RecurringCreateTarget = 'income' | RecurringExpenseMode

export type RecurringCreateChoice = {
  kind: RecurringCreateKind | null
  expenseMode: RecurringExpenseMode | null
}

export const EMPTY_RECURRING_CREATE_CHOICE: RecurringCreateChoice = {
  kind: null,
  expenseMode: null,
}

export function selectRecurringKind(choice: RecurringCreateChoice, kind: RecurringCreateKind): RecurringCreateChoice {
  return kind === choice.kind ? choice : { kind, expenseMode: null }
}

export function selectRecurringExpenseMode(choice: RecurringCreateChoice, expenseMode: RecurringExpenseMode): RecurringCreateChoice {
  return choice.kind === 'expense' ? { kind: 'expense', expenseMode } : choice
}

export function recurringCreateTarget(choice: RecurringCreateChoice): RecurringCreateTarget | null {
  return choice.kind === 'income' ? 'income' : choice.kind === 'expense' ? choice.expenseMode : null
}
