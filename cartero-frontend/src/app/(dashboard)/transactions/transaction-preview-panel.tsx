'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { formatCurrency } from '@/lib/formatters'
import { parseDateOnly } from '@/lib/date'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { TransactionPreview } from '@/services/transactions.service'

/**
 * "Como será registrado": as consequências automáticas de salvar.
 *
 * Existe porque uma única compra pode gerar fatura, parcelas e cobranças de
 * terceiro, e nada disso era visível antes de confirmar. Todos os valores vêm
 * do servidor — o cliente não calcula rateio nem vencimento.
 *
 * Só aparece quando há algo a explicar. Um PIX de R$ 50 não gera automação
 * nenhuma, e repetir o formulário aqui seria ruído.
 */

/** "set/2026" a partir da competência. */
function periodLabel(year: number, month: number): string {
  return format(new Date(year, month - 1, 1), "MMM/yyyy", { locale: ptBR })
}

/** "08/09/2026" a partir da data ISO do servidor. */
function dateLabel(iso: string | null): string | null {
  if (!iso) return null
  return format(parseDateOnly(iso), 'dd/MM/yyyy')
}

interface TransactionPreviewPanelProps {
  preview: TransactionPreview | undefined
  isLoading: boolean
  isError: boolean
}

export function TransactionPreviewPanel({
  preview,
  isLoading,
  isError,
}: TransactionPreviewPanelProps) {
  const [showAll, setShowAll] = useState(false)

  // Sem prévia e sem carregamento não há seção — o formulário segue enxuto.
  if (!preview && !isLoading && !isError) return null

  const closedInvoiceCount =
    preview?.installments.filter(
      (installment) => installment.invoice?.status === 'CLOSED',
    ).length ?? 0

  return (
    <section
      aria-label="Como será registrado"
      className="rounded-lg border border-border bg-muted/20 px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Como será registrado
        </h3>
        {isLoading && (
          <Loader2
            className="size-3 animate-spin text-muted-foreground"
            aria-label="Calculando"
          />
        )}
      </div>

      {/* Falha na prévia não interrompe o cadastro: o backend valida no save. */}
      {isError && !preview ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Não foi possível calcular a prévia. Os dados serão validados ao salvar.
        </p>
      ) : preview ? (
        <div className="mt-2 flex flex-col gap-2.5">
          {preview.blocked && (
            <p className="text-xs text-destructive">{preview.blocked.message}</p>
          )}

          {/* Fatura fechada aceita lançamento — o backend só recusa PAID.
              Aviso discreto, sem confirmação extra. */}
          {!preview.blocked && closedInvoiceCount > 0 && (
            <p className="text-xs text-pending">
              {closedInvoiceCount === 1
                ? 'Esta fatura já está fechada. O lançamento será adicionado a ela.'
                : `${closedInvoiceCount} das faturas já estão fechadas. As parcelas serão adicionadas a elas.`}
            </p>
          )}

          {preview.isRefund
            ? <RefundSummary preview={preview} />
            : preview.installmentCount === 1
              ? <SingleSummary preview={preview} />
              : (
                <InstallmentSummary
                  preview={preview}
                  showAll={showAll}
                  onToggle={() => setShowAll((value) => !value)}
                />
              )}

          {preview.receivables && (
            <ReceivablesSummary
              receivables={preview.receivables}
              showAll={showAll}
            />
          )}
        </div>
      ) : null}
    </section>
  )
}

function SingleSummary({ preview }: { preview: TransactionPreview }) {
  const invoice = preview.installments[0]?.invoice
  if (!invoice) return null

  return (
    <div className="text-xs">
      <p className="text-foreground">
        Fatura de{' '}
        <span className="font-medium">
          {periodLabel(invoice.year, invoice.month)}
        </span>
        {' · '}
        <span className="tabular-nums">
          {formatCurrency(preview.installments[0].amount)}
        </span>
      </p>
      {dateLabel(invoice.dueDate) && (
        <p className="mt-0.5 text-muted-foreground">
          Vence em {dateLabel(invoice.dueDate)}
        </p>
      )}
    </div>
  )
}

function RefundSummary({ preview }: { preview: TransactionPreview }) {
  const invoice = preview.installments[0]?.invoice
  return (
    <p className="text-xs text-foreground">
      Reduz em{' '}
      <span className="tabular-nums font-medium">
        {formatCurrency(preview.totalAmount)}
      </span>{' '}
      a fatura
      {invoice && ` de ${periodLabel(invoice.year, invoice.month)}`}.
    </p>
  )
}

/**
 * Parcelamento: primeira e última parcela por padrão.
 *
 * Mostrar 36 linhas dentro do formulário afogaria o resto; quem quiser o
 * cronograma inteiro expande.
 */
function InstallmentSummary({
  preview,
  showAll,
  onToggle,
}: {
  preview: TransactionPreview
  showAll: boolean
  onToggle: () => void
}) {
  const first = preview.installments[0]
  const last = preview.installments[preview.installments.length - 1]

  return (
    <div className="text-xs">
      <p className="text-foreground">
        <span className="font-medium">{preview.installmentCount} parcelas</span>
        {' · '}
        <span className="tabular-nums">
          {formatCurrency(preview.totalAmount)}
        </span>{' '}
        no total
      </p>

      {showAll ? (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {preview.installments.map((installment) => (
            <li
              key={installment.number}
              className="flex justify-between gap-2 text-muted-foreground"
            >
              <span>
                {installment.number}/{installment.of}
                {installment.invoice &&
                  ` · ${periodLabel(installment.invoice.year, installment.invoice.month)}`}
              </span>
              <span className="tabular-nums">
                {formatCurrency(installment.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
          <p>
            1ª: <span className="tabular-nums">{formatCurrency(first.amount)}</span>
            {first.invoice &&
              ` · ${periodLabel(first.invoice.year, first.invoice.month)}`}
          </p>
          <p>
            Última:{' '}
            <span className="tabular-nums">{formatCurrency(last.amount)}</span>
            {last.invoice &&
              ` · ${periodLabel(last.invoice.year, last.invoice.month)}`}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onToggle}
        className="mt-1 text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        {showAll ? 'Ver menos' : `Ver todas as ${preview.installmentCount} parcelas`}
      </button>
    </div>
  )
}

/** O que a outra pessoa vai dever, com o vencimento de cada cobrança. */
function ReceivablesSummary({
  receivables,
  showAll,
}: {
  receivables: NonNullable<TransactionPreview['receivables']>
  showAll: boolean
}) {
  const first = receivables.items[0]
  const last = receivables.items[receivables.items.length - 1]

  return (
    <div className="border-t border-border/60 pt-2 text-xs">
      <p className="text-foreground">
        A receber de{' '}
        <span className="font-medium text-receivable">
          {receivables.personName}
        </span>
        {' · '}
        <span className="tabular-nums text-receivable">
          {formatCurrency(receivables.total)}
        </span>
      </p>

      {receivables.count === 1 ? (
        dateLabel(first.dueDate) && (
          <p className="mt-0.5 text-muted-foreground">
            Vence em {dateLabel(first.dueDate)}
          </p>
        )
      ) : showAll ? (
        <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
          {receivables.items.map((item) => (
            <li key={item.number} className="flex justify-between gap-2">
              <span>
                {item.number}ª · {dateLabel(item.dueDate)}
              </span>
              <span className="tabular-nums">{formatCurrency(item.amount)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-muted-foreground">
          {receivables.count} cobranças · 1ª vence {dateLabel(first.dueDate)},
          última {dateLabel(last.dueDate)}
        </p>
      )}
    </div>
  )
}
