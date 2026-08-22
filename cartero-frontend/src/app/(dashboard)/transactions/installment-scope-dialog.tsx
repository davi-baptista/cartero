'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2, Lock } from 'lucide-react'
import { InstallmentScope, type Transaction } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/formatters'
import { installmentPosition, selectSeries } from '@/lib/installment-series'
import {
  previewUpdateTransaction,
  type PreviewUpdatePayload,
  type TransactionUpdatePreview,
} from '@/services/transactions.service'

/**
 * Escopo + impacto + confirmação de uma ação sobre parcelamento, em UM diálogo.
 *
 * Antes eram três momentos desconectados: escolher o escopo às cegas ("Afeta
 * todas as parcelas da série" — quantas?), salvar, e só então descobrir que a
 * operação exigia confirmação, num segundo diálogo que abria sobre o primeiro.
 * Quem editava não sabia o que estava aceitando até depois de aceitar.
 *
 * Aqui o escopo é escolhido com a contagem real ao lado, o impacto financeiro
 * vem do servidor (mesma fonte que o save vai usar, então a projeção não pode
 * divergir), e o que exige aceite é resolvido antes de confirmar. Nada empilha.
 *
 * Na exclusão não há prévia de servidor: o alcance é derivado das parcelas já
 * carregadas, com `selectSeries` — a mesma identidade de série que o backend
 * usa. Quando a lista não tem a série completa, o número é apresentado como
 * piso, nunca como total.
 */

interface InstallmentScopeDialogProps {
  open: boolean
  mode: 'edit' | 'delete'
  /**
   * Transação de onde a ação partiu — pode ser qualquer parcela.
   *
   * Opcional porque Dívidas, A Receber, Pessoas e Faturas reusam este diálogo
   * para séries que não são de transações. Sem ela, o diálogo funciona no modo
   * simples: escolhe o escopo, sem contagem nem impacto — o que essas telas já
   * faziam. A projeção exige uma transação e a série carregada.
   */
  transaction?: Transaction | null
  /** Transações carregadas, para derivar a série no cliente. */
  siblings?: Transaction[]
  /**
   * Alterações pendentes, quando a edição já foi preenchida no formulário.
   * Presentes → a prévia projeta o impacto real; ausentes → o diálogo só
   * escolhe o escopo antes de abrir o formulário.
   */
  pendingChanges?: PreviewUpdatePayload | null
  isPending?: boolean
  onConfirm: (scope: InstallmentScope, confirmClosedInvoice: boolean) => void
  onCancel: () => void
  /** A série tem cobranças de terceiros vinculadas. */
  linkedWarning?: boolean
}

const OPTIONS: {
  scope: InstallmentScope
  label: string
  /** Rótulo com a contagem real, quando a série é conhecida. */
  hint: (count: number, position: number | null) => string
  /** Rótulo genérico, para as telas que não carregam a série. */
  fallbackHint: string
}[] = [
  {
    scope: InstallmentScope.ONE,
    label: 'Apenas esta',
    hint: (_, position) =>
      position ? `Somente a parcela ${position}` : 'Somente esta parcela',
    fallbackHint: 'Afeta somente esta parcela',
  },
  {
    scope: InstallmentScope.NEXT,
    label: 'Esta e as próximas',
    hint: (count) => `${count} ${count === 1 ? 'parcela' : 'parcelas'}`,
    fallbackHint: 'Afeta esta e todas as próximas parcelas',
  },
  {
    scope: InstallmentScope.ALL,
    label: 'Todas as parcelas',
    hint: (count) =>
      `A série inteira · ${count} ${count === 1 ? 'parcela' : 'parcelas'}`,
    fallbackHint: 'Afeta todas as parcelas da série',
  },
]

export function InstallmentScopeDialog({
  open,
  mode,
  transaction = null,
  siblings = [],
  pendingChanges,
  isPending = false,
  onConfirm,
  onCancel,
  linkedWarning,
}: InstallmentScopeDialogProps) {
  const [scope, setScope] = useState<InstallmentScope>(InstallmentScope.ONE)
  /**
   * O aceite é guardado junto com o escopo e o motivo que o pediu.
   *
   * Guardar só um booleano exigia um efeito para limpá-lo a cada troca de
   * escopo — e um aceite que sobrevive à mudança do que está sendo aceito é
   * pior que inconveniente. Amarrando-o ao contexto, ele deixa de valer
   * sozinho quando o contexto muda, sem efeito nenhum.
   */
  const [accepted, setAccepted] = useState<{
    scope: InstallmentScope
    code: string
  } | null>(null)

  const isEdit = mode === 'edit'
  const wantsPreview = isEdit && Boolean(pendingChanges) && Boolean(transaction)

  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: ['transaction-update-preview', transaction?.id, pendingChanges, scope],
    queryFn: () =>
      previewUpdateTransaction(transaction!.id, {
        ...pendingChanges!,
        scope,
      }),
    enabled: open && wantsPreview,
    // Mantém o impacto anterior visível enquanto o novo escopo carrega, para o
    // painel não piscar entre cada troca de opção.
    placeholderData: (previous) => previous,
  })

  // O escopo pode ser imposto pela regra (mudar a data move a compra inteira).
  const forcedScope = preview?.scopeForced ? preview.scope : null
  const effectiveScope = forcedScope ?? scope

  const local = transaction
    ? selectSeries(transaction, siblings, effectiveScope)
    : null

  const blocked = preview?.blocked ?? null
  const confirmationNeeded = preview?.requiresConfirmation ?? null
  // Só vale o aceite dado para este escopo e este motivo.
  const acceptClosed =
    confirmationNeeded !== null &&
    accepted?.scope === effectiveScope &&
    accepted?.code === confirmationNeeded.code
  const canConfirm =
    !isPending && !blocked && (confirmationNeeded === null || acceptClosed)

  const verb = isEdit ? 'editar' : 'excluir'
  const position = transaction ? installmentPosition(transaction) : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isPending) onCancel()
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Editar compra parcelada' : 'Excluir compra parcelada'}
          </DialogTitle>
          <DialogDescription>
            {forcedScope
              ? 'A data pertence à compra inteira, então esta alteração vale para todas as parcelas.'
              : `O que você quer ${verb}?`}
          </DialogDescription>
        </DialogHeader>

        {/* Escopo forçado é informação, não escolha: mostrar três botões dos
            quais dois não fazem nada seria mentir sobre o controle. */}
        {forcedScope ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="text-sm">
              <p className="font-medium">Todas as parcelas</p>
              <p className="text-xs text-muted-foreground">
                Mudar a data recalcula a fatura de cada parcela.
              </p>
            </div>
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-label={`Alcance da ${isEdit ? 'edição' : 'exclusão'}`}
            className="flex flex-col gap-2 py-1"
          >
            {OPTIONS.map((option) => {
              // Sem transação (Dívidas, A Receber…) não há série para contar:
              // a opção mostra só o rótulo, como antes.
              const projection = transaction
                ? selectSeries(transaction, siblings, option.scope)
                : null
              const selected = scope === option.scope
              const destructive = !isEdit && option.scope !== InstallmentScope.ONE

              return (
                <button
                  key={option.scope}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={isPending}
                  onClick={() => setScope(option.scope)}
                  className={cn(
                    'flex flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/10'
                      : destructive
                        ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
                        : 'border-border hover:bg-muted',
                    isPending && 'pointer-events-none opacity-50',
                  )}
                >
                  <span className="flex w-full items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{option.label}</span>
                    {projection && (
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {formatCurrency(projection.affectedTotal)}
                        {projection.partial && '+'}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {projection
                      ? option.hint(projection.affected.length, position)
                      : option.fallbackHint}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {local ? (
          <ImpactPanel
            mode={mode}
            preview={preview}
            isLoading={previewLoading && !preview}
            affectedCount={local.affected.length}
            affectedTotal={local.affectedTotal}
            partial={local.partial}
            declaredCount={local.declaredCount}
            linkedWarning={Boolean(linkedWarning)}
          />
        ) : (
          // Sem série carregada resta o aviso qualitativo que já existia.
          mode === 'delete' &&
          linkedWarning && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive/90">
              As cobranças vinculadas às parcelas selecionadas também serão
              excluídas.
            </p>
          )
        )}

        {blocked && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {blocked.message}
          </p>
        )}

        {/* O aceite vive aqui dentro. Antes ele era um segundo diálogo que só
            aparecia depois do save falhar. */}
        {!blocked && confirmationNeeded && (
          <button
            type="button"
            role="checkbox"
            aria-checked={acceptClosed}
            disabled={isPending}
            onClick={() =>
              setAccepted(
                acceptClosed
                  ? null
                  : { scope: effectiveScope, code: confirmationNeeded.code },
              )
            }
            className={cn(
              'flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
              acceptClosed
                ? 'border-pending bg-pending/15'
                : 'border-pending/40 bg-pending/10 hover:bg-pending/15',
              isPending && 'pointer-events-none opacity-50',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                acceptClosed
                  ? 'border-pending bg-pending text-background'
                  : 'border-muted-foreground/50',
              )}
            >
              {acceptClosed && <Check className="size-3" strokeWidth={3} />}
            </span>
            <span className="text-xs text-foreground">
              {confirmationNeeded.message}
            </span>
          </button>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant={isEdit ? 'default' : 'destructive'}
            disabled={!canConfirm}
            onClick={() => onConfirm(effectiveScope, acceptClosed)}
          >
            {isPending && <Loader2 className="size-3.5 animate-spin" />}
            {isEdit ? 'Continuar' : 'Excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * O que muda, em dinheiro e em fatura.
 *
 * Na edição os números vêm do servidor. Na exclusão vêm da série carregada —
 * e quando ela está incompleta o valor é rotulado como mínimo, porque
 * apresentar a soma parcial como total subestimaria o estrago.
 */
function ImpactPanel({
  mode,
  preview,
  isLoading,
  affectedCount,
  affectedTotal,
  partial,
  declaredCount,
  linkedWarning,
}: {
  mode: 'edit' | 'delete'
  preview: TransactionUpdatePreview | undefined
  isLoading: boolean
  affectedCount: number
  affectedTotal: number
  partial: boolean
  declaredCount: number | null
  linkedWarning: boolean
}) {
  if (isLoading) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Calculando o impacto…
      </p>
    )
  }

  const count = preview?.affectedCount ?? affectedCount
  const total = preview?.affectedTotal?.after ?? affectedTotal

  // Edição só de texto não tem impacto financeiro a mostrar.
  if (preview?.descriptiveOnly) {
    return (
      <p className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
        Altera apenas texto em {count}{' '}
        {count === 1 ? 'parcela' : 'parcelas'} — nenhum valor ou fatura muda.
      </p>
    )
  }

  const invoiceMoves = preview?.invoiceChanges.filter(
    (change) =>
      change.to &&
      (!change.from ||
        change.from.month !== change.to.month ||
        change.from.year !== change.to.year),
  ).length

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs">
      <p className="flex items-baseline justify-between gap-2 text-foreground">
        <span>
          {mode === 'delete' ? 'Será excluído' : 'Será alterado'}
          {declaredCount !== null && ` · ${count} de ${declaredCount}`}
        </span>
        <span className="tabular-nums font-medium">
          {partial && !preview ? 'no mínimo ' : ''}
          {formatCurrency(total)}
        </span>
      </p>

      {preview?.amountPerInstallment && (
        <p className="text-muted-foreground">
          Valor por parcela:{' '}
          <span className="tabular-nums line-through">
            {formatCurrency(preview.amountPerInstallment.before)}
          </span>{' '}
          →{' '}
          <span className="tabular-nums text-foreground">
            {formatCurrency(preview.amountPerInstallment.after)}
          </span>
        </p>
      )}

      {preview?.seriesTotal && (
        <p className="text-muted-foreground">
          Total da compra:{' '}
          <span className="tabular-nums line-through">
            {formatCurrency(preview.seriesTotal.before)}
          </span>{' '}
          →{' '}
          <span className="tabular-nums text-foreground">
            {formatCurrency(preview.seriesTotal.after)}
          </span>
        </p>
      )}

      {Boolean(invoiceMoves) && (
        <p className="text-pending">
          {invoiceMoves === 1
            ? '1 parcela muda de fatura'
            : `${invoiceMoves} parcelas mudam de fatura`}
        </p>
      )}

      {preview?.person && <PersonImpact person={preview.person} />}

      {/* Na exclusão o backend não projeta cobranças; o aviso é qualitativo. */}
      {mode === 'delete' && linkedWarning && (
        <p className="text-destructive/90">
          As cobranças vinculadas a estas parcelas também serão excluídas.
        </p>
      )}

      {partial && !preview && (
        <p className="text-muted-foreground">
          Parcelas fora do período filtrado também podem ser afetadas.
        </p>
      )}
    </div>
  )
}

function PersonImpact({
  person,
}: {
  person: NonNullable<TransactionUpdatePreview['person']>
}) {
  const parts: string[] = []
  if (person.receivablesCreated > 0) {
    parts.push(
      `${person.receivablesCreated} ${person.receivablesCreated === 1 ? 'cobrança criada' : 'cobranças criadas'}`,
    )
  }
  if (person.receivablesUpdated > 0) {
    parts.push(
      `${person.receivablesUpdated} ${person.receivablesUpdated === 1 ? 'cobrança atualizada' : 'cobranças atualizadas'}`,
    )
  }
  if (person.receivablesRemoved > 0) {
    parts.push(
      `${person.receivablesRemoved} ${person.receivablesRemoved === 1 ? 'cobrança removida' : 'cobranças removidas'}`,
    )
  }

  const transition = person.after
    ? `Passa a ser compra para ${person.after.name}`
    : person.before
      ? `Deixa de ser compra para ${person.before.name}`
      : null

  if (!transition && parts.length === 0) return null

  return (
    <p className="text-receivable">
      {transition}
      {parts.length > 0 && ` · ${parts.join(' · ')}`}
    </p>
  )
}
