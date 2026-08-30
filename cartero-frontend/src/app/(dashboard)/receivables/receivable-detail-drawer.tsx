'use client'

import Link from 'next/link'
import { Pencil, Trash2, CalendarDays, Check, Undo2, ShoppingBag } from 'lucide-react'
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
import type { Receivable } from '@/types'

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
 * Por isso a automática NÃO recebe o botão Excluir, e o Editar abre o mesmo
 * formulário de sempre — que já desabilita os campos financeiros
 * (`financialLocked`) e permanece útil para título e descrição.
 *
 * Nada disso é regra nova: é a regra que já existia, agora visível em vez de
 * descoberta ao esbarrar num aviso.
 */
export function ReceivableDetailDrawer({
  receivable,
  onOpenChange,
  onEdit,
  onDelete,
  onToggleReceived,
  onEditSettlementDate,
}: {
  /** `null` mantém o drawer fechado. */
  receivable: Receivable | null
  onOpenChange: (open: boolean) => void
  onEdit: (receivable: Receivable) => void
  onDelete: (receivable: Receivable) => void
  onToggleReceived: (receivable: Receivable) => void
  onEditSettlementDate?: (receivable: Receivable) => void
}) {
  if (!receivable) return null

  const status = settlementStatus(receivable)
  const overdue = status === 'overdue'
  const isAutomatic = Boolean(receivable.transactionId)
  const counterparty = receivable.person?.name ?? receivable.debtorName

  /** Deep link para a compra de origem, no dia em que ela aconteceu. */
  const purchaseDay = receivable.occurredAt.slice(0, 10)
  const purchaseHref = isAutomatic
    ? `/transactions?startDate=${purchaseDay}&endDate=${purchaseDay}&highlight=${receivable.transactionId}`
    : null

  return (
    <DetailDrawer
      open
      onOpenChange={onOpenChange}
      title={receivable.title}
      description={`Cobrança · vence em ${formatDate(receivable.dueDate)}`}
      footer={
        <>
        <DetailFooter className={DETAIL_ACTION_STACK_CLASS}>
          <Button
            variant="outline"
            className={DETAIL_ACTION_CLASS}
            onClick={() => onToggleReceived(receivable)}
          >
            {receivable.isPaid ? (
              <Undo2 className="size-4" />
            ) : (
              <Check className="size-4" />
            )}
            {receivable.isPaid ? 'Marcar como pendente' : 'Marcar como recebido'}
          </Button>
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
        </DetailFooter>

        <DetailFooter className="border-t-0 pt-0">
          <Button
            variant="outline"
            className={DETAIL_ACTION_CLASS}
            onClick={() => onEdit(receivable)}
          >
            <Pencil className="size-4" />
            Editar
          </Button>
          {/*
            Sem Excluir para a automática: o delete cascatearia para a compra.
            O aviso acima diz onde a exclusão é feita — esconder o botão sem
            explicar deixaria o usuário procurando.
          */}
          {!isAutomatic && (
            <Button
              variant="destructive"
              className={DETAIL_ACTION_CLASS}
              onClick={() => onDelete(receivable)}
            >
              <Trash2 className="size-4" />
              Excluir
            </Button>
          )}
        </DetailFooter>
        </>
      }
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
              formatDate(receivable.paidAt)
            ) : (
              <span className="text-muted-foreground">não registrada</span>
            )}
          </DetailRow>
        )}
        <DetailRow label="Origem">
          {purchaseHref ? (
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
          <DetailRow label="Descrição">
            <span className="whitespace-pre-wrap">
              {receivable.description}
            </span>
          </DetailRow>
        )}
      </DetailList>

      {isAutomatic && (
        <DetailNotice>
          Cobrança gerada por uma compra no cartão. Valor, contraparte e datas
          são definidos pela compra — alterá-los aqui não teria efeito. Excluir
          também é feito pela compra, porque apagar só a cobrança removeria as
          duas.
        </DetailNotice>
      )}
    </DetailDrawer>
  )
}
