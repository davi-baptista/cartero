'use client'

import { Pencil, Trash2, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DetailAmount,
  DetailDrawer,
  DetailFooter,
  DetailList,
  DetailNotice,
  DetailRow,
  DETAIL_ACTION_CLASS,
} from '@/components/ui/detail-drawer'
import {
  ROW_AMOUNT_CLASS,
  ROW_AMOUNT_TONE,
} from '@/components/ui/financial-list-row'
import { bankDisplayName } from '@/lib/bank-display'
import { cn } from '@/lib/utils'
import {
  formatCurrency,
  formatDate,
  formatMonthYear,
  TRANSACTION_TYPE_LABELS,
} from '@/lib/formatters'
import type { Subscription } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Detalhe da assinatura
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Mesma casca dos detalhes de transação, dívida e cobrança.
 *
 * A row expunha Pausar, Editar e Excluir — três ícones no hover do desktop
 * MAIS um `DropdownMenu` no mobile, duas implementações da mesma coisa para
 * manter em paralelo. A lista identifica; o detalhe administra.
 *
 * Nenhuma regra nova: os handlers são os mesmos que a lista já usava, com as
 * confirmações que já existiam.
 */
export function SubscriptionDetailDrawer({
  subscription,
  onOpenChange,
  onEdit,
  onDelete,
  onToggle,
}: {
  /** `null` mantém o drawer fechado. */
  subscription: Subscription | null
  onOpenChange: (open: boolean) => void
  onEdit: (subscription: Subscription) => void
  onDelete: (subscription: Subscription) => void
  onToggle: (subscription: Subscription) => void
}) {
  if (!subscription) return null

  const inactive = !subscription.isActive

  /** "2026-08" → "agosto de 2026", sem passar por `Date`. */
  const cycleLabel = (cycle: string) => {
    const [year, month] = cycle.slice(0, 7).split('-').map(Number)
    return formatMonthYear(month, year)
  }

  return (
    <DetailDrawer
      open
      onOpenChange={onOpenChange}
      title={subscription.title}
      description={`Assinatura · todo dia ${subscription.dayOfMonth}`}
      footer={
        <>
          {/*
            Pausar/retomar vem primeiro: é a ação corriqueira, e a única que a
            row oferecia sem passar por confirmação.
          */}
        <DetailFooter>
          <Button
            variant="outline"
            className={DETAIL_ACTION_CLASS}
            onClick={() => onToggle(subscription)}
          >
            {inactive ? <Play className="size-4" /> : <Pause className="size-4" />}
            {inactive ? 'Retomar' : 'Pausar'}
          </Button>
        </DetailFooter>

        <DetailFooter className="border-t-0 pt-0">
          <Button
            variant="outline"
            className={DETAIL_ACTION_CLASS}
            onClick={() => onEdit(subscription)}
          >
            <Pencil className="size-4" />
            Editar
          </Button>
          <Button
            variant="destructive"
            className={DETAIL_ACTION_CLASS}
            onClick={() => onDelete(subscription)}
          >
            <Trash2 className="size-4" />
            Excluir
          </Button>
        </DetailFooter>
        </>
      }
    >
      <DetailAmount label="Valor por cobrança">
        {/* Saída recorrente — mesma cor de gasto da row. */}
        <span className={cn(ROW_AMOUNT_CLASS, ROW_AMOUNT_TONE.out)}>
          −{formatCurrency(Number(subscription.amount))}
        </span>
      </DetailAmount>

      <DetailList>
        <DetailRow label="Status">{inactive ? 'Pausada' : 'Ativa'}</DetailRow>
        <DetailRow label="Cobrança">
          {/*
            `nextCharge` vem do BACKEND, pela mesma regra que decide a
            geração. Pausada não mostra data: inventar uma seria mentir sobre
            o estado, e é justamente esse o dado que revela que a geração
            parou.
          */}
          {inactive ? (
            <span className="text-muted-foreground">
              Sem cobranças enquanto estiver pausada
            </span>
          ) : subscription.nextCharge ? (
            <>Próxima em {formatDate(subscription.nextCharge)}</>
          ) : (
            <>Todo dia {subscription.dayOfMonth}</>
          )}
        </DetailRow>
        <DetailRow label="Forma">
          {TRANSACTION_TYPE_LABELS[subscription.type]}
        </DetailRow>
        <DetailRow label="Banco">
          {bankDisplayName(subscription.bank)}
        </DetailRow>
        {subscription.category && (
          <DetailRow label="Categoria">{subscription.category.name}</DetailRow>
        )}
        <DetailRow label="Assinando desde">
          {cycleLabel(subscription.startedAt)}
        </DetailRow>
        {subscription.lastGeneratedFor && (
          <DetailRow label="Último ciclo">
            {cycleLabel(subscription.lastGeneratedFor)}
          </DetailRow>
        )}
        {subscription.description && (
          <DetailRow label="Descrição">
            <span className="whitespace-pre-wrap">
              {subscription.description}
            </span>
          </DetailRow>
        )}
      </DetailList>

      {inactive && subscription.activeSince && (
        <DetailNotice>
          Ao retomar, a cobrança recomeça a partir de{' '}
          {cycleLabel(subscription.activeSince)} — os meses da pausa não são
          gerados retroativamente.
        </DetailNotice>
      )}

    </DetailDrawer>
  )
}
