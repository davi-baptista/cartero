'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { DRAWER_SCROLL_REGION_CLASS } from '@/components/ui/drawer-layout'
import { PROGRESSIVE_REVEAL_CLASS } from '@/components/ui/progressive-reveal'
import { TransactionSheet } from '@/app/(dashboard)/transactions/transaction-sheet'
import { DebtSheet } from '@/app/(dashboard)/debts/debt-sheet'
import { ReceivableSheet } from '@/app/(dashboard)/receivables/receivable-sheet'
import { useAuth } from '@/providers/auth-provider'
import { useCreateDebtMutation, useCreateReceivableMutation } from '@/lib/use-create-obligations'
import { useCreateTransactionMutation } from '@/lib/use-create-transaction'
import {
  parseMovementAddTarget,
  movementPostCreateDestination,
  type MovementAddTarget,
} from '@/lib/movements-add-flow'
import type { TransactionKind } from '@/lib/transaction-kind'
import { cn } from '@/lib/utils'

type AddIntent = 'happened' | 'upcoming'

const INTENT_OPTIONS: Array<{ value: AddIntent; label: string }> = [
  { value: 'happened', label: 'Já aconteceu' },
  { value: 'upcoming', label: 'Vai acontecer' },
]

const TARGETS: Record<AddIntent, Array<{ target: MovementAddTarget; title: string }>> = {
  happened: [
    { target: 'expense', title: 'Gasto' },
    { target: 'income', title: 'Receita' },
  ],
  upcoming: [
    { target: 'receivable', title: 'A receber' },
    { target: 'debt', title: 'Dívida' },
  ],
}

function DecisionQuestions({
  intent,
  transactionKind,
  selectedTarget,
  onIntentChange,
  onTransactionKindChange,
  onTargetChange,
}: {
  intent: AddIntent | null
  transactionKind: TransactionKind | null
  selectedTarget: MovementAddTarget | null
  onIntentChange: (intent: AddIntent) => void
  onTransactionKindChange: (kind: TransactionKind) => void
  onTargetChange: (target: MovementAddTarget) => void
}) {
  const choiceClass = (selected: boolean) => cn(
    'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
    selected
      ? 'border-primary bg-primary/10 text-foreground'
      : 'border-border text-muted-foreground hover:bg-muted/50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  )

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <Label>O que você quer registrar?</Label>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Quando acontece">
          {INTENT_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={intent === value}
              onClick={() => onIntentChange(value)}
              className={choiceClass(intent === value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {intent && (
        <section
          key={intent}
          className={cn('space-y-1.5', PROGRESSIVE_REVEAL_CLASS)}
        >
          <Label>{intent === 'happened' ? 'O que aconteceu?' : 'O que vai acontecer?'}</Label>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de movimentação">
            {TARGETS[intent].map(({ target, title }) => {
              const selected = intent === 'happened'
                ? transactionKind === target
                : selectedTarget === target
              return (
                <button
                  key={target}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => intent === 'happened'
                    ? onTransactionKindChange(target as TransactionKind)
                    : onTargetChange(target)}
                  className={choiceClass(selected)}
                >
                  {title}
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

export function MovementsAddFlow() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const routeAddTarget = parseMovementAddTarget(searchParams.get('add'))
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [intent, setIntent] = useState<AddIntent | null>(null)
  const [transactionKind, setTransactionKind] = useState<TransactionKind | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<MovementAddTarget | null>(null)
  const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null)
  const pendingCreateTarget = useRef<MovementAddTarget | null>(null)
  const pendingDestination = useRef<string | null>(null)
  const handledRouteAdd = useRef<string | null>(null)

  useEffect(() => {
    if (!routeAddTarget) {
      handledRouteAdd.current = null
      return
    }
    const key = `${pathname}:${routeAddTarget}`
    if (handledRouteAdd.current === key) return
    handledRouteAdd.current = key

    const happened = routeAddTarget === 'expense' || routeAddTarget === 'income'
    setIntent(happened ? 'happened' : 'upcoming')
    setTransactionKind(happened ? routeAddTarget : null)
    setSelectedTarget(happened ? null : routeAddTarget)
    setOpen(true)

    const next = new URLSearchParams(searchParams.toString())
    next.delete('add')
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [pathname, routeAddTarget, router, searchParams])

  const resetDecisions = () => {
    setIntent(null)
    setTransactionKind(null)
    setSelectedTarget(null)
    pendingCreateTarget.current = null
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) resetDecisions()
    setOpen(nextOpen)
  }

  const handleOpenChangeComplete = (nextOpen: boolean) => {
    if (nextOpen) return
    resetDecisions()
    const destination = pendingDestination.current
    pendingDestination.current = null
    if (destination) router.push(destination, { scroll: false })
  }

  const handleCreated = () => {
    const target = pendingCreateTarget.current
    if (!target) return
    pendingDestination.current = movementPostCreateDestination(
      target,
      pathname,
      searchParams.toString(),
    )
    setOpen(false)
  }

  const transactionMutation = useCreateTransactionMutation(handleCreated)
  const debtMutation = useCreateDebtMutation(handleCreated)
  const receivableMutation = useCreateReceivableMutation(handleCreated)

  const handleIntentChange = (nextIntent: AddIntent) => {
    if (intent !== nextIntent) {
      setTransactionKind(null)
      setSelectedTarget(null)
    }
    setIntent(nextIntent)
  }

  const decisionQuestions = (
    <DecisionQuestions
      intent={intent}
      transactionKind={transactionKind}
      selectedTarget={selectedTarget}
      onIntentChange={handleIntentChange}
      onTransactionKindChange={(kind) => {
        setSelectedTarget(null)
        setTransactionKind(kind)
      }}
      onTargetChange={(target) => setSelectedTarget(target)}
    />
  )

  const activeTarget: MovementAddTarget | null = intent === 'happened'
    ? transactionKind
    : intent === 'upcoming'
      ? selectedTarget
      : null

  const handleTransactionSubmit = async (data: Parameters<typeof transactionMutation.mutateAsync>[0]) => {
    pendingCreateTarget.current = transactionKind
    await transactionMutation.mutateAsync(data)
  }

  const handleDebtSubmit = async (data: Parameters<typeof debtMutation.mutateAsync>[0]) => {
    pendingCreateTarget.current = 'debt'
    await debtMutation.mutateAsync(data)
  }

  const handleReceivableSubmit = async (data: Parameters<typeof receivableMutation.mutateAsync>[0]) => {
    pendingCreateTarget.current = 'receivable'
    await receivableMutation.mutateAsync(data)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={handleOpenChangeComplete}
    >
      <SheetTrigger render={<Button><Plus aria-hidden="true" />Adicionar</Button>} />
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md" showCloseButton>
        <SheetHeader className="shrink-0 gap-1 border-b border-border px-6 py-5 pr-14">
          <SheetTitle className="text-lg leading-snug">Adicionar movimentação</SheetTitle>
          <SheetDescription>Selecione o que você quer registrar.</SheetDescription>
        </SheetHeader>

        <div className={cn(DRAWER_SCROLL_REGION_CLASS, 'flex flex-col gap-4 px-6 py-5')}>
          {decisionQuestions}

        {activeTarget && footerHost && (activeTarget === 'expense' || activeTarget === 'income' ? (
          <TransactionSheet
            key={activeTarget}
            open={open}
            onOpenChange={handleOpenChange}
            editTarget={null}
            onSubmit={handleTransactionSubmit}
            timeZone={user?.timeZone}
            initialKind={activeTarget}
            embedded
            scrollManagedByParent
            embeddedFooterHost={footerHost}
          />
        ) : activeTarget === 'debt' ? (
          <DebtSheet
            open={open}
            onOpenChange={handleOpenChange}
            editTarget={null}
            editScope={null}
            timeZone={user?.timeZone}
            embedded
            scrollManagedByParent
            embeddedFooterHost={footerHost}
            onSubmit={async (data) => { await handleDebtSubmit(data) }}
          />
        ) : (
          <ReceivableSheet
            open={open}
            onOpenChange={handleOpenChange}
            editTarget={null}
            editScope={null}
            timeZone={user?.timeZone}
            mode="receivable"
            embedded
            scrollManagedByParent
            embeddedFooterHost={footerHost}
            onSubmit={async (data) => { await handleReceivableSubmit(data) }}
          />
        ))}
        </div>

        {activeTarget ? (
          <div className="shrink-0 border-t border-border">
            <div ref={setFooterHost} className="contents" />
          </div>
        ) : (
          <SheetFooter className="shrink-0 border-t border-border px-6 py-4">
            <SheetClose render={<Button type="button" variant="outline">Cancelar</Button>} />
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
