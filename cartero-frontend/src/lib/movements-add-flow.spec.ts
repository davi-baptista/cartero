import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { movementAddDestination, movementPostCreateDestination, parseMovementAddTarget } from './movements-add-flow'

const flow = readFileSync(new URL('../app/(dashboard)/movements/movements-add-flow.tsx', import.meta.url), 'utf8')
const statementPage = readFileSync(new URL('../app/(dashboard)/movements/statement/page.tsx', import.meta.url), 'utf8')
const transactionSheet = readFileSync(new URL('../app/(dashboard)/transactions/transaction-sheet.tsx', import.meta.url), 'utf8')
const obligationsClient = readFileSync(new URL('../app/(dashboard)/movements/obligations/obligations-client.tsx', import.meta.url), 'utf8')
const createObligations = readFileSync(new URL('./use-create-obligations.ts', import.meta.url), 'utf8')
const createTransactions = readFileSync(new URL('./use-create-transaction.ts', import.meta.url), 'utf8')
const drawerLayout = readFileSync(new URL('../components/ui/drawer-layout.ts', import.meta.url), 'utf8')
const sheetPrimitive = readFileSync(new URL('../components/ui/sheet.tsx', import.meta.url), 'utf8')
const dialogPrimitive = readFileSync(new URL('../components/ui/dialog.tsx', import.meta.url), 'utf8')
const debtSheet = readFileSync(new URL('../app/(dashboard)/debts/debt-sheet.tsx', import.meta.url), 'utf8')
const receivableSheet = readFileSync(new URL('../app/(dashboard)/receivables/receivable-sheet.tsx', import.meta.url), 'utf8')
const dashboardLayout = readFileSync(new URL('../app/(dashboard)/layout.tsx', import.meta.url), 'utf8')
const transactionDetailsDrawer = readFileSync(new URL('../components/transaction-details-drawer.tsx', import.meta.url), 'utf8')
const personDrawer = readFileSync(new URL('../components/person-statement-drawer.tsx', import.meta.url), 'utf8')
const incomePage = readFileSync(new URL('../app/(dashboard)/income/page.tsx', import.meta.url), 'utf8')
const invoiceDrawer = readFileSync(new URL('../components/invoice-details-drawer.tsx', import.meta.url), 'utf8')
const detailDrawer = readFileSync(new URL('../components/ui/detail-drawer.tsx', import.meta.url), 'utf8')

describe('Movements unified add flow', () => {
  it('routes each target to its canonical form route', () => {
    expect(movementAddDestination('expense', '/movements/obligations', '')).toBe('/movements/statement?add=expense')
    expect(movementAddDestination('income', '/movements/statement', '')).toBe('/movements/statement?add=income')
    expect(movementAddDestination('receivable', '/movements/statement', '')).toBe('/movements/obligations?add=receivable&domain=receivable')
    expect(movementAddDestination('debt', '/movements/obligations', '')).toBe('/movements/obligations?add=debt&domain=debt')
  })

  it('preserves obligation month and person scope when choosing a target in place', () => {
    expect(movementAddDestination('debt', '/movements/obligations', 'month=9&year=2026&personId=p1&domain=receivable'))
      .toBe('/movements/obligations?month=9&year=2026&personId=p1&domain=debt&add=debt')
  })

  it('preserves the M6 post-create destination and matching obligation domain', () => {
    expect(movementPostCreateDestination('expense', '/movements/obligations', 'month=9&year=2026'))
      .toBe('/movements/statement')
    expect(movementPostCreateDestination('debt', '/movements/obligations', 'month=9&year=2026&personId=p1&add=debt'))
      .toBe('/movements/obligations?month=9&year=2026&personId=p1&domain=debt')
    expect(movementPostCreateDestination('receivable', '/movements/statement', ''))
      .toBe('/movements/obligations?domain=receivable')
  })

  it('parses only supported creation targets', () => {
    expect(['expense', 'income', 'receivable', 'debt'].map(parseMovementAddTarget))
      .toEqual(['expense', 'income', 'receivable', 'debt'])
    expect(parseMovementAddTarget('transfer')).toBeNull()
  })

  it('keeps one drawer root and embeds all canonical forms without nested overlays', () => {
    expect(flow).toContain('<Sheet\n')
    expect(flow).toContain('<TransactionSheet')
    expect(flow).toContain('<DebtSheet')
    expect(flow).toContain('<ReceivableSheet')
    for (const source of [transactionSheet, debtSheet, receivableSheet]) {
      expect(source).toContain('if (embedded) {')
      expect(source).toContain('createPortal(footer, embeddedFooterHost)')
    }
    expect(flow.indexOf('onOpenChangeComplete={handleOpenChangeComplete}')).toBeGreaterThan(-1)
    expect(flow).toContain('router.push(')
    expect(flow).toContain('pendingDestination.current = movementPostCreateDestination(')
  })

  it('routes all four canonical add params through the unified preselected flow', () => {
    expect(transactionSheet).toContain('initialKind?: TransactionKind')
    expect(transactionSheet).toContain('const natureChoice = !initialKind ?')
    expect(transactionSheet).toContain('const paymentMethodChoice = selectedKind === \'expense\' ?')
    expect(transactionSheet).toMatch(/initialKind === 'income'\s*\? TransactionType\.INCOME/)
    expect(flow).toContain("parseMovementAddTarget(searchParams.get('add'))")
    expect(flow).toContain("setIntent(happened ? 'happened' : 'upcoming')")
    expect(flow).toContain('setTransactionKind(happened ? routeAddTarget : null)')
    expect(flow).toContain('setSelectedTarget(happened ? null : routeAddTarget)')
    expect(flow).toContain('setOpen(true)')
    expect(flow).toContain("next.delete('add')")
    expect(statementPage).not.toContain("parseMovementAddTarget(searchParams.get('add'))")
    expect(statementPage).not.toContain('requestedInitialKind')
    expect(movementAddDestination('expense', '/movements/statement', ''))
      .toBe('/movements/statement?add=expense')
  })

  it('keeps canonical creation in M6 and route-local sheets limited to detail editing', () => {
    expect(flow).toContain('<DebtSheet')
    expect(flow).toContain('<ReceivableSheet')
    expect(flow).toContain("{ target: 'receivable', title: 'A receber' }")
    expect(flow).toContain('<ReceivableSheet')
    expect(flow).toContain('mode="receivable"')
    expect(flow).toContain('handleReceivableSubmit(data)')
    expect(obligationsClient).toContain('editTarget={editTarget?.kind === \'receivable\' ? editTarget.item : null}')
    expect(obligationsClient).not.toContain('debtCreateOpen')
    expect(obligationsClient).not.toContain('receivableCreateOpen')
    expect(createObligations).toContain("queryKey: ['obligations']")
    expect(createObligations).toContain("queryKey: ['debts']")
    expect(createObligations).toContain("queryKey: ['receivables']")
    expect(createObligations).toContain("queryKey: ['budget']")
    expect(createTransactions).toContain("void queryClient.invalidateQueries({ queryKey: ['obligations'] })")
  })

  it('uses the transaction form segmented-choice style without introducing tall cards', () => {
    expect(flow).toContain("'rounded-lg border px-3 py-2 text-sm font-medium transition-colors'")
    expect(transactionSheet).toContain("'rounded-lg border px-3 py-2 text-sm font-medium transition-colors'")
    expect(transactionSheet).toContain('{paymentMethodChoice}')
    expect(transactionSheet).toContain('{leadingContent}')
    expect(flow).not.toContain('min-h-20')
    expect(flow).not.toContain('min-h-24')
    expect(flow).not.toContain('rounded-xl border border-border bg-background')
  })

  it('keeps both progressive decisions directly in the drawer body', () => {
    expect(flow).not.toContain('DrawerOutlineCard')
    expect(flow).toContain('O que voc\u00ea quer registrar?')
    expect(flow).toContain('aria-pressed={intent === value}')
    expect(flow).toContain('{intent && (')
    expect(flow).toContain("{ value: 'happened', label: 'J\u00e1 aconteceu' }")
    expect(flow).toContain("{ value: 'upcoming', label: 'Vai acontecer' }")
    expect(flow).toContain("intent === 'happened' ? 'O que aconteceu?' : 'O que vai acontecer?'")
    expect(flow).toContain("{ target: 'expense', title: 'Gasto' }")
    expect(flow).toContain("{ target: 'income', title: 'Receita' }")
    expect(flow).toContain("{ target: 'receivable', title: 'A receber' }")
    expect(flow).toContain("{ target: 'debt', title: 'D\u00edvida' }")
    expect(flow).toContain('PROGRESSIVE_REVEAL_CLASS')
    expect(flow).not.toContain('Voltar')
    expect(flow).not.toContain('Step 1')
    expect(flow).not.toContain('Step 2')
  })

  it('resets a dependent target when the first decision changes and resets on cancel/reopen', () => {
    expect(flow).toContain('if (intent !== nextIntent) {')
    expect(flow).toContain('setTransactionKind(null)\n      setSelectedTarget(null)')
    expect(flow).toContain('aria-pressed={intent === value}')
    expect(flow).toContain('selectedTarget === target')
    expect(flow).toContain('if (nextOpen) resetDecisions()')
    expect(flow).toContain('if (nextOpen) return\n    resetDecisions()')
    expect(flow).toContain('if (intent !== nextIntent) {')
  })

  it('uses the shared drawer scroll region for the orchestrator and all canonical create forms', () => {
    expect(drawerLayout).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain subtle-scrollbar')
    for (const source of [flow, transactionSheet, debtSheet, receivableSheet]) {
      expect(source).toContain('DRAWER_SCROLL_REGION_CLASS')
    }
  })

  it('keeps scroll locking and scrollbar coverage in shared primitives, without local offsets', () => {
    expect(sheetPrimitive).toContain('SheetPrimitive.Root')
    expect(dialogPrimitive).toContain('DialogPrimitive.Root')
    expect(sheetPrimitive).toContain('fixed inset-0 z-50 bg-black/10')
    expect(sheetPrimitive).not.toContain('fixed inset-y-0 left-0 z-50 w-screen')
    expect(dashboardLayout).toContain('<main className="min-w-0 p-6">{children}</main>')
    expect(dashboardLayout).toContain('data-slot="dashboard-scroll-viewport"')
    expect(flow).not.toMatch(/(?:right|margin-right|padding-right):\s*-?\d/)
    expect(flow).not.toContain('calc(100%')
  })

  it('removes the decision surface while retaining the old form rhythm and progressive body', () => {
    expect(flow).not.toContain('DrawerOutlineCard')
    expect(flow).toContain('{decisionQuestions}')
    expect(flow).toContain('scrollManagedByParent')
    expect(flow).toContain('embeddedFooterHost={footerHost}')
    expect(transactionSheet).toContain('const progressiveChoices = hideContextualQuestions ? null : leadingContent ? (')
    expect(transactionSheet).toContain('<Label>Forma de pagamento</Label>')
    expect(flow).toContain('O que você quer registrar?')
    expect(flow).toContain("intent === 'happened' ? 'O que aconteceu?' : 'O que vai acontecer?'")
    expect(flow).not.toContain('DrawerOutlineCard')
    expect(transactionSheet).not.toContain('DrawerOutlineCard')
    expect(flow).not.toContain('leadingContent={decisionQuestions}')
    for (const source of [transactionSheet, debtSheet, receivableSheet]) {
      expect(source).toContain("scrollManagedByParent ? 'flex flex-col gap-4' : DRAWER_SCROLL_REGION_CLASS")
    }
  })

  it('keeps progressive questions and their scroll container mounted while later sections reveal', () => {
    const stableQuestions = flow.indexOf('{decisionQuestions}')
    const conditionalForms = flow.indexOf('{activeTarget && footerHost && (')
    expect(stableQuestions).toBeGreaterThan(-1)
    expect(conditionalForms).toBeGreaterThan(stableQuestions)
    expect(flow.slice(0, stableQuestions)).toContain('DRAWER_SCROLL_REGION_CLASS')
    expect(flow.slice(stableQuestions, conditionalForms)).not.toContain('key=')
    expect(flow).not.toContain('scrollTop =')
    expect(flow).not.toContain('autoFocus')
    expect(flow).not.toContain('focus()')
  })

  it('uses one parent scroll viewport for decisions and embedded form fields, with fixed header/footer', () => {
    const viewportStart = flow.indexOf('<div className={cn(DRAWER_SCROLL_REGION_CLASS')
    const decisionQuestions = flow.indexOf('{decisionQuestions}', viewportStart)
    const embeddedForm = flow.indexOf('<TransactionSheet', decisionQuestions)
    const viewportEnd = flow.indexOf('</div>\n\n        {activeTarget ? (', embeddedForm)
    const header = flow.indexOf('<SheetHeader')
    const footer = flow.indexOf('<div className="shrink-0 border-t border-border">', viewportEnd)
    expect(viewportStart).toBeGreaterThan(-1)
    expect(header).toBeLessThan(viewportStart)
    expect(decisionQuestions).toBeGreaterThan(viewportStart)
    expect(embeddedForm).toBeGreaterThan(decisionQuestions)
    expect(viewportEnd).toBeGreaterThan(embeddedForm)
    expect(footer).toBeGreaterThan(viewportEnd)
    expect(flow.slice(viewportStart, viewportEnd)).toContain('<DebtSheet')
    expect(flow.slice(viewportStart, viewportEnd)).toContain('<ReceivableSheet')
    for (const source of [transactionSheet, debtSheet, receivableSheet]) {
      expect(source).toContain('createPortal(footer, embeddedFooterHost)')
      expect(source).toContain('{!scrollManagedByParent && footer}')
      expect(source).toContain("scrollManagedByParent && 'px-0 py-0'")
    }
  })

  it('routes all audited drawers through the shared scroll-lock and backdrop primitive', () => {
    expect(transactionDetailsDrawer).toContain('<DetailDrawer')
    expect(detailDrawer).toContain('<SheetContent')
    for (const source of [personDrawer, incomePage, invoiceDrawer]) {
      expect(source).toContain('<SheetContent')
    }
    expect(sheetPrimitive).toContain('<SheetOverlay />')
    expect(sheetPrimitive).toContain('<SheetPrimitive.Popup')
  })

  it('keeps one internal scroller with fixed header and footer at mobile and desktop widths', () => {
    expect(flow).toContain('flex w-full flex-col gap-0 p-0 sm:max-w-md')
    expect(flow).toContain('shrink-0 gap-1 border-b')
    expect(flow).toContain('shrink-0 border-t border-border')
    expect(flow.match(/DRAWER_SCROLL_REGION_CLASS/g)).toHaveLength(2)
    for (const source of [transactionSheet, debtSheet, receivableSheet]) {
      expect(source).toMatch(/scrollManagedByParent \? 'flex flex-col gap-4' : DRAWER_SCROLL_REGION_CLASS/)
      expect(source).not.toContain('embedded && embeddedFormClassName')
    }
  })

  it('retains the shared trigger, cancel, and keyboard-dismissable sheet lifecycle', () => {
    expect(flow).toContain('<SheetTrigger')
    expect(flow).toContain('<SheetClose')
    expect(flow).toContain('onOpenChangeComplete={handleOpenChangeComplete}')
    expect(flow).not.toContain('onKeyDown')
    expect(sheetPrimitive).toContain('<SheetPrimitive.Root data-slot="sheet" {...props} />')
  })
})
