'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryError } from '@/components/ui/query-error'
import { CurrencyInput } from '@/components/ui/currency-input'
import { formatCurrency, formatMonthYear } from '@/lib/formatters'
import { apiErrorMessage } from '@/lib/api-error'
import {
  getSalaryHistory,
  updateSalaryAmount,
  type SalaryHistoryEntry,
} from '@/services/salary.service'
import { propagationNotice, sortedHistory } from '@/lib/salary-history-view'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Histórico salarial — listar e corrigir
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Existe para um caso concreto: "cadastrei meu salário de janeiro errado".
 * Não é uma tela administrativa de timeline — não há criação nem exclusão
 * aqui; criar continua sendo o fluxo de "Definir renda".
 *
 * Lista apenas as alterações REAIS. Meses herdados não viram linha: eles não
 * existem como registro, e exibi-los sugeriria que cada mês tem valor próprio
 * e que editar um deles significa algo que o modelo não suporta.
 */
interface SalaryHistorySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SalaryHistorySheet({
  open,
  onOpenChange,
}: SalaryHistorySheetProps) {
  const [editing, setEditing] = useState<SalaryHistoryEntry | null>(null)

  const historyQuery = useQuery({
    queryKey: ['salary-history'],
    queryFn: getSalaryHistory,
    enabled: open,
  })

  const entries = historyQuery.data ? sortedHistory(historyQuery.data) : []

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setEditing(null)
      }}
    >
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader className="shrink-0">
          <SheetTitle>Histórico salarial</SheetTitle>
          <SheetDescription>
            Cada registro é uma alteração que vale a partir daquele mês, até a
            próxima. Meses sem alteração herdam o valor anterior.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {historyQuery.isLoading && (
            <div className="flex flex-col gap-2 pt-2">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          )}

          {historyQuery.isError && (
            <QueryError
              message="Não foi possível carregar o histórico."
              onRetry={() => void historyQuery.refetch()}
            />
          )}

          {historyQuery.isSuccess && entries.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma renda registrada ainda.
            </p>
          )}

          {historyQuery.isSuccess && entries.length > 0 && (
            <ul className="divide-y divide-border/60 rounded-xl border border-border">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {formatMonthYear(entry.month, entry.year)}
                    </p>
                    <p className="text-[13px] tabular-nums text-muted-foreground">
                      {formatCurrency(entry.amount)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => setEditing(entry)}
                    aria-label={`Editar renda de ${formatMonthYear(
                      entry.month,
                      entry.year,
                    )}`}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    Editar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {editing && (
          <EditSalaryEntryDialog
            entry={editing}
            history={entries}
            onClose={() => setEditing(null)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

/**
 * Corrige o valor de uma competência.
 *
 * A competência é somente leitura: o usuário está corrigindo o VALOR daquele
 * registro. Transformar janeiro em fevereiro é outra intenção — mover uma
 * alteração no tempo — com outro efeito sobre a herança.
 */
function EditSalaryEntryDialog({
  entry,
  history,
  onClose,
}: {
  entry: SalaryHistoryEntry
  history: readonly SalaryHistoryEntry[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState(entry.amount)

  const mutation = useMutation({
    mutationFn: () =>
      updateSalaryAmount({
        year: entry.year,
        month: entry.month,
        amount,
      }),
    onSuccess: async () => {
      /*
        Invalidação restrita ao que realmente depende de SalaryHistory.

        `budget` porque a renda é resolvida por competência — corrigir janeiro
        muda a sobra de janeiro, fevereiro e março. `salary` e `me` porque o
        perfil lê a renda vigente e o cache `User.salary`.

        Transactions, Invoices, Debts e Receivables não entram: nenhum deles
        consulta salário.
      */
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['salary-history'] }),
        qc.invalidateQueries({ queryKey: ['salary'] }),
        qc.invalidateQueries({ queryKey: ['budget'] }),
        qc.invalidateQueries({ queryKey: ['me'] }),
      ])
      toast.success('Renda atualizada')
      onClose()
    },
    /*
      O diálogo permanece ABERTO no erro, com o valor digitado preservado:
      fechar como se tivesse dado certo faria o usuário acreditar numa
      correção que não aconteceu.
    */
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao atualizar a renda')),
  })

  const competenceLabel = formatMonthYear(entry.month, entry.year)

  return (
    <div className="shrink-0 border-t border-border bg-muted/20 px-4 py-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] font-medium">Editar {competenceLabel}</p>

        <Label htmlFor="salary-history-amount" className="mt-1">
          Renda mensal
        </Label>
        <CurrencyInput
          id="salary-history-amount"
          value={amount}
          onChange={setAmount}
          disabled={mutation.isPending}
        />

        {/*
          O intervalo afetado, calculado a partir da PRÓXIMA alteração real.
          Sem isto o usuário corrige janeiro sem saber que muda fev e mar.
        */}
        <p className="text-xs text-muted-foreground">
          {propagationNotice(entry, history)}
        </p>
      </div>

      <SheetFooter className="mt-3 flex-row justify-end gap-2 px-0">
        <Button
          variant="outline"
          size="sm"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || amount === entry.amount}
        >
          {mutation.isPending && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          Salvar
        </Button>
      </SheetFooter>
    </div>
  )
}
