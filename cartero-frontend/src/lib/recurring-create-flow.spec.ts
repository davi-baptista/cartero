import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_RECURRING_CREATE_CHOICE,
  recurringCreateTarget,
  selectRecurringExpenseMode,
  selectRecurringKind,
} from './recurring-create-choice'

const flow = readFileSync(new URL('../app/(dashboard)/recurring/recurring-client.tsx', import.meta.url), 'utf8')
const movementFlow = readFileSync(new URL('../app/(dashboard)/movements/movements-add-flow.tsx', import.meta.url), 'utf8')
const movementShell = readFileSync(new URL('../app/(dashboard)/movements/movements-shell.tsx', import.meta.url), 'utf8')
const income = readFileSync(new URL('../app/(dashboard)/recurring/income-panel.tsx', import.meta.url), 'utf8')
const automatic = readFileSync(new URL('../app/(dashboard)/recurring/subscription-panel.tsx', import.meta.url), 'utf8')
const manual = readFileSync(new URL('../app/(dashboard)/recurring/manual-expense-panel.tsx', import.meta.url), 'utf8')
const incomeForm = readFileSync(new URL('../app/(dashboard)/income/recurring-income-sheet.tsx', import.meta.url), 'utf8')
const automaticForm = readFileSync(new URL('../app/(dashboard)/subscriptions/subscription-sheet.tsx', import.meta.url), 'utf8')
const manualForm = readFileSync(new URL('../app/(dashboard)/recurring/recurring-expense-sheet.tsx', import.meta.url), 'utf8')

describe('Recurring create drawer', () => {
  it('opens the one shared Sheet directly from the only Add button, without chooser dialogs', () => {
    expect(flow.match(/aria-label="Adicionar recorrência"/g)).toHaveLength(1)
    expect(flow).toContain('onClick={() => handleOpenChange(true)}')
    expect(flow).toContain('<Sheet open={open} onOpenChange={handleOpenChange} onOpenChangeComplete={handleOpenChangeComplete}>')
    expect(flow).not.toContain('<Dialog')
    expect(flow).toContain('<SheetTitle className="text-lg leading-snug">Adicionar recorrência</SheetTitle>')
    expect(flow).toContain('<SheetDescription>Selecione o que você quer cadastrar.</SheetDescription>')
  })

  it('uses the same segmented control treatment as Movements for both questions', () => {
    for (const token of ['rounded-lg border px-3 py-2 text-sm font-medium transition-colors', 'border-primary bg-primary/10 text-foreground', 'border-border text-muted-foreground hover:bg-muted/50', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring']) {
      expect(flow).toContain(token)
      expect(movementFlow).toContain(token)
    }
    expect(flow).toContain('O que você quer cadastrar?')
    expect(flow).toContain('Como essa despesa funciona?')
    expect(flow).toContain('aria-pressed={kind === \'income\'}')
    expect(flow).toContain('aria-pressed={kind === \'expense\'}')
    expect(flow).toContain('aria-pressed={expenseMode === \'automatic\'}')
    expect(flow).toContain('aria-pressed={expenseMode === \'manual\'}')
    expect(flow).not.toContain('Receita recorrente</span>')
  })

  it('keeps every form inside the same drawer and places its own CTA in the fixed footer', () => {
    expect(flow).toContain('ref={setFormHost}')
    expect(flow).toContain('ref={setFooterHost}')
    expect(flow).toContain("createTarget={open && activeTarget === 'income'}")
    expect(flow).toContain("createTarget={open && activeTarget === 'automatic'}")
    expect(flow).toContain("createTarget={open && activeTarget === 'manual'}")
    for (const panel of [income, automatic, manual]) {
      expect(panel).toContain('createPortal(')
      expect(panel).toContain('embedded embeddedFooterHost={footerHost}')
    }
    expect(automatic).toContain('onSubmit={handleEditSubmit}')
    expect(automatic).toContain('onSubmit={handleCreateSubmit} embedded')
    for (const form of [incomeForm, automaticForm, manualForm]) {
      expect(form).toContain('if (embedded) return')
      expect(form).toContain('createPortal(footer, embeddedFooterHost)')
    }
    expect(incomeForm).toContain('Criar renda')
    expect(automaticForm).toContain('Criar cobrança')
    expect(manualForm).toContain('Criar despesa')
  })

  it('resets an abandoned modality and never selects a target before the final choice', () => {
    expect(recurringCreateTarget(EMPTY_RECURRING_CREATE_CHOICE)).toBeNull()
    const incomeChoice = selectRecurringKind(EMPTY_RECURRING_CREATE_CHOICE, 'income')
    expect(recurringCreateTarget(incomeChoice)).toBe('income')
    const expenseChoice = selectRecurringKind(incomeChoice, 'expense')
    expect(recurringCreateTarget(expenseChoice)).toBeNull()
    expect(recurringCreateTarget(selectRecurringExpenseMode(expenseChoice, 'automatic'))).toBe('automatic')
    expect(recurringCreateTarget(selectRecurringExpenseMode(expenseChoice, 'manual'))).toBe('manual')
    const backToIncome = selectRecurringKind(selectRecurringExpenseMode(expenseChoice, 'manual'), 'income')
    expect(backToIncome.expenseMode).toBeNull()
    expect(recurringCreateTarget(selectRecurringKind(backToIncome, 'expense'))).toBeNull()
    expect(flow).toContain("kind === 'expense' ? <section")
    expect(flow).toContain('activeTarget ? <div')
  })

  it('makes both creation types available from either tab and preserves the approved headings', () => {
    expect(flow).toContain('<TabsContent value="income" keepMounted')
    expect(flow).toContain('<TabsContent value="expenses" keepMounted')
    expect(flow.indexOf('onClick={() => handleOpenChange(true)}')).toBeLessThan(flow.indexOf('<Tabs value={tab}'))
    expect(flow).toContain('title="Receitas recorrentes"')
    expect(flow).toContain('Salários e outras entradas que se repetem.')
    expect(flow).toContain('title="Despesas recorrentes"')
    expect(flow).toContain('Aluguel, assinaturas e outras contas que se repetem.')
    expect(flow).toContain('infoLabel="Sobre receitas recorrentes"')
    expect(flow).toContain('infoLabel="Sobre despesas recorrentes"')
    expect(flow).toContain('infoContent="Cadastre entradas que se repetem, como salário e aluguel recebido. Elas ficam previstas até você registrar o recebimento."')
    expect(flow).toContain('infoContent="Cadastre contas que se repetem, como aluguel, internet e assinaturas. Algumas são lançadas automaticamente; outras ficam em aberto até você registrar o pagamento."')
    expect(flow.match(/<ContextHeading/g)).toHaveLength(2)
  })

  it('uses the Movements tab treatment with URL state and the shared financial row shell', () => {
    expect(movementShell).toContain('movementViewLinkClass(active)')
    expect(flow).toContain('movementViewLinkClass(tab === \'income\')')
    expect(flow).toContain('movementViewLinkClass(tab === \'expenses\')')
    expect(movementShell).toContain('max-w-md rounded-xl border bg-muted/40 p-1')
    expect(flow).toContain('max-w-md rounded-xl border bg-muted/40 p-1')
    expect(flow).toContain('onValueChange={(value) => setTab(')
    expect(flow).toContain("searchParams.get('tab') === 'expenses'")
    expect(flow).toContain("params.set('tab', nextTab)")
    expect(flow).toContain('router.push(`${pathname}?${params.toString()}`, { scroll: false })')
    for (const panel of [income, automatic, manual]) {
      expect(panel).toContain('FinancialListRow')
      expect(panel).toContain('MotionRow')
    }
    expect(income).toContain('A RECEBER')
    expect(income).toContain('PAUSADA')
    expect(income).toContain("presentation?.tone === 'overdue'")
    expect(automatic).toContain('nextCharge')
    expect(automatic).toContain('TRANSACTION_TYPE_LABELS')
    expect(manual).toContain('A PAGAR')
    expect(manual).toContain('Em atraso')
  })

  it('shows only the selected drawer explanations', () => {
    expect(flow).toContain('{kind ? <p className="text-xs text-muted-foreground">')
    expect(flow).toContain('{expenseMode ? <p className="text-xs text-muted-foreground">')
    expect(flow).toContain("kind === 'expense' ? <section")
    expect(flow).toContain('<Sheet open={open} onOpenChange={handleOpenChange}')
  })
})
