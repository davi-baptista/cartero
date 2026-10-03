'use client'

import { useState } from 'react'
import { Plus, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { DRAWER_SCROLL_REGION_CLASS } from '@/components/ui/drawer-layout'
import { PROGRESSIVE_REVEAL_CLASS } from '@/components/ui/progressive-reveal'
import { DebtSheet, type DebtFormData } from '@/app/(dashboard)/debts/debt-sheet'
import { ReceivableSheet, type ReceivableFormData } from '@/app/(dashboard)/receivables/receivable-sheet'
import type { InstallmentScope } from '@/types'

type Choice = 'receivable' | 'debt' | null

export function PersonContextualCreateFlow({
  open, onOpenChange, personId, personName, timeZone, onCreateDebt, onCreateReceivable,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  personId: string
  personName: string
  timeZone: string | null | undefined
  onCreateDebt: (data: DebtFormData, scope: InstallmentScope | null) => Promise<void>
  onCreateReceivable: (data: ReceivableFormData, scope: InstallmentScope | null) => Promise<void>
}) {
  const [choice, setChoice] = useState<Choice>(null)
  const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null)
  const title = choice === 'receivable'
    ? `Nova cobrança · ${personName}`
    : choice === 'debt' ? `Nova dívida · ${personName}` : `Adicionar movimentação · ${personName}`

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setChoice(null)
    onOpenChange(nextOpen)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md" showCloseButton>
        <SheetHeader className="shrink-0 gap-1 border-b border-border px-6 py-5 pr-14">
          <SheetTitle className="text-lg leading-snug">{title}</SheetTitle>
          <SheetDescription>
            {choice ? 'Preencha os dados para registrar.' : 'Escolha o que quer registrar.'}
          </SheetDescription>
        </SheetHeader>

        {choice === null ? (
          <div className={DRAWER_SCROLL_REGION_CLASS}>
            <div className="space-y-1.5 px-6 py-5">
              <p className="text-sm font-medium">O que você quer registrar?</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setChoice('receivable')} className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Plus aria-hidden="true" className="size-4" /> A receber
                </button>
                <button type="button" onClick={() => setChoice('debt')} className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Minus aria-hidden="true" className="size-4" /> A pagar
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className={`${DRAWER_SCROLL_REGION_CLASS} px-6 py-5`}>
            <div className={PROGRESSIVE_REVEAL_CLASS}>
              {choice === 'debt' ? (
                <DebtSheet key="debt" open onOpenChange={handleOpenChange} editTarget={null} editScope={null} initialPersonId={personId} hidePersonSelector timeZone={timeZone} embedded scrollManagedByParent embeddedFooterHost={footerHost} onSubmit={async (data, scope) => { await onCreateDebt(data, scope); handleOpenChange(false) }} />
              ) : (
                <ReceivableSheet key="receivable" open onOpenChange={handleOpenChange} editTarget={null} editScope={null} initialPersonId={personId} hidePersonSelector timeZone={timeZone} embedded scrollManagedByParent embeddedFooterHost={footerHost} onSubmit={async (data, scope) => { await onCreateReceivable(data, scope); handleOpenChange(false) }} />
              )}
            </div>
          </div>
        )}

        {choice === null ? (
          <SheetFooter className="shrink-0 border-t border-border px-6 py-4">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancelar</Button>
          </SheetFooter>
        ) : (
          <div className="shrink-0 border-t border-border"><div ref={setFooterHost} className="contents" /></div>
        )}
      </SheetContent>
    </Sheet>
  )
}
