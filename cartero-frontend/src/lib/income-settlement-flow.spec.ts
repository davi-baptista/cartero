import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSettlementPayload } from '@/app/(dashboard)/transactions/mark-as-paid-dialog'

const page = readFileSync(new URL('../app/(dashboard)/recurring/income-panel.tsx', import.meta.url), 'utf-8')
const markAsPaidDialog = readFileSync(new URL('../app/(dashboard)/transactions/mark-as-paid-dialog.tsx', import.meta.url), 'utf-8')
const unmarkWarning = readFileSync(new URL('../app/(dashboard)/transactions/unmark-paid-warning-dialog.tsx', import.meta.url), 'utf-8')
const detailDrawer = readFileSync(new URL('../app/(dashboard)/receivables/receivable-detail-drawer.tsx', import.meta.url), 'utf-8')
const dialogPrimitive = readFileSync(new URL('../components/ui/dialog.tsx', import.meta.url), 'utf-8')

describe('Income settlement and nested detail contracts', () => {
  it('routes linked-history reversals to the canonical warning with no mutation before confirmation', () => {
    const toggle = page.slice(page.indexOf('function handleSelectedReceivableToggle'), page.indexOf('function handleUnmarkPaidConfirm'))
    const confirm = page.slice(page.indexOf('function handleUnmarkPaidConfirm'), page.indexOf('function openRecurringCreate'))

    expect(toggle).toMatch(/else if \(item\.paymentTransactionId\) \{\s*setUnmarkPaidTarget\(item\)\s*\}/)
    expect(confirm).toContain('settlementMutation.mutate({ id: unmarkPaidTarget.id, isPaid: false })')
    expect(page).toContain('<UnmarkPaidWarningDialog open={unmarkPaidTarget !== null}')
    expect(page).toContain('onConfirm={handleUnmarkPaidConfirm}')
    expect(page).toContain('onCancel={() => setUnmarkPaidTarget(null)}')
    expect(unmarkWarning).toContain('confirmLabel={action}')
    expect(unmarkWarning).toContain('Desfazer recebimento')
    expect(unmarkWarning).toContain('onConfirm={onConfirm}')
  })

  it('keeps the recurring parent open for both open and historical occurrence details', () => {
    expect(page).toContain('<Sheet open={selectedRule !== null}')
    expect(page).toContain('onSelect={setSelectedReceivable}')
    expect(page).toContain('onSelect={setSelectedReceivable}')
    expect(page).not.toContain('setSelectedRule(null); setSelectedReceivable(occurrence)')
    expect(page).toContain('<ReceivableDetailDrawer receivable={selectedReceivable}')
    expect(page).toContain('onOpenChange={(open) => { if (!open) setSelectedReceivable(null) }}')
  })

  it('deletes a pending occurrence from the canonical drawer and keeps its source drawer open', () => {
    expect(page).toContain('onDelete={(item) => setOccurrenceDeleteTarget(item)}')
    expect(page).toContain('mutationFn: (id: string) => deleteReceivable(id)')
    expect(page).toContain('title="Excluir este recebimento?"')
    expect(page).toContain('Essa ocorrência será removida e não será criada novamente para esta competência.')
    expect(page).toContain("invalidateRecurringDependents(queryClient, 'income')")
    expect(page).toContain('setSelectedReceivable(null)')
    expect(page).toContain('onError: () => toast.error(\'Não foi possível excluir o recebimento\')')
  })

  it('keeps the detail open while MarkAsPaidDialog is the controlled child action', () => {
    const success = page.slice(page.indexOf('const settlementMutation = useMutation'), page.indexOf('function handleSelectedReceivableToggle'))
    expect(page).toContain('<MarkAsPaidDialog open={markPaidTarget !== null}')
    expect(page).toContain('onCancel={() => setMarkPaidTarget(null)}')
    expect(success).toContain('setSelectedReceivable(updated)')
    expect(success).toContain('if (variables.isPaid) setMarkPaidTarget(null)')
    expect(page).toContain('onToggleReceived={handleSelectedReceivableToggle}')
    expect(detailDrawer).toContain('onClick={() => onToggleReceived(receivable)}')
    expect(markAsPaidDialog).toContain('<Dialog open={open} onOpenChange={(value) => !value && !isPending && onCancel()}>')
    expect(markAsPaidDialog).toContain('onConfirm(buildSettlementPayload({ kind, createTransaction, paymentDate, bankId, type }))')
    expect(dialogPrimitive).toContain('z-50')
  })

  it('edits only the materialized occurrence and refreshes the source and obligation views', () => {
    const occurrenceEdit = page.slice(page.indexOf('const updateOccurrenceMutation'), page.indexOf('const settlementMutation'))
    expect(occurrenceEdit).toContain('return updateReceivable(id, rest)')
    expect(occurrenceEdit).not.toContain('updateRecurringIncome')
    expect(page).toContain('setOccurrenceEditTarget(receivable)')
    expect(page).toContain('<ReceivableSheet mode="income-occurrence"')
    expect(page).toContain("invalidateRecurringDependents(queryClient, 'income')")
  })

  it('synchronizes settle and reopen mutations across Income, Movements, and transactions', () => {
    const settlement = page.slice(page.indexOf('const settlementMutation'), page.indexOf('function handleSelectedReceivableToggle'))
    expect(settlement).toContain("syncSettlementEntity(queryClient, 'receivable', variables.id, result)")
    expect(settlement).toContain('invalidateIncome()')
    expect(settlement).toContain('invalidateTransactionDependents(queryClient, { affectsPerson: false })')
    expect(settlement).toContain('setSelectedReceivable(updated)')
  })

  it('passes the chosen receipt date into the normal settlement payload', () => {
    expect(markAsPaidDialog).toMatch(/kind === 'receivable'\s*\?\s*Boolean\(paymentDate\)/)
    expect(markAsPaidDialog).toMatch(/return \{\s*paymentDate,/)
    expect(page).toContain('settlementMutation.mutate({ id: markPaidTarget.id, isPaid: true, payload })')
    expect(buildSettlementPayload({
      kind: 'receivable',
      createTransaction: true,
      paymentDate: '2026-09-30',
    }).paymentDate).toBe('2026-09-30')
  })
})
