'use client'

import { Pencil, Trash2, CalendarDays, Check, Undo2 } from 'lucide-react'
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
import {
  canEditSettlementDate,
  settlementDateActionLabel,
} from '@/lib/settlement-date-action'
import { settlementStatus } from '@/lib/settlement-status'
import { cn } from '@/lib/utils'
import type { Debt } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Detalhe da dívida
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A row deixou de expor Editar/Excluir no hover e virou navegação: ela
 * identifica, e o detalhe administra. Antes as ações viviam em DUAS
 * implementações — ícones no hover do desktop e um `DropdownMenu` no mobile —
 * que precisavam ser mantidas em paralelo.
 *
 * Este componente não decide permissão. Ele recebe os MESMOS handlers que a
 * lista já usava, e cada um mantém a guarda que sempre teve: `handleDelete`
 * continua roteando para o aviso de vínculo, o formulário continua com suas
 * restrições, e o backend continua sendo a autoridade final
 * (`PAID_DEBT_EDIT_BLOCKED`). Mover o botão de lugar não move a regra.
 */
export function DebtDetailDrawer({
  debt,
  onOpenChange,
  onEdit,
  onDelete,
  onTogglePaid,
  onEditSettlementDate,
}: {
  /** `null` mantém o drawer fechado. */
  debt: Debt | null
  onOpenChange: (open: boolean) => void
  onEdit: (debt: Debt) => void
  onDelete: (debt: Debt) => void
  onTogglePaid: (debt: Debt) => void
  onEditSettlementDate?: (debt: Debt) => void
}) {
  if (!debt) return null

  const status = settlementStatus(debt)
  const overdue = status === 'overdue'
  const counterparty = debt.person?.name ?? debt.creditorName

  return (
    <DetailDrawer
      open
      onOpenChange={onOpenChange}
      title={debt.title}
      description={`Dívida · vence em ${formatDate(debt.dueDate)}`}
      footer={
        <>
          {/*
            Marcar/desmarcar era a ação do ícone de status na row — que saiu
            junto com o resto. Ela reaparece aqui, antes das administrativas:
            é a que o usuário mais usa.
          */}
        <DetailFooter className={DETAIL_ACTION_STACK_CLASS}>
          <Button
            variant="outline"
            className={DETAIL_ACTION_CLASS}
            onClick={() => onTogglePaid(debt)}
          >
            {debt.isPaid ? (
              <Undo2 className="size-4" />
            ) : (
              <Check className="size-4" />
            )}
            {debt.isPaid ? 'Marcar como pendente' : 'Marcar como paga'}
          </Button>
          {canEditSettlementDate(debt) && onEditSettlementDate && (
            <Button
              variant="outline"
              className={DETAIL_ACTION_CLASS}
              onClick={() => onEditSettlementDate(debt)}
            >
              <CalendarDays className="size-4" />
              {settlementDateActionLabel('debt')}
            </Button>
          )}
        </DetailFooter>

        <DetailFooter className="border-t-0 pt-0">
          <Button
            variant="outline"
            className={DETAIL_ACTION_CLASS}
            onClick={() => onEdit(debt)}
          >
            <Pencil className="size-4" />
            Editar
          </Button>
          <Button
            variant="destructive"
            className={DETAIL_ACTION_CLASS}
            onClick={() => onDelete(debt)}
          >
            <Trash2 className="size-4" />
            Excluir
          </Button>
        </DetailFooter>
        </>
      }
    >
      <DetailAmount label="Valor">
        <span
          className={cn(
            ROW_AMOUNT_CLASS,
            /*
              Mesma semântica de cor da lista: quitada perde ênfase, em atraso
              alerta, pendente fica neutra. A cor não muda de significado
              entre a row e o detalhe.
            */
            debt.isPaid
              ? ROW_AMOUNT_TONE.muted
              : overdue
                ? ROW_AMOUNT_TONE.out
                : ROW_AMOUNT_TONE.neutral,
          )}
        >
          {formatCurrency(debt.amount)}
        </span>
      </DetailAmount>

      <DetailList>
        <DetailRow label="Status">
          {debt.isPaid ? 'Paga' : overdue ? 'Em atraso' : 'A pagar'}
        </DetailRow>
        <DetailRow label="Credor">{counterparty}</DetailRow>
        <DetailRow label="Lançada em">{formatDate(debt.occurredAt)}</DetailRow>
        <DetailRow label="Vencimento">{formatDate(debt.dueDate)}</DetailRow>
        {debt.isPaid && (
          /*
            Legado pago sem `paidAt` existe, e é exatamente o caso que a
            correção de data resolve — dizer "não registrada" é honesto;
            inventar uma data não seria.
          */
          <DetailRow label="Paga em">
            {debt.paidAt ? (
              formatDate(debt.paidAt)
            ) : (
              <span className="text-muted-foreground">não registrada</span>
            )}
          </DetailRow>
        )}
        {debt.parentId && <DetailRow label="Parcelamento">Parcelada</DetailRow>}
        {!debt.isAlertEnabled && (
          <DetailRow label="Alerta">Desativado</DetailRow>
        )}
        {debt.description && (
          <DetailRow label="Descrição" align="start">
            <span className="whitespace-pre-wrap">{debt.description}</span>
          </DetailRow>
        )}
      </DetailList>

      {debt.paymentTransactionId && (
        <DetailNotice>
          O pagamento gerou uma transação vinculada. Desmarcar a dívida
          exclui essa transação, junto com a data original do pagamento.
        </DetailNotice>
      )}

    </DetailDrawer>
  )
}
