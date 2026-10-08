import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TransactionType, type Bank, type Category, type Subscription } from '@/types'
import { EMPTY_RECURRING_CREATE_CHOICE, recurringCreateTarget, selectRecurringExpenseMode, selectRecurringKind } from './recurring-create-choice'

const selectedCreateMethod = vi.hoisted(() => ({ value: null as TransactionType | null }))

vi.mock('react-hook-form', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-hook-form')>()
  return {
    ...actual,
    useForm: ((options: Parameters<typeof actual.useForm>[0]) => actual.useForm({
      ...options,
      defaultValues: selectedCreateMethod.value
        ? { ...options?.defaultValues, type: selectedCreateMethod.value }
        : options?.defaultValues,
    })) as typeof actual.useForm,
  }
})

vi.mock('react-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-dom')>(),
  createPortal: (children: React.ReactNode) => children,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], error: new Error('list unavailable'), isLoading: false, isFetching: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/providers/auth-provider', () => ({ useAuth: () => ({ user: { id: 'user-1', timeZone: 'America/Sao_Paulo' } }) }))
vi.mock('@/lib/detail-navigation', () => ({ useDetailNavigation: () => ({ openId: null, open: vi.fn(), close: vi.fn() }) }))
vi.mock('@/lib/use-detail-entity', () => ({ useDetailEntity: () => ({ entity: null }) }))
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }))
vi.mock('@/app/(dashboard)/transactions/mark-as-paid-dialog', () => ({ MarkAsPaidDialog: () => null }))
vi.mock('@/app/(dashboard)/transactions/unmark-paid-warning-dialog', () => ({ UnmarkPaidWarningDialog: () => null }))
vi.mock('@/app/(dashboard)/debts/debt-detail-drawer', () => ({ DebtDetailDrawer: () => null }))

import { ManualExpensePanel } from '@/app/(dashboard)/recurring/manual-expense-panel'
import { SubscriptionSheet, subscriptionFormSchema } from '@/app/(dashboard)/subscriptions/subscription-sheet'

const host = {} as HTMLElement

describe('rendered recurring create forms', () => {
  it('mounts the manual form after Despesa → Eu marco como pago even when list queries fail', () => {
    const choice = selectRecurringExpenseMode(selectRecurringKind(EMPTY_RECURRING_CREATE_CHOICE, 'expense'), 'manual')
    const markup = renderToStaticMarkup(createElement(ManualExpensePanel, {
      createTarget: recurringCreateTarget(choice) === 'manual',
      formHost: host,
      footerHost: host,
      onCreated: vi.fn(),
      onClose: vi.fn(),
    }))
    for (const label of ['Nome', 'Valor esperado', 'Dia do vencimento', 'Primeira competência', 'Descrição (opcional)', 'Criar despesa']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Mês da primeira despesa')
    expect(markup).toContain('Ano da primeira despesa')
    expect(markup).toContain('Ex.: Aluguel')
    expect(markup).toContain('Anotação livre...')
  })

  it('starts automatic create with only payment choices and no selected method', () => {
    const markup = renderToStaticMarkup(createElement(SubscriptionSheet, {
      open: true,
      onOpenChange: vi.fn(),
      onSubmit: vi.fn(),
      embedded: true,
    }))
    for (const method of ['Crédito', 'Débito', 'PIX', 'Boleto']) expect(markup).toContain(method)
    expect(markup).not.toContain('aria-pressed="true"')
    expect(markup).not.toContain('Dia da cobrança')
    expect(markup).not.toContain('Criar banco')
  })

  it.each([
    [TransactionType.CREDIT_CARD, 'Crédito'],
    [TransactionType.DEBIT_CARD, 'Débito'],
    [TransactionType.PIX, 'PIX'],
    [TransactionType.BOLETO, 'Boleto'],
  ])('reveals the appropriate fields when %s is selected', (method, label) => {
    selectedCreateMethod.value = method
    try {
      const markup = renderToStaticMarkup(createElement(SubscriptionSheet, {
        open: true,
        onOpenChange: vi.fn(),
        onSubmit: vi.fn(),
        embedded: true,
      }))
      expect(markup).toMatch(new RegExp(`aria-pressed="true"[^>]*>${label}</button>`))
      for (const field of ['Nome', 'Valor', 'Categoria', 'Dia da cobrança', 'Primeira competência', 'Descrição (opcional)']) {
        expect(markup).toContain(field)
      }
      expect(markup).toContain('Criar categoria')
      expect(markup).toContain('Selecione uma categoria')
      expect(markup).not.toContain('Assinatura (padrão)')
      expect(markup).toContain('Ex.: Netflix')
      expect(markup).toContain('Anotação livre...')
      expect(markup).toContain('Selecionar mês')
      expect(markup).toMatch(/aria-label="Ano da primeira competência"[^>]*placeholder="Ano"[^>]*value=""/)
      if (method === TransactionType.CREDIT_CARD) {
        expect(markup).toContain('aria-label="Banco"')
        expect(markup).toContain('Criar banco')
        expect(markup).not.toContain('Adicionar banco (opcional)')
      } else {
        expect(markup).not.toContain('aria-label="Banco"')
        expect(markup).not.toContain('Criar banco')
        expect(markup).toContain('Adicionar banco (opcional)')
      }
    } finally {
      selectedCreateMethod.value = null
    }
  })

  it('requires a bank only for credit in the automatic form schema', () => {
    const base = { title: 'Netflix', categoryId: 'category-1', amount: 39.9, dayOfMonth: 12, startedAt: '2026-10' }
    expect(subscriptionFormSchema.safeParse({ ...base, type: TransactionType.CREDIT_CARD }).success).toBe(false)
    expect(subscriptionFormSchema.safeParse({ ...base, type: TransactionType.CREDIT_CARD, bankId: 'bank-1' }).success).toBe(true)
    for (const type of [TransactionType.DEBIT_CARD, TransactionType.PIX, TransactionType.BOLETO]) {
      expect(subscriptionFormSchema.safeParse({ ...base, type }).success).toBe(true)
    }
    expect(subscriptionFormSchema.safeParse({ ...base, type: TransactionType.PIX, startedAt: '' }).success).toBe(false)
  })

  it('requires an explicit category for every automatic payment method', () => {
    const base = { title: 'Netflix', amount: 39.9, dayOfMonth: 12, startedAt: '2026-10' }
    for (const type of [TransactionType.CREDIT_CARD, TransactionType.DEBIT_CARD, TransactionType.PIX, TransactionType.BOLETO]) {
      const bankId = type === TransactionType.CREDIT_CARD ? 'bank-1' : undefined
      expect(subscriptionFormSchema.safeParse({ ...base, type, bankId }).success).toBe(false)
      expect(subscriptionFormSchema.safeParse({ ...base, type, bankId, categoryId: 'category-1' }).success).toBe(true)
    }
  })

  it('shows persisted payment method and all fields while editing', () => {
    const subscription = {
      id: 'subscription-1', userId: 'user-1', bankId: 'bank-1', categoryId: 'category-1',
      title: 'Netflix', type: TransactionType.PIX, amount: 49, description: '',
      dayOfMonth: 12, startedAt: '2026-10', isActive: true, createdAt: '', updatedAt: '',
      bank: { id: 'bank-1', name: 'Banco', isSystem: false } as Bank,
      category: { id: 'category-1', name: 'Streaming', isSystem: false } as Category,
    } as Subscription
    const markup = renderToStaticMarkup(createElement(SubscriptionSheet, {
      open: true,
      onOpenChange: vi.fn(),
      onSubmit: vi.fn(),
      editSubscription: subscription,
      embedded: true,
    }))
    expect(markup).toMatch(/aria-pressed="true"[^>]*>PIX<\/button>/)
    for (const label of ['Nome', 'Valor', 'Banco', 'Categoria', 'Dia da cobrança', 'Primeira competência', 'Descrição (opcional)']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Mês da primeira competência')
    expect(markup).toContain('Ano da primeira competência')
    expect(markup).toContain('value="10"')
    expect(markup).toContain('value="2026"')
    expect(markup).toContain('aria-label="Banco"')
    expect(markup).toContain('Criar banco')
    expect(markup).toContain('Streaming')
  })

  it('treats the internal bank as an unselected optional bank on edit', () => {
    const subscription = {
      id: 'subscription-2', userId: 'user-1', bankId: 'no-bank', categoryId: 'category-1',
      title: 'Internet', type: TransactionType.BOLETO, amount: 80, description: '',
      dayOfMonth: 5, startedAt: '2025-02', isActive: true, createdAt: '', updatedAt: '',
      bank: { id: 'no-bank', name: '__system_receivables__', isSystem: true } as Bank,
      category: { id: 'category-1', name: 'Assinatura', isSystem: true } as Category,
    } as Subscription
    const markup = renderToStaticMarkup(createElement(SubscriptionSheet, {
      open: true, onOpenChange: vi.fn(), onSubmit: vi.fn(), editSubscription: subscription, embedded: true,
    }))
    expect(markup).toContain('Adicionar banco (opcional)')
    expect(markup).not.toContain('aria-label="Banco"')
    expect(markup).not.toContain('__system_receivables__')
    expect(markup).toContain('value="02"')
    expect(markup).toContain('value="2025"')
    expect(markup).toContain('Selecione uma categoria')
    expect(markup).not.toContain('Assinatura (padrão)')
  })
})
