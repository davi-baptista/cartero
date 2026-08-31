'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DIALOG_ROOMY_CLASS } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  previewDeleteTransaction,
  type TransactionDeletePreview,
} from '@/services/transactions.service'
import {
  deleteSummaryLine,
  preservationLines,
  receivablesLine,
  seriesDisappears,
} from '@/lib/installment-delete-copy'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Excluir as parcelas em aberto de uma compra parcelada
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Substitui a escolha "esta / próximas / todas" no DELETE. Aquela pergunta
 * assumia que o usuário sabia quais parcelas ainda podiam sair — e ele não
 * sabia: escolher "todas" numa série com histórico pago levava a um 403 dentro
 * do diálogo, sem dizer qual opção teria funcionado.
 *
 * Aqui a operação é uma só, e o servidor diz de antemão o que ela fará.
 *
 * ── Por que não reusar `InstallmentScopeDialog` ──
 *
 * Aquele componente já serve quatro domínios com props opcionais e um
 * `mode: 'edit' | 'delete'`. Somar a ele um segundo preview — com estados de
 * carregamento, conjunto obsoleto e "nada a excluir" — significaria mais cinco
 * ramos num arquivo que Dívidas, A Receber e Faturas também usam. Ele
 * continua responsável pelo ESCOPO da edição; a exclusão de parcelas saiu.
 *
 * ── O cliente não decide nada ──
 *
 * Nenhum `invoice.status === 'PAID'` aqui. A prévia vem pronta do servidor, e
 * a confirmação devolve os ids exatos que foram mostrados.
 */

export interface InstallmentDeleteDialogProps {
  open: boolean
  /** A parcela de onde a ação partiu — a série inteira é derivada dela. */
  transactionId: string | null
  isPending?: boolean
  /** Recebe os ids exibidos; quem chama executa e trata o resultado. */
  onConfirm: (expectedDeletableIds: string[]) => void
  onCancel: () => void
  /**
   * Prévia recalculada pelo servidor quando o conjunto mudou entre a
   * confirmação e a execução. Substitui a exibida e exige nova confirmação.
   */
  refreshedPreview?: TransactionDeletePreview | null
  /** Falha da execução, mostrada sem fechar o diálogo. */
  executionError?: string | null
}

export function InstallmentDeleteDialog({
  open,
  transactionId,
  isPending = false,
  onConfirm,
  onCancel,
  refreshedPreview = null,
  executionError = null,
}: InstallmentDeleteDialogProps) {
  /*
    A prévia é da TAREFA, não um dado global: cada abertura pergunta de novo.
    `staleTime: 0` e a chave por transação evitam o pior caso — mostrar o
    impacto de uma série ao excluir outra.
  */
  const {
    data: fetched,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['transaction-delete-preview', transactionId],
    queryFn: () => previewDeleteTransaction(transactionId as string),
    enabled: open && Boolean(transactionId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  /*
    Quando o servidor devolve uma prévia atualizada, ela passa a valer — e o
    usuário precisa confirmar de novo, agora sabendo o que mudou.

    O aviso é DERIVADO da presença dessa prévia, não guardado num state
    sincronizado por efeito: um `useEffect` que chama `setState` é estado
    derivado disfarçado, e o projeto já rejeita esse padrão em outros
    diálogos. Ele some quando o pai limpa `refreshedPreview` — no cancelar,
    no sucesso, ou ao reabrir.
  */
  const preview = refreshedPreview ?? fetched ?? null
  const conjuntoMudou = refreshedPreview !== null

  const carregando = isLoading || (isFetching && !preview)
  const nadaAExcluir = Boolean(preview) && preview!.deletableCount === 0
  const podeConfirmar =
    Boolean(preview) && !nadaAExcluir && !isPending && !carregando

  return (
    <Dialog open={open} onOpenChange={(aberto) => !aberto && onCancel()}>
      <DialogContent showCloseButton={false} className={DIALOG_ROOMY_CLASS}>
        <DialogHeader>
          <DialogTitle>
            {nadaAExcluir
              ? 'Nada a excluir nesta compra'
              : 'Excluir parcelas em aberto?'}
          </DialogTitle>

          <DialogDescription>
            <span className="block space-y-2 text-sm">
              {carregando && (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Verificando o que pode ser excluído…
                </span>
              )}

              {isError && !preview && (
                <span className="flex items-start gap-2 text-destructive">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  Não foi possível verificar as parcelas desta compra.
                </span>
              )}

              {preview && nadaAExcluir && (
                <>
                  <span className="block text-foreground">
                    Não há parcelas em aberto que possam ser excluídas.
                  </span>
                  {preservationLines(preview).map((linha) => (
                    <span key={linha} className="block text-muted-foreground">
                      {linha}
                    </span>
                  ))}
                </>
              )}

              {preview && !nadaAExcluir && (
                <>
                  <span className="block text-foreground">
                    {deleteSummaryLine(preview)}
                  </span>

                  {preservationLines(preview).map((linha) => (
                    <span key={linha} className="block text-muted-foreground">
                      {linha}
                    </span>
                  ))}

                  {receivablesLine(preview) && (
                    <span className="block text-muted-foreground">
                      {receivablesLine(preview)}
                    </span>
                  )}

                  {seriesDisappears(preview) && (
                    <span className="block text-muted-foreground">
                      A compra parcelada deixará de aparecer após a exclusão.
                    </span>
                  )}

                  <span className="block text-muted-foreground">
                    Esta ação não pode ser desfeita.
                  </span>
                </>
              )}

              {conjuntoMudou && (
                <span className="block text-pending">
                  A situação das parcelas mudou. Revise os dados antes de
                  confirmar novamente.
                </span>
              )}

              {executionError && (
                <span className="flex items-start gap-2 text-destructive">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  {executionError}
                </span>
              )}
            </span>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            {nadaAExcluir ? 'Fechar' : 'Cancelar'}
          </Button>

          {isError && !preview && (
            <Button variant="outline" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          )}

          {/*
            Sem parcela deletável não há botão destrutivo: oferecê-lo seria
            oferecer uma requisição que o servidor já recusaria.
          */}
          {!nadaAExcluir && (
            <Button
              variant="destructive"
              disabled={!podeConfirmar}
              onClick={() => {
                onConfirm(preview!.deletable.map((item) => item.id))
              }}
            >
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Excluir parcelas em aberto
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
