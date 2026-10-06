'use client'

import Link from 'next/link'
import { Pencil, Trash2, CalendarDays, Check, Undo2, ShoppingBag, UserRoundMinus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DetailAmount,
  DetailDrawer,
  DetailFooter,
  DetailList,
  DetailNotice,
  DetailRow,
  DETAIL_ACTION_CLASS,
  DETAIL_ACTION_STACK_CLASS,
} from '@/components/ui/detail-drawer'
import {
  ROW_AMOUNT_CLASS,
  ROW_AMOUNT_TONE,
} from '@/components/ui/financial-list-row'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { accountCivilDayOf, accountToday } from '@/lib/date'
import {
  canEditSettlementDate,
  settlementDateActionLabel,
} from '@/lib/settlement-date-action'
import { settlementStatus } from '@/lib/settlement-status'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DIALOG_ROOMY_CLASS } from '@/components/ui/confirm-dialog'
import { apiErrorMessage } from '@/lib/api-error'
import { ReceivableUnlinkDialog } from './receivable-unlink-dialog'
import { SourceTransactionDeleteDialog } from './source-transaction-delete-dialog'
import {
  canDeleteReceivable,
  resolveReceivableDeletePolicy,
} from '@/lib/receivable-delete-policy'
import { useAuth } from '@/providers/auth-provider'
import type { ObligationDetailMode } from '@/lib/obligation-detail-mode'
import type { Receivable } from '@/types'

type ReceivableDeleteFlowKind =
  | 'choose-source-action'
  | 'delete-source'
  | 'unlink'
  | 'protected-received'
  | 'delete-recurring-received'

type ReceivableDeleteFlow = {
  receivableId: string
  kind: ReceivableDeleteFlowKind
} | null

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Detalhe da cobrança
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Mesma casca do detalhe de dívida e do de transação; campos e restrições são
 * de Receivable.
 *
 * A distinção que governa esta tela é a origem:
 *
 *   MANUAL     — cadastrada pelo usuário. Editar e excluir normalmente.
 *   AUTOMÁTICA — nasceu de uma compra no cartão (`transactionId`). A compra é
 *                a fonte de verdade: editar valor aqui seria descartado por
 *                `syncLinkedReceivable`, e excluir isolado apagaria a compra
 *                junto.
 *
 * A compra continua sendo a origem da verdade. O usuário inicia a ação pelo
 * recebível e escolhe excluir a compra ou mantê-la e desvincular a pessoa.
 *
 * Nada disso é regra nova: é a regra que já existia, agora visível em vez de
 * descoberta ao esbarrar num aviso.
 */
export function ReceivableDetailDrawer({
  receivable,
  onOpenChange,
  onEdit,
  onDelete,
  onDeleteRecurringReceived,
  onDeleteFlowStart,
  onToggleReceived,
  onEditSettlementDate,
  mode = 'operational',
}: {
  /** `null` mantém o drawer fechado. */
  receivable: Receivable | null
  onOpenChange: (open: boolean) => void
  onEdit?: (receivable: Receivable) => void
  onDelete?: (receivable: Receivable) => void
  onDeleteRecurringReceived?: (receivable: Receivable) => Promise<void>
  /** Clears any page-owned fallback confirmation before the drawer opens its intent. */
  onDeleteFlowStart?: (receivable: Receivable) => void
  onToggleReceived?: (receivable: Receivable) => void
  onEditSettlementDate?: (receivable: Receivable) => void
  mode?: ObligationDetailMode
}) {
  const { user } = useAuth()
  const [deleteFlow, setDeleteFlow] = useState<ReceivableDeleteFlow>(null)

  if (!receivable) return null

  const today = accountToday(user?.timeZone ?? null)
  const status = settlementStatus(receivable, today)
  const overdue = status === 'overdue'
  const isAutomatic = Boolean(receivable.transactionId)
  const isRecurringIncome = Boolean(receivable.recurringIncomeRuleId)
  const sourcePerson = receivable.sourceTransaction?.personName ?? receivable.person?.name ?? receivable.debtorName
  const canUnlink = Boolean(
    mode === 'operational' && receivable.transactionId && receivable.sourceTransaction?.personId,
  )
  const policy = resolveReceivableDeletePolicy(receivable)
  const counterparty = receivable.person?.name ?? receivable.debtorName
  const activeDeleteFlow = mode === 'operational' && deleteFlow?.receivableId === receivable.id
    ? deleteFlow.kind
    : null
  const recurringIncomeReceived = isRecurringIncome && receivable.isPaid
  const showDeleteAction = Boolean(
    onDelete &&
      (canDeleteReceivable(policy) || isAutomatic || recurringIncomeReceived) &&
      (!recurringIncomeReceived || onDeleteRecurringReceived),
  )

  const openDeleteFlow = (kind: ReceivableDeleteFlowKind) => {
    setDeleteFlow({ receivableId: receivable.id, kind })
  }

  const handleDelete = () => {
    onDeleteFlowStart?.(receivable)
    if (recurringIncomeReceived) {
      openDeleteFlow('delete-recurring-received')
    } else if (receivable.isPaid && isAutomatic) {
      openDeleteFlow('protected-received')
    } else if (isAutomatic) {
      openDeleteFlow(canUnlink ? 'choose-source-action' : 'delete-source')
    } else {
      onDelete?.(receivable)
    }
  }

  /** Deep link para a compra de origem no Extrato. */
  const purchaseHref = isAutomatic
    ? `/movements/statement?highlight=${receivable.transactionId}`
    : null

  return (
    <>
    <DetailDrawer
      open
      onOpenChange={(open) => {
        if (!open) setDeleteFlow(null)
        onOpenChange(open)
      }}
      title={receivable.title}
      description={`Cobrança · vence em ${formatDate(receivable.dueDate)}`}
      footer={mode === 'readOnly' || (!onToggleReceived && !onEdit && !onDelete && !onEditSettlementDate) ? undefined : (
        <>
        {(onToggleReceived || (canEditSettlementDate(receivable) && onEditSettlementDate)) && <DetailFooter className={DETAIL_ACTION_STACK_CLASS}>
          {onToggleReceived && <Button
            variant="outline"
            className={DETAIL_ACTION_CLASS}
            onClick={() => onToggleReceived(receivable)}
          >
            {receivable.isPaid ? (
              <Undo2 className="size-4" />
            ) : (
              <Check className="size-4" />
            )}
            {receivable.isPaid ? 'Desfazer recebimento' : 'Marcar como recebido'}
          </Button>}
          {canEditSettlementDate(receivable) && onEditSettlementDate && (
            <Button
              variant="outline"
              className={DETAIL_ACTION_CLASS}
              onClick={() => onEditSettlementDate(receivable)}
            >
              <CalendarDays className="size-4" />
              {settlementDateActionLabel('receivable')}
            </Button>
          )}
        </DetailFooter>}

        {(onEdit || showDeleteAction) && <DetailFooter className="border-t-0 pt-0">
          {onEdit && <Button
            variant="outline"
            className={DETAIL_ACTION_CLASS}
            onClick={() => onEdit(receivable)}
          >
            <Pencil className="size-4" />
            Editar
          </Button>}
          {/*
            Quem decide é o resolver canônico, não `isAutomatic`: uma cobrança
            automática simples e pendente PODE ser excluída — pela compra de
            origem. Os modos orientativos escondem o botão, e o aviso acima diz
            o que destrava.
          */}
          {showDeleteAction && (
            <Button
              variant="destructive"
              className={DETAIL_ACTION_CLASS}
              onClick={handleDelete}
            >
              <Trash2 className="size-4" />
              Excluir
            </Button>
          )}
        </DetailFooter>}
        </>
      )}
    >
      <DetailAmount label="Valor">
        <span
          className={cn(
            ROW_AMOUNT_CLASS,
            /*
              Recebida perde ênfase; em atraso alerta — o vermelho é o mesmo
              de Dívidas, porque "passou da data" significa a mesma coisa nos
              dois domínios. Pendente fica neutra: verde é conclusão, não
              expectativa.
            */
            receivable.isPaid
              ? ROW_AMOUNT_TONE.muted
              : overdue
                ? ROW_AMOUNT_TONE.out
                : ROW_AMOUNT_TONE.neutral,
          )}
        >
          {formatCurrency(receivable.amount)}
        </span>
      </DetailAmount>

      <DetailList>
        <DetailRow label="Status">
          {receivable.isPaid ? 'Recebido' : overdue ? 'Em atraso' : 'A receber'}
        </DetailRow>
        <DetailRow label="Devedor">{counterparty}</DetailRow>
        <DetailRow label="Lançada em">
          {formatDate(receivable.occurredAt)}
        </DetailRow>
        <DetailRow label="Vencimento">
          {formatDate(receivable.dueDate)}
        </DetailRow>
        {receivable.isPaid && (
          <DetailRow label="Recebido em">
            {receivable.paidAt ? (
              formatDate(accountCivilDayOf(receivable.paidAt, user?.timeZone ?? null))
            ) : (
              <span className="text-muted-foreground">não registrada</span>
            )}
          </DetailRow>
        )}
        <DetailRow label="Origem">
          {isRecurringIncome ? (
            'Renda recorrente'
          ) : purchaseHref ? (
            <Link
              href={purchaseHref}
              className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
            >
              <ShoppingBag className="size-3.5" aria-hidden />
              Compra no cartão
            </Link>
          ) : (
            'Cadastro manual'
          )}
        </DetailRow>
        {receivable.parentId && (
          <DetailRow label="Parcelamento">Parcelada</DetailRow>
        )}
        {receivable.description && (
          <DetailRow label="Descrição" align="start">
            <span className="whitespace-pre-wrap">
              {receivable.description}
            </span>
          </DetailRow>
        )}
      </DetailList>

      {isAutomatic && (
        /*
          A frase antiga dizia que "apagar só a cobrança removeria as duas" —
          descrevia a cascata invertida que a guarda do backend já eliminou.
          Cada motivo agora diz o que é verdade para AQUELE estado.
        */
        <DetailNotice>
          {policy.mode === 'manage-from-source' &&
          receivable.sourceDeleteBlockReason === 'PAID_INVOICE' ? (
            /*
              Trava PERMANENTE: a fatura já foi paga, e excluir a compra
              alteraria o total de algo quitado. Não mandar "abra a compra" —
              lá a exclusão também será recusada.
            */
            <>
              Cobrança gerada por uma compra de uma fatura já paga. A compra de
              origem não pode mais ser excluída.
            </>
          ) : policy.mode === 'manage-from-source' ? (
            <>Cobrança gerada por uma compra parcelada.</>
          ) : policy.mode === 'unmark-first' ? (
            <>Cobrança gerada por uma compra.</>
          ) : (
            <>
              Cobrança gerada por uma compra. Valor, contraparte e datas são
              definidos pela compra de origem.
            </>
          )}
        </DetailNotice>
      )}
    </DetailDrawer>
    {activeDeleteFlow === 'choose-source-action' && isAutomatic && canUnlink && (
      <ReceivableDeleteChoiceDialog
        open
        personName={sourcePerson}
        onClose={() => setDeleteFlow(null)}
        onDeletePurchase={() => openDeleteFlow('delete-source')}
        onUnlink={() => openDeleteFlow('unlink')}
      />
    )}
    {activeDeleteFlow === 'protected-received' && (
      <ReceivedReceivableDeleteDialog
        open
        onClose={() => setDeleteFlow(null)}
        onUndoReceipt={onToggleReceived ? () => {
          setDeleteFlow(null)
          onToggleReceived(receivable)
        } : undefined}
      />
    )}
    {activeDeleteFlow === 'delete-recurring-received' && (
      <ReceivedRecurringIncomeDeleteDialog
        open
        onClose={() => setDeleteFlow(null)}
        onConfirm={async () => {
          await onDeleteRecurringReceived?.(receivable)
          setDeleteFlow(null)
        }}
      />
    )}
    {activeDeleteFlow === 'unlink' && canUnlink && <ReceivableUnlinkDialog
      receivable={receivable}
      open
      onClose={() => setDeleteFlow(null)}
      onSuccess={() => onOpenChange(false)}
    />}
    {activeDeleteFlow === 'delete-source' && isAutomatic && mode === 'operational' && <SourceTransactionDeleteDialog
      receivable={receivable}
      open
      onClose={() => setDeleteFlow(null)}
      onSuccess={() => onOpenChange(false)}
    />}
    </>
  )
}

function ReceivableDeleteChoiceDialog({
  open,
  personName,
  onClose,
  onDeletePurchase,
  onUnlink,
}: {
  open: boolean
  personName: string
  onClose: () => void
  onDeletePurchase: () => void
  onUnlink: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={DIALOG_ROOMY_CLASS}>
        <DialogHeader>
          <DialogTitle>Excluir cobrança?</DialogTitle>
          <DialogDescription>O que você quer fazer com a compra de origem?</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-2">
          <button
            type="button"
            className="flex min-w-0 items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={onDeletePurchase}
          >
            <ShoppingBag className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium">Excluir compra</span>
              <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                Remove a compra e as cobranças correspondentes que puderem ser excluídas.
              </span>
            </span>
          </button>
          <button
            type="button"
            className="flex min-w-0 items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={onUnlink}
          >
            <UserRoundMinus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block break-words text-sm font-medium">Manter compra e desvincular de {personName}</span>
              <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                Remove esta cobrança, mantém a compra e passa os valores elegíveis para seus gastos.
              </span>
            </span>
          </button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReceivedReceivableDeleteDialog({
  open,
  onClose,
  onUndoReceipt,
}: {
  open: boolean
  onClose: () => void
  onUndoReceipt?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={DIALOG_ROOMY_CLASS}>
        <DialogHeader>
          <DialogTitle>Não é possível excluir ainda</DialogTitle>
          <DialogDescription>{'Este valor j\u00e1 foi recebido. Desfa\u00e7a o recebimento antes de excluir ou desvincular a compra.'}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {onUndoReceipt && <Button onClick={onUndoReceipt}>Desfazer recebimento</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReceivedRecurringIncomeDeleteDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const busy = submitting

  const confirm = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm()
    } catch (cause) {
      setError(apiErrorMessage(cause, 'Não foi possível desfazer o recebimento e excluir a cobrança.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className={DIALOG_ROOMY_CLASS}>
        <DialogHeader>
          <DialogTitle>Excluir recebimento?</DialogTitle>
          <DialogDescription>
            Este recebimento já foi registrado. Ao continuar, o lançamento financeiro do recebimento e esta cobrança serão removidos.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Fechar</Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Desfazer recebimento e excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
