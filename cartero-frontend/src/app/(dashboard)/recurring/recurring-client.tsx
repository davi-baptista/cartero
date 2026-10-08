'use client'

import { useCallback, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContextHeading } from '@/components/ui/context-heading'
import { Label } from '@/components/ui/label'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DRAWER_SCROLL_REGION_CLASS } from '@/components/ui/drawer-layout'
import { PROGRESSIVE_REVEAL_CLASS } from '@/components/ui/progressive-reveal'
import { DETAIL_PARAMS } from '@/lib/detail-navigation'
import { movementViewLinkClass } from '@/lib/movement-view-switch'
import { EMPTY_RECURRING_CREATE_CHOICE, recurringCreateTarget, selectRecurringExpenseMode, selectRecurringKind, type RecurringCreateTarget } from '@/lib/recurring-create-choice'
import { cn } from '@/lib/utils'
import { IncomePanel } from './income-panel'
import { SubscriptionPanel } from './subscription-panel'
import { ManualExpensePanel } from './manual-expense-panel'

type RecurringTab = 'income' | 'expenses'

function choiceClass(selected: boolean) {
  return cn(
    'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
    selected
      ? 'border-primary bg-primary/10 text-foreground'
      : 'border-border text-muted-foreground hover:bg-muted/50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  )
}

export function RecurringClient() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab: RecurringTab = searchParams.get('tab') === 'expenses' ? 'expenses' : 'income'
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState(EMPTY_RECURRING_CREATE_CHOICE)
  const [formHost, setFormHost] = useState<HTMLDivElement | null>(null)
  const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null)
  const pendingDestination = useRef<string | null>(null)
  const { kind, expenseMode } = choice
  const activeTarget = recurringCreateTarget(choice)

  const setTab = useCallback((nextTab: RecurringTab) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', nextTab)
    for (const key of DETAIL_PARAMS) params.delete(key)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }, [pathname, router, searchParams])

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setChoice(EMPTY_RECURRING_CREATE_CHOICE)
    }
    setOpen(nextOpen)
  }

  function handleOpenChangeComplete(nextOpen: boolean) {
    if (nextOpen) return
    setChoice(EMPTY_RECURRING_CREATE_CHOICE)
    const destination = pendingDestination.current
    pendingDestination.current = null
    if (destination) router.push(destination, { scroll: false })
  }

  function handleCreated(target: RecurringCreateTarget, id?: string) {
    const params = new URLSearchParams(searchParams.toString())
    for (const key of DETAIL_PARAMS) params.delete(key)
    params.set('tab', target === 'income' ? 'income' : 'expenses')
    if (target === 'manual' && id) params.set('recurringExpenseRuleId', id)
    pendingDestination.current = `${pathname}?${params.toString()}`
    setOpen(false)
  }

  return <div className="flex flex-col gap-6">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-1.5">
      <div className="min-w-min flex-1"><h1 className="break-words text-2xl font-semibold tracking-tight">Recorrentes</h1><p className="mt-0.5 text-sm text-muted-foreground">Receitas e despesas que se repetem, sem precisar recriar todo mês.</p></div>
      <div className="flex shrink-0 justify-end"><Button className="shrink-0 gap-2" onClick={() => handleOpenChange(true)} aria-label="Adicionar recorrência"><Plus className="size-4" /> Adicionar</Button></div>
    </div>

    <Tabs value={tab} onValueChange={(value) => setTab(value === 'expenses' ? 'expenses' : 'income')}>
      <div className="space-y-2">
        <TabsList aria-label="Tipo de recorrência" className="flex w-full max-w-md rounded-xl border bg-muted/40 p-1 group-data-horizontal/tabs:h-auto sm:inline-flex">
          <TabsTrigger value="income" className={cn(movementViewLinkClass(tab === 'income'), 'h-auto border-0 after:hidden dark:data-active:bg-background')}>Receitas</TabsTrigger>
          <TabsTrigger value="expenses" className={cn(movementViewLinkClass(tab === 'expenses'), 'h-auto border-0 after:hidden dark:data-active:bg-background')}>Despesas</TabsTrigger>
        </TabsList>
        <div className="pt-1"><div aria-hidden className="border-t border-border/60" /></div>
      </div>
      <TabsContent value="income" keepMounted className="pt-4">
        <div className="mb-3">
          <ContextHeading
            title="Receitas recorrentes"
            description="Salários e outras entradas que se repetem."
            infoLabel="Sobre receitas recorrentes"
            infoContent="Cadastre entradas que se repetem, como salário e aluguel recebido. Elas ficam previstas até você registrar o recebimento."
          />
        </div>
        <IncomePanel createTarget={open && activeTarget === 'income'} formHost={formHost} footerHost={footerHost} onCreated={() => handleCreated('income')} onClose={() => setOpen(false)} />
      </TabsContent>
      <TabsContent value="expenses" keepMounted className="pt-4">
        <div className="mb-6">
          <ContextHeading
            title="Despesas recorrentes"
            description="Aluguel, assinaturas e outras contas que se repetem."
            infoLabel="Sobre despesas recorrentes"
            infoContent="Cadastre contas que se repetem, como aluguel, internet e assinaturas. Algumas são lançadas automaticamente; outras ficam em aberto até você registrar o pagamento."
          />
        </div>
        <div className="space-y-10">
          <SubscriptionPanel createTarget={open && activeTarget === 'automatic'} formHost={formHost} footerHost={footerHost} onCreated={() => handleCreated('automatic')} onClose={() => setOpen(false)} />
          <ManualExpensePanel createTarget={open && activeTarget === 'manual'} formHost={formHost} footerHost={footerHost} onCreated={(id) => handleCreated('manual', id)} onClose={() => setOpen(false)} />
        </div>
      </TabsContent>
    </Tabs>

    <Sheet open={open} onOpenChange={handleOpenChange} onOpenChangeComplete={handleOpenChangeComplete}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md" showCloseButton>
        <SheetHeader className="shrink-0 gap-1 border-b border-border px-6 py-5 pr-14">
          <SheetTitle className="text-lg leading-snug">Adicionar recorrência</SheetTitle>
          <SheetDescription>Selecione o que você quer cadastrar.</SheetDescription>
        </SheetHeader>
        <div className={cn(DRAWER_SCROLL_REGION_CLASS, 'flex flex-col gap-4 px-6 py-5')}>
          <section className="space-y-1.5">
            <Label>O que você quer cadastrar?</Label>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de recorrência a cadastrar">
              <button type="button" aria-pressed={kind === 'income'} onClick={() => setChoice((current) => selectRecurringKind(current, 'income'))} className={choiceClass(kind === 'income')}>Receita</button>
              <button type="button" aria-pressed={kind === 'expense'} onClick={() => setChoice((current) => selectRecurringKind(current, 'expense'))} className={choiceClass(kind === 'expense')}>Despesa</button>
            </div>
            {kind ? <p className="text-xs text-muted-foreground">{kind === 'income' ? 'Salário e outras entradas que se repetem.' : 'Aluguel, assinaturas e outras contas que se repetem.'}</p> : null}
          </section>

          {kind === 'expense' ? <section className={cn('space-y-1.5', PROGRESSIVE_REVEAL_CLASS)}>
            <Label>Como essa despesa funciona?</Label>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Modo da despesa recorrente">
              <button type="button" aria-pressed={expenseMode === 'automatic'} onClick={() => setChoice((current) => selectRecurringExpenseMode(current, 'automatic'))} className={choiceClass(expenseMode === 'automatic')}>Lançamento automático</button>
              <button type="button" aria-pressed={expenseMode === 'manual'} onClick={() => setChoice((current) => selectRecurringExpenseMode(current, 'manual'))} className={choiceClass(expenseMode === 'manual')}>Eu marco como pago</button>
            </div>
              {expenseMode ? <p className="text-xs text-muted-foreground">{expenseMode === 'automatic' ? 'O gasto é lançado automaticamente.' : 'A conta fica em aberto até você marcar como paga.'}</p> : null}
          </section> : null}

          <div ref={setFormHost} className={activeTarget ? 'w-full' : 'hidden'} />
        </div>
        {activeTarget ? <div className="shrink-0 border-t border-border"><div ref={setFooterHost} className="contents" /></div> : <SheetFooter className="shrink-0 border-t border-border px-6 py-4"><SheetClose render={<Button type="button" variant="outline">Cancelar</Button>} /></SheetFooter>}
      </SheetContent>
    </Sheet>
  </div>
}
