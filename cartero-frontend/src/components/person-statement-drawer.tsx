'use client'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Drawer de acertos com uma pessoa
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Vivia dentro de `persons/page.tsx`, o que obrigava o Orçamento a NAVEGAR
 * para Pessoas só para consultar um detalhe — e o usuário perdia a
 * competência que estava analisando ao fechar.
 *
 * Extraído sem reescrever: o componente já era autocontido (recebe a pessoa e
 * o período inicial, resolve as próprias queries e mutations). As páginas
 * viraram consumidoras; existe UMA implementação, e Pessoas e Orçamento
 * mostram exatamente o mesmo drawer.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import {
  Pencil,
  Trash2,
  Loader2,
  Check,
  Undo2,
  MoreVertical,
  MessageCircle,
  FileText,
  Download,
  Share2,
  TriangleAlert,
  RotateCcw,
  CreditCard,
  CalendarDays,
  Plus,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  monthBounds,
  type MonthPeriod,
} from '@/components/month-nav'
import { MarkAsPaidDialog } from '@/app/(dashboard)/transactions/mark-as-paid-dialog'
import { UnmarkPaidWarningDialog } from '@/app/(dashboard)/transactions/unmark-paid-warning-dialog'
import { InstallmentScopeDialog } from '@/app/(dashboard)/transactions/installment-scope-dialog'
import { DeleteLinkedWarningDialog } from '@/app/(dashboard)/transactions/delete-linked-warning-dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  canDeleteReceivable,
  resolveReceivableDeletePolicy,
} from '@/lib/receivable-delete-policy'
import { useDeleteSourceTransaction } from '@/lib/use-delete-source-transaction'
import { SettlementDateDialog } from '@/app/(dashboard)/transactions/settlement-date-dialog'
import { DebtSheet, type DebtFormData } from '@/app/(dashboard)/debts/debt-sheet'
import {
  ReceivableSheet,
  type ReceivableFormData,
} from '@/app/(dashboard)/receivables/receivable-sheet'
import { SettlePersonDialog } from '@/app/(dashboard)/persons/settle-person-dialog'
import { settlementStatus } from '@/lib/settlement-status'
import { apiErrorMessage } from '@/lib/api-error'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatCurrency, formatDate, formatMonthYear } from '@/lib/formatters'
import { generateStatementPdf, statementPdfFileName } from '@/lib/statement-pdf'
import {
  createDebt,
  updateDebt,
  deleteDebt,
  updateDebtSettlementDate,
} from '@/services/debts.service'
import {
  createReceivable,
  updateReceivable,
  deleteReceivable,
  updateReceivableSettlementDate,
} from '@/services/receivables.service'
import { getPersonStatement, settlePerson } from '@/services/persons.service'
import {
  competenceCard,
  competenceCardSign,
} from '@/lib/person-competence-card'
import { civilDayOf } from '@/lib/date'
import {
  DRAWER_SECTION_INSET,
  DrawerSectionEmpty,
  DrawerSectionHeader,
} from '@/components/ui/drawer-section'
import {
  dueLabel,
  dueContext,
  openItemsFor,
  resolvedLabel,
  summarizeCompetence,
} from '@/lib/person-settlement-view'
import {
  buildWhatsAppMessage,
  normalizeWhatsAppPhone,
} from '@/lib/person-statement'
import { canEditSettlementDate } from '@/lib/settlement-date-action'
import { cn } from '@/lib/utils'
import type { Person, Debt, Receivable } from '@/types'
import { InstallmentScope, TransactionType } from '@/types'
import { useAuth } from '@/providers/auth-provider'

function StatementRow({
  kind,
  item,
  dueLabel: dueLabelText,
  onToggle,
  onEdit,
  onDelete,
  onEditSettlementDate,
}: {
  kind: 'debt' | 'receivable'
  item: Debt | Receivable
  /**
   * Microcopy temporal já resolvida pelo helper.
   *
   * Ausente no histórico, onde o item está resolvido e o vencimento basta.
   */
  dueLabel?: string
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  /** Só em item resolvido: corrige a data real do acerto. */
  onEditSettlementDate?: () => void
}) {
  const status = settlementStatus(item)
  const isReceivable = kind === 'receivable'
  /** Cobrança automática: a compra é a fonte de verdade dos seus valores. */
  const isAutomatic =
    isReceivable && Boolean((item as Receivable).transactionId)

  /*
    Era este o botão sem guarda: cobrança automática oferecia Excluir e o
    backend recusava com 409. Agora quem decide é a mesma policy da página.

    Dívida não passa pelo resolver — ele é de Receivable — e mantém o
    comportamento que já tinha.
  */
  const podeExcluir = isReceivable
    ? canDeleteReceivable(
        resolveReceivableDeletePolicy(item as Receivable),
      )
    : true

  return (
    /*
      O recuo é da ROW, não herdado de um container acima.

      Antes vinha do `px-6` do scroller, e por isso a faixa da seção — que
      precisa ir de ponta a ponta — recebia o mesmo recuo e ficava 48px mais
      estreita que a de Fatura. Com o token aqui, borda e conteúdo ficam
      independentes: a linha divisória atravessa, o texto respira.
    */
    <div
      className={cn(
        DRAWER_SECTION_INSET,
        'flex items-center gap-2.5 border-b border-border py-2.5 last:border-b-0',
      )}
    >
      <ToggleButton
        isPaid={item.isPaid}
        onToggle={onToggle}
        label={
          item.isPaid
            ? 'Marcar como pendente'
            : isReceivable
              ? 'Marcar como recebido'
              : 'Marcar como paga'
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/*
          Primeira linha: só o título.

          A badge "Compra no cartão" vivia aqui e consumia 80–120px, truncando
          nomes cedo demais ("Pinga Cer…", "Financiamento Duster …"). A origem
          é contexto, não identidade — foi para a linha de metadata.
        */}
        {/*
          Resolvido fica MUTED, nunca tachado.

          O `line-through` cortava o nome e o valor, e um item histórico
          precisa continuar legível — a lista existe para ser consultada, não
          só para mostrar que algo acabou. O cinza já diz "isto é passado", e o
          subtítulo diz quando foi resolvido.
        */}
        <span
          className={cn('truncate text-sm', item.isPaid && 'text-muted-foreground')}
        >
          {item.title}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {/*
            Status financeiro + contexto TEMPORAL.

            A lista é all-time, então ela mistura atraso, vencimento de hoje e
            futuro. Sem a dica temporal, um item que vence em setembro ficava
            visualmente indistinguível de um atrasado — e chamá-lo de "Em
            atraso" seria falso.
          */}
          {dueLabelText ? (
            <span
              className={cn(
                status === 'overdue' && 'font-medium text-destructive',
              )}
            >
              {dueLabelText}
            </span>
          ) : (
            formatDate(item.dueDate)
          )}

          {/*
            Origem em forma compacta, sem pill: aqui ela é contexto de baixa
            prioridade. O ícone é decorativo; o texto carrega a informação, e
            o `title` mantém o nome completo para quem precisar.
          */}
          {isAutomatic && (
            <>
              <span className="text-muted-foreground/40" aria-hidden>
                ·
              </span>
              <span
                className="inline-flex shrink-0 items-center gap-1"
                title="Compra no cartão"
              >
                <CreditCard className="size-3" aria-hidden />
                No cartão
              </span>
            </>
          )}
        </span>
      </div>
      {/*
        O valor resolvido também perde o tachado — cortar uma cifra é o pior
        lugar para fazê-lo, porque é o número que se procura primeiro.
      */}
      <span
        className={cn(
          'shrink-0 text-sm font-medium tabular-nums',
          item.isPaid
            ? 'text-muted-foreground'
            : isReceivable
              ? 'text-receivable/80'
              : 'text-destructive',
        )}
      >
        {isReceivable ? '+' : '-'}
        {formatCurrency(item.amount)}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          aria-label={isReceivable ? 'Ações da cobrança' : 'Ações da dívida'}
        >
          <MoreVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/*
            Correção da data de acerto — o Histórico é justamente onde o
            usuário encontra o registro antigo que precisa regularizar.
          */}
          {canEditSettlementDate(item) && onEditSettlementDate && (
            <DropdownMenuItem onClick={onEditSettlementDate}>
              <CalendarDays className="size-3.5" />
              Alterar data do {isReceivable ? 'recebimento' : 'pagamento'}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-3.5" /> Editar
          </DropdownMenuItem>
          {podeExcluir && (
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-3.5" /> Excluir
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ToggleButton({
  isPaid,
  onToggle,
  label,
  disabled = false,
}: {
  isPaid: boolean
  onToggle: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.85 }}
      transition={{ duration: 0.1 }}
      onClick={onToggle}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'group/dot flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md bg-muted/50 ring-1 ring-border/50 transition-colors hover:bg-muted hover:ring-border',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-muted/50 hover:ring-border/50',
      )}
    >
      {isPaid ? (
        <Undo2 className="size-3 text-muted-foreground/50 transition-colors group-hover/dot:text-muted-foreground" />
      ) : (
        <span className="text-muted-foreground/0 group-hover/dot:text-muted-foreground transition-colors">
        <Check className="size-3" />
      </span>
      )}
    </motion.button>
  )
}

export function PersonStatementDrawer({
  person,
  open,
  onClose,
  period,
}: {
  /*
    Só o que o drawer realmente usa. Exigir a `Person` inteira obrigaria o
    Orçamento a inventar `userId`/`createdAt` que ele não tem — e que este
    componente nunca lê.
  */
  person: Pick<Person, 'id' | 'name' | 'phone'> | null
  open: boolean
  onClose: () => void
  /**
   * Competência que o drawer exibe — CONTROLADA pela superfície que o abriu.
   *
   * Era state interno, com seletor próprio dentro do drawer. Isso permitia
   * Pessoas em agosto e o drawer em setembro ao mesmo tempo: dois estados
   * independentes para a mesma pergunta, e nada dizendo ao usuário que ele
   * saiu do mês que estava analisando.
   *
   * Agora a página é a fonte única e o drawer só lê. Ele não escolhe mês,
   * não corrige mês e não procura o mês "mais relevante".
   */
  period: MonthPeriod
}) {
  const qc = useQueryClient()
  const { user } = useAuth()

  const { startDate, endDate } = monthBounds(period)
  const [markPaidDebt, setMarkPaidDebt] = useState<Debt | null>(null)
  const [markReceivedReceivable, setMarkReceivedReceivable] = useState<Receivable | null>(null)
  const [unmarkPaidTarget, setUnmarkPaidTarget] = useState<
    { kind: 'debt'; debt: Debt } | { kind: 'receivable'; receivable: Receivable } | null
  >(null)
  const [settleOpen, setSettleOpen] = useState(false)

  const [sheetKind, setSheetKind] = useState<'debt' | 'receivable' | null>(null)
  const [editDebt, setEditDebt] = useState<Debt | null>(null)
  const [editReceivable, setEditReceivable] = useState<Receivable | null>(null)
  const [editScope, setEditScope] = useState<InstallmentScope | null>(null)
  const [scopeDialog, setScopeDialog] = useState<{
    kind: 'debt' | 'receivable'
    mode: 'edit' | 'delete'
    debt?: Debt
    receivable?: Receivable
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: 'debt' | 'receivable'
    debt?: Debt
    receivable?: Receivable
  } | null>(null)
  /** Cobrança automática cuja COMPRA de origem será excluída. */
  const [sourceDeleteTarget, setSourceDeleteTarget] = useState<Receivable | null>(null)
  const sourceDeleteMut = useDeleteSourceTransaction({
    onSuccess: () => setSourceDeleteTarget(null),
  })

  const [linkedWarningTarget, setLinkedWarningTarget] = useState<{
    kind: 'debt' | 'receivable'
    debt?: Debt
    receivable?: Receivable
  } | null>(null)



  // Havia uma segunda query aqui (`person-statement-all`) com queryFn e
  // parâmetros idênticos — só a chave mudava, o que impedia o dedupe do React
  // Query e disparava duas requisições iguais a cada abertura do extrato.
  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['person-statement', person?.id, startDate, endDate],
    queryFn: () => getPersonStatement(person!.id, { startDate, endDate }),
    enabled: !!person,
  })

  /*
    O resumo e as pendências são ALL-TIME — o período só recorta o histórico.

    Antes tudo vinha filtrado pelo mês e o card dizia "no total": uma dívida
    vencida em junho desaparecia do extrato de agosto, e o "Quitar pendências"
    a deixava aberta em silêncio.
  */
  const summary = data?.summary
  /*
    `pending` (all-time) não é mais lido aqui: o card, a lista e o PDF são
    mensais, e o WhatsApp usa os TOTAIS de `summary`, não as listas.
  */
  /*
    Histórico = universo de PERÍODO. Nome distinto do consolidado de propósito:
    `period.settled*` não pode ser confundido com `pending`.
  */
  const historyDebts = data?.period.settledDebts ?? []
  const historyReceivables = data?.period.settledReceivables ?? []
  /* O mês pode não ter pendência e ainda ter histórico — o PDF vale por ele. */
  const historyItemCount = historyDebts.length + historyReceivables.length

  /*
    `settlement.defaultCompetence` continua vindo do backend, mas NÃO é mais
    aplicado ao período.

    Ele existia para o drawer se reposicionar sozinho ao abrir. Com a
    competência governada pela página, isso viraria exatamente o salto que
    removemos do Orçamento: o usuário escolhe agosto, clica numa pessoa, e a
    tela decide mostrar outro mês.
  */

  async function invalidateStatement() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['person-statement', person?.id] }),
      qc.invalidateQueries({ queryKey: ['debts'] }),
      qc.invalidateQueries({ queryKey: ['receivables'] }),
      qc.invalidateQueries({ queryKey: ['transactions'] }),
      qc.invalidateQueries({ queryKey: ['bank-invoices'] }),
      qc.invalidateQueries({ queryKey: ['budget'] }),
      /*
        A lista de pessoas também mostra saldo — sem isso ela continuaria
        exibindo pendências que a quitação acabou de fechar.

        A lista é deliberada, não um `invalidateQueries()` sem filtro: só os
        agregados que estas ações realmente afetam.
      */
      qc.invalidateQueries({ queryKey: ['persons'] }),
    ])
  }

  /**
   * Item cuja data de acerto está sendo corrigida.
   *
   * Guarda o `kind` junto porque Debt e Receivable usam serviços distintos e
   * a linha resolvida pode ser de qualquer um dos dois.
   */
  const [settlementDateItem, setSettlementDateItem] = useState<
    { kind: 'debt' | 'receivable'; item: Debt | Receivable } | null
  >(null)

  /**
   * Corrige a data real do acerto de um item já resolvido.
   *
   * `invalidateStatement` já cobre person-statement, debts, receivables,
   * transactions, bank-invoices, budget e persons — exatamente as superfícies
   * que mudam quando `paidAt` e a transação-espelho são corrigidos.
   */
  const settlementDateMut = useMutation({
    mutationFn: ({
      kind,
      id,
      paidAt,
    }: {
      kind: 'debt' | 'receivable'
      id: string
      paidAt: string
    }) =>
      /*
        `void` porque o retorno não é usado — Debt e Receivable têm formas
        diferentes, e tipar a união só para descartá-la não ajudaria ninguém.
      */
      kind === 'debt'
        ? updateDebtSettlementDate(id, paidAt).then(() => undefined)
        : updateReceivableSettlementDate(id, paidAt).then(() => undefined),
    onSuccess: () => {
      invalidateStatement()
      setSettlementDateItem(null)
      toast.success('Data atualizada')
    },
    // O diálogo permanece aberto no erro: fechar sugeriria sucesso.
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Não foi possível atualizar a data')),
  })

  const createDebtMut = useMutation({
    mutationFn: createDebt,
    onSuccess: () => {
      invalidateStatement()
      setSheetKind(null)
      toast.success('Dívida criada')
    },
    onError: () => toast.error('Erro ao criar dívida'),
  })

  const createReceivableMut = useMutation({
    mutationFn: createReceivable,
    onSuccess: () => {
      invalidateStatement()
      setSheetKind(null)
      toast.success('Cobrança criada')
    },
    onError: () => toast.error('Erro ao criar cobrança'),
  })

  const updateDebtManageMut = useMutation({
    mutationFn: ({ id, payload, scope }: { id: string; payload: Parameters<typeof updateDebt>[1]; scope?: InstallmentScope }) =>
      updateDebt(id, payload, scope),
    onSuccess: () => {
      invalidateStatement()
      setSheetKind(null)
      setEditDebt(null)
      setEditScope(null)
      toast.success('Dívida atualizada')
    },
    onError: () => toast.error('Erro ao salvar dívida'),
  })

  const updateReceivableManageMut = useMutation({
    mutationFn: ({ id, payload, scope }: { id: string; payload: Parameters<typeof updateReceivable>[1]; scope?: InstallmentScope }) =>
      updateReceivable(id, payload, scope),
    onSuccess: () => {
      invalidateStatement()
      setSheetKind(null)
      setEditReceivable(null)
      setEditScope(null)
      toast.success('Cobrança atualizada')
    },
    onError: () => toast.error('Erro ao salvar cobrança'),
  })

  const deleteDebtMut = useMutation({
    mutationFn: ({ id, scope, preserveTransaction }: { id: string; scope?: InstallmentScope; preserveTransaction?: boolean }) =>
      deleteDebt(id, scope, preserveTransaction),
    onSuccess: () => {
      invalidateStatement()
      toast.success('Dívida excluída')
    },
    onError: () => toast.error('Erro ao excluir dívida'),
  })

  const deleteReceivableMut = useMutation({
    mutationFn: ({ id, scope, preserveTransaction }: { id: string; scope?: InstallmentScope; preserveTransaction?: boolean }) =>
      deleteReceivable(id, scope, preserveTransaction),
    onSuccess: () => {
      invalidateStatement()
      toast.success('Cobrança excluída')
    },
    onError: () => toast.error('Erro ao excluir cobrança'),
  })

  const toggleDebtMut = useMutation({
    mutationFn: ({ id, isPaid, paymentBankId, paymentType, paymentDate }: {
      id: string
      isPaid: boolean
      paymentBankId?: string
      paymentType?: TransactionType
      /*
        A data do diálogo era descartada aqui, e a dívida gravava hoje —
        enquanto o mesmo diálogo respeitava a escolha para cobranças.
      */
      paymentDate?: string
    }) => updateDebt(id, { isPaid, paymentBankId, paymentType, paymentDate }),
    onSuccess: async () => {
      await invalidateStatement()
    },
    onError: () => toast.error('Erro ao atualizar — tente novamente'),
  })

  const toggleReceivableMut = useMutation({
    mutationFn: ({ id, isPaid, paymentDate }: {
      id: string
      isPaid: boolean
      paymentDate?: string
    }) => updateReceivable(id, { isPaid, paymentDate }),
    onSuccess: async () => {
      await invalidateStatement()
    },
    onError: () => toast.error('Erro ao atualizar — tente novamente'),
  })

  const settleMut = useMutation({
    /*
      Sem `startDate`/`endDate`.

      Eram enviados e o backend os usava como filtro financeiro: quitar as
      pendências com o drawer em agosto deixava a dívida vencida em junho
      aberta, enquanto o toast dizia "N itens quitados".

      O backend reconsulta todas as pendências abertas na hora da confirmação.
    */
    /*
      Envia a COMPETÊNCIA visível: a quitação passa a respeitar exatamente o
      universo da tela. All-time seria perigoso agora — o usuário olha agosto
      e a ação tocaria outubro, fora de vista.
    */
    mutationFn: (payload: Parameters<typeof settlePerson>[1]) =>
      settlePerson(person!.id, {
        ...payload,
        year: period.year,
        month: period.month,
      }),
    onSuccess: async (result) => {
      await invalidateStatement()
      setSettleOpen(false)

      const total = result.settledDebts + result.settledReceivables
      if (total === 0) {
        // Nada restava aberto — clique duplo ou outro fluxo chegou primeiro.
        toast.info('Nenhuma pendência restava em aberto')
        return
      }

      const created = result.createdExpenses + result.createdIncomes
      toast.success(
        total === 1 ? '1 item quitado' : `${total} itens quitados`,
        created > 0
          ? {
              description:
                created === 1
                  ? '1 lançamento registrado no extrato'
                  : `${created} lançamentos registrados no extrato`,
            }
          : undefined,
      )
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Não foi possível quitar as pendências')),
  })

  function handleDebtToggle(debt: Debt) {
    if (debt.isPaid) {
      if (debt.paymentTransactionId) {
        setUnmarkPaidTarget({ kind: 'debt', debt })
      } else {
        toggleDebtMut.mutate({ id: debt.id, isPaid: false })
      }
    } else if (user?.createExpenseOnDebtPaid === false) {
      toggleDebtMut.mutate({ id: debt.id, isPaid: true })
    } else {
      setMarkPaidDebt(debt)
    }
  }

  function handleReceivableToggle(receivable: Receivable) {
    if (receivable.isPaid) {
      if (receivable.paymentTransactionId) {
        setUnmarkPaidTarget({ kind: 'receivable', receivable })
      } else {
        toggleReceivableMut.mutate({ id: receivable.id, isPaid: false })
      }
    } else if (user?.createIncomeOnReceivablePaid === false) {
      toggleReceivableMut.mutate({ id: receivable.id, isPaid: true })
    } else {
      setMarkReceivedReceivable(receivable)
    }
  }

  function handleUnmarkPaidConfirm() {
    if (!unmarkPaidTarget) return
    if (unmarkPaidTarget.kind === 'debt') {
      toggleDebtMut.mutate({ id: unmarkPaidTarget.debt.id, isPaid: false })
    } else {
      toggleReceivableMut.mutate({ id: unmarkPaidTarget.receivable.id, isPaid: false })
    }
    setUnmarkPaidTarget(null)
  }

  function openNewDebt() {
    setEditDebt(null)
    setEditScope(null)
    setSheetKind('debt')
  }

  function openNewReceivable() {
    setEditReceivable(null)
    setEditScope(null)
    setSheetKind('receivable')
  }

  function handleEditDebt(debt: Debt) {
    if (debt.parentId) {
      setScopeDialog({ kind: 'debt', mode: 'edit', debt })
    } else {
      setEditDebt(debt)
      setEditScope(null)
      setSheetKind('debt')
    }
  }

  function handleEditReceivable(receivable: Receivable) {
    if (receivable.parentId) {
      setScopeDialog({ kind: 'receivable', mode: 'edit', receivable })
    } else {
      setEditReceivable(receivable)
      setEditScope(null)
      setSheetKind('receivable')
    }
  }

  function handleDeleteDebt(debt: Debt) {
    if (debt.paymentTransactionId && !debt.parentId) {
      setLinkedWarningTarget({ kind: 'debt', debt })
    } else if (debt.parentId) {
      setScopeDialog({ kind: 'debt', mode: 'delete', debt })
    } else {
      setDeleteTarget({ kind: 'debt', debt })
    }
  }

  /*
    A MESMA policy da página de A Receber — nenhum predicate paralelo aqui.

    Era daqui que saía o bug: `transactionId || paymentTransactionId` mandava
    cobrança automática para o aviso de vínculo, e o backend recusava as duas
    opções com 409.
  */
  function handleDeleteReceivable(receivable: Receivable) {
    const policy = resolveReceivableDeletePolicy(receivable)

    switch (policy.mode) {
      case 'source-transaction':
        setSourceDeleteTarget(receivable)
        return
      case 'linked-payment':
        setLinkedWarningTarget({ kind: 'receivable', receivable })
        return
      case 'unmark-first':
      case 'manage-from-source':
        /* Sem ação executável: o botão nem é oferecido. */
        return
      case 'direct':
        if (receivable.parentId) {
          setScopeDialog({ kind: 'receivable', mode: 'delete', receivable })
        } else {
          setDeleteTarget({ kind: 'receivable', receivable })
        }
    }
  }

  function handleScopeConfirm(scope: InstallmentScope) {
    if (!scopeDialog) return
    if (scopeDialog.kind === 'debt' && scopeDialog.debt) {
      if (scopeDialog.mode === 'delete') {
        deleteDebtMut.mutate({ id: scopeDialog.debt.id, scope })
      } else {
        setEditDebt(scopeDialog.debt)
        setEditScope(scope)
        setSheetKind('debt')
      }
    } else if (scopeDialog.kind === 'receivable' && scopeDialog.receivable) {
      if (scopeDialog.mode === 'delete') {
        deleteReceivableMut.mutate({ id: scopeDialog.receivable.id, scope })
      } else {
        setEditReceivable(scopeDialog.receivable)
        setEditScope(scope)
        setSheetKind('receivable')
      }
    }
    setScopeDialog(null)
  }

  async function handleDebtSheetSubmit(data: DebtFormData, scope: InstallmentScope | null) {
    if (editDebt) {
      const { installments, ...payload } = data
      void installments
      await updateDebtManageMut.mutateAsync({ id: editDebt.id, payload, scope: scope ?? undefined })
    } else {
      await createDebtMut.mutateAsync({ ...data, personId: person?.id })
    }
  }

  async function handleReceivableSheetSubmit(data: ReceivableFormData, scope: InstallmentScope | null) {
    if (editReceivable) {
      const { installments, ...payload } = data
      void installments
      await updateReceivableManageMut.mutateAsync({ id: editReceivable.id, payload, scope: scope ?? undefined })
    } else {
      await createReceivableMut.mutateAsync({ ...data, personId: person?.id })
    }
  }

  function confirmLinkedDelete() {
    if (!linkedWarningTarget) return
    if (linkedWarningTarget.kind === 'debt' && linkedWarningTarget.debt) {
      deleteDebtMut.mutate({ id: linkedWarningTarget.debt.id })
    } else if (linkedWarningTarget.kind === 'receivable' && linkedWarningTarget.receivable) {
      deleteReceivableMut.mutate({ id: linkedWarningTarget.receivable.id })
    }
    setLinkedWarningTarget(null)
  }

  function confirmLinkedDeleteOnly() {
    if (!linkedWarningTarget) return
    if (linkedWarningTarget.kind === 'debt' && linkedWarningTarget.debt) {
      deleteDebtMut.mutate({ id: linkedWarningTarget.debt.id, preserveTransaction: true })
    } else if (linkedWarningTarget.kind === 'receivable' && linkedWarningTarget.receivable) {
      deleteReceivableMut.mutate({ id: linkedWarningTarget.receivable.id, preserveTransaction: true })
    }
    setLinkedWarningTarget(null)
  }

  function confirmDelete() {
    if (!deleteTarget) return
    if (deleteTarget.kind === 'debt' && deleteTarget.debt) {
      deleteDebtMut.mutate({ id: deleteTarget.debt.id })
    } else if (deleteTarget.kind === 'receivable' && deleteTarget.receivable) {
      deleteReceivableMut.mutate({ id: deleteTarget.receivable.id })
    }
    setDeleteTarget(null)
  }

  /*
    ── Universo da competência selecionada ──

    Um único seletor governa card, lista e histórico. O universo é a união de:
    itens originados no mês, itens que vencem nele, e carry-over já vencido —
    deduplicado por item, então nada aparece duas vezes.
  */
  const competence = { year: period.year, month: period.month }
  const settlementReceivables = data?.settlement.receivables ?? []
  const settlementDebts = data?.settlement.debts ?? []

  const monthReceivables = openItemsFor(settlementReceivables, competence)
  const monthDebts = openItemsFor(settlementDebts, competence)
  const monthSummary = summarizeCompetence(
    monthReceivables,
    monthDebts,
    competence,
  )

  /*
    Quando a competência terminou de ser liquidada.

    A MAIOR data entre os itens resolvidos: o instante em que o último pendente
    foi quitado, e portanto em que o mês ficou integralmente resolvido — a
    mesma regra que `aggregateSettledAt` aplica no backend.

    `null` se algum resolvido não tiver `paidAt`: a data de outro item não pode
    falar pela conclusão que aquele registro não conhece, e o card cai em "Tudo
    quitado".
  */
  const competenceSettledAt = ((): string | null => {
    const resolvidos = [...historyReceivables, ...historyDebts]
    if (resolvidos.length === 0) return null

    let maior: string | null = null
    for (const item of resolvidos) {
      /*
        `civilDayOf`, nunca `slice(0, 10)`.

        `paidAt` é um INSTANTE, e o slice devolve o dia em UTC: um pagamento
        em 04/09 às 00h30 UTC ocorreu em 03/09 às 21h30 aqui. A lista de
        Pessoas (que usa `civilDay` no backend) dizia 03/09 e este drawer
        dizia 04/09 — o mesmo registro com dois dias na mesma tela.
      */
      const dia = item.paidAt ? civilDayOf(item.paidAt) : null
      /* Um resolvido sem data torna a conclusão indefensável para o mês. */
      if (!dia) return null
      if (maior === null || dia > maior) maior = dia
    }
    return maior
  })()

  /*
    ── O card segue o MODO da competência ──

    `monthSummary` sai de `openItemsFor(...)`, que filtra só o que está EM
    ABERTO. Num mês inteiramente quitado as listas voltam vazias e o card dizia
    "Nada a acertar · R$ 0,00" — verdade sobre a pendência, e inútil como
    leitura: o mês pode ter movimentado centenas de reais.

    Sem pendência, o valor passa a ser o histórico da competência, que o
    payload já traz em `period.settled*` (recortado por `belongsToHistory
    Competence` no backend). Nenhum dado novo foi necessário.
  */
  const cardCompetencia = competenceCard({
    openReceivableTotal: monthSummary.receivableTotal,
    openDebtTotal: monthSummary.debtTotal,
    openItemCount: monthSummary.itemCount,
    settledReceivableTotal: data?.period.settledReceivableTotal ?? 0,
    settledDebtTotal: data?.period.settledDebtTotal ?? 0,
    settledItemCount:
      (data?.period.settledReceivables.length ?? 0) +
      (data?.period.settledDebts.length ?? 0),
    settledAt: competenceSettledAt,
  })

  /*
    Itens ainda não vencidos DENTRO da competência — o universo que a quitação
    agora respeita. O diálogo avisa sobre eles: quitar antecipado é permitido,
    mas precisa ser consciente.
  */
  const notYetDueCount = monthSummary.notYetDueCount

  /**
   * Dados para WhatsApp e PDF.
   *
   * `requirePhone` separa os dois casos: o PDF é um documento e não precisa de
   * telefone; o WhatsApp precisa de um número utilizável.
   */
  function buildStatementContext(requirePhone: boolean) {
    if (!person || !summary) return null

    if (requirePhone) {
      const phone = normalizeWhatsAppPhone(person.phone)
      if (!phone) {
        /*
          Número ausente ou inválido não gera link.

          Antes qualquer string virava `wa.me/55<dígitos>`: "123" abria uma
          conversa inexistente sem nenhum aviso.
        */
        toast.error(
          person.phone
            ? 'O número de WhatsApp desta pessoa parece inválido — confira o DDD'
            : 'Cadastre o número de WhatsApp desta pessoa primeiro',
        )
        return null
      }
    }

    /*
      Duas guardas, porque os dois destinos falam de universos diferentes.

      O WhatsApp fala da relação INTEIRA, então `isFullySettled` (all-time) é o
      critério certo. O PDF é mensal: uma pessoa com pendências só em novembro
      não está quitada, mas o documento de setembro sairia vazio — e um extrato
      sem itens não é o que quem clicou esperava.
    */
    if (requirePhone && summary.isFullySettled) {
      toast.info('Não há pendências para enviar')
      return null
    }

    if (!requirePhone && monthSummary.isEmpty && historyItemCount === 0) {
      toast.info('Nada a acertar neste mês')
      return null
    }

    /*
      A competência, não o intervalo de datas.

      O histórico passou a ser arquivado por `referenceMonth`, então
      "01/07/2026 a 31/07/2026" descreveria o critério errado — sugeriria que
      a seção lista o que foi QUITADO naquelas datas, quando ela lista o que
      PERTENCE àquele mês, possivelmente quitado depois.
    */
    const periodLabel = formatMonthYear(period.month, period.year)

    return {
      person,
      /* All-time — o WhatsApp fala da relação inteira. */
      summary,
      /*
        O PDF é um documento MENSAL: recebe o universo da competência, o mesmo
        que a lista abaixo do card exibe. Antes recebia `pendingReceivables` /
        `pendingDebts`, que são all-time por contrato (Fase 8B) — o título dizia
        setembro e a lista trazia parcelas de 2028.
      */
      monthSummary,
      monthReceivables,
      monthDebts,
      historyDebts,
      historyReceivables,
      periodLabel,
    }
  }

  function sendStatementToWhatsApp() {
    const context = buildStatementContext(true)
    if (!context) return

    const phone = normalizeWhatsAppPhone(context.person.phone)
    if (!phone) return

    const message = buildWhatsAppMessage(context.summary, context.person.name)
    window.open(
      `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  async function buildStatementPdf(requirePhone: boolean) {
    const context = buildStatementContext(requirePhone)
    if (!context) return null

    /*
      O PDF recebe o mesmo universo MENSAL que o drawer exibe — resumo e itens
      da competência selecionada.

      Ele não recalcula nada: se recalculasse, os dois poderiam divergir — e o
      documento é justamente o que a outra pessoa vai conferir.
    */
    const doc = await generateStatementPdf({
      personName: context.person.name,
      periodLabel: context.periodLabel,
      summary: context.monthSummary,
      pendingReceivables: context.monthReceivables,
      pendingDebts: context.monthDebts,
      settledReceivables: context.historyReceivables,
      settledDebts: context.historyDebts,
      /*
        A política de atraso viaja junto, em vez de ser recriada no gerador: é
        a MESMA `dueContext` que a lista da tela usa, com a mesma competência e
        o mesmo dia civil. Sem isso o PDF poderia dizer "vence em" onde o
        drawer diz "em atraso".
      */
      dueContextOf: (item) => dueContext(item, competence),
      resolvedLabelOf: (item, kind) => resolvedLabel(item, kind),
    })

    return {
      doc,
      fileName: statementPdfFileName(context.person.name),
      message: buildWhatsAppMessage(context.summary, context.person.name),
      phone: normalizeWhatsAppPhone(context.person.phone),
    }
  }

  async function downloadStatementPdf() {
    // Baixar não exige telefone: o arquivo pode ser enviado por qualquer meio.
    const built = await buildStatementPdf(false)
    if (!built) return
    const { doc, fileName, message, phone } = built

    doc.save(fileName)

    // Sem número utilizável, o download continua valendo — só não há conversa
    // para abrir.
    if (!phone) {
      toast.success('PDF baixado')
      return
    }

    try {
      await navigator.clipboard.writeText(message)
      toast.info('PDF baixado e mensagem copiada — cole na conversa que vai abrir no WhatsApp')
    } catch {
      toast.info('PDF baixado — anexe o arquivo na conversa que vai abrir no WhatsApp')
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  async function shareStatementPdf() {
    const built = await buildStatementPdf(false)
    if (!built) return
    const { doc, fileName, message } = built

    const pdfBlob = doc.output('blob')
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' })

    if (!navigator.canShare?.({ files: [pdfFile] })) {
      toast.error('Compartilhamento não suportado neste navegador — use "Baixar PDF"')
      return
    }

    // WhatsApp ignora o campo `text` do share() quando um arquivo é enviado junto —
    // copiamos a mensagem antes para o usuário colar na conversa depois do PDF.
    try {
      await navigator.clipboard.writeText(message)
      toast.info('Mensagem copiada — cole na conversa depois de enviar o PDF')
    } catch {
      // Sem permissão de clipboard — segue o compartilhamento mesmo assim.
    }

    try {
      await navigator.share({ files: [pdfFile] })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toast.error('Não foi possível compartilhar o PDF')
      }
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle className="mr-8 truncate">{person?.name}</SheetTitle>
          <SheetDescription>Extrato consolidado de dívidas e cobranças</SheetDescription>
          {/*
            A ação de adicionar saiu daqui para o cabeçalho de "Em aberto".

            Ela opera sobre a LISTA, e no padrão de Fatura ("Transações · X" à
            esquerda, "+ Adicionar" à direita) vive junto do conteúdo que
            afeta. No topo, ocupava uma faixa inteira do painel para uma ação
            que a seção já contextualiza.
          */}
          <div className="flex flex-col gap-2 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={sendStatementToWhatsApp}
              >
                <MessageCircle className="size-3.5" />
                Enviar no WhatsApp
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger className={buttonVariants({ variant: 'outline', size: 'sm', className: 'gap-1.5' })}>
                  <FileText className="size-3.5" />
                  Extrato em PDF
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-48">
                  <DropdownMenuItem onClick={downloadStatementPdf}>
                    <Download className="size-3.5" />
                    Baixar PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={shareStatementPdf}>
                    <Share2 className="size-3.5" />
                    Compartilhar PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </SheetHeader>

        {/*
          ── O scroller NÃO tem padding horizontal ──

          Tinha `px-6`, e era ele que estreitava tudo: em 390px as rows de
          Pessoa ficavam com 320px contra 368px das de Fatura. A faixa de
          seção nascia recuada, e nada dentro dela alcançava a borda.

          Fatura sempre fez o contrário — scroller neutro, padding aplicado
          por seção —, e é o que permite as faixas irem de ponta a ponta com
          só o conteúdo recuado. `DRAWER_SECTION_INSET` é a autoridade desse
          recuo agora.
        */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto pt-4 pb-5">
          {/*
            UM seletor governa tudo: card, lista em aberto e histórico.

            A versão anterior tinha filtros (Todos/Em atraso/Este mês/Próximos)
            mais um segundo seletor no histórico — financeiramente correto, mas
            poluído. A competência mensal já responde a pergunta central.
          */}
          {isLoading ? (
            <div className="flex flex-col gap-3 px-4">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          ) : isError ? (
            /*
              Erro é estado próprio.

              Com a API fora do ar, `data` fica undefined e a tela caía no
              ramo vazio — dizendo "Nenhuma dívida ou cobrança", ou seja,
              afirmando que a pessoa não tem pendências quando o servidor
              apenas não respondeu.
            */
            <div
              role="alert"
              className="flex flex-col items-center justify-center px-4 py-14 text-center"
            >
              <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
                <TriangleAlert
                  className="size-6 text-destructive/70"
                  aria-hidden
                />
              </div>
              <p className="text-sm font-medium">
                Não foi possível carregar o extrato
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Verifique sua conexão e tente novamente. Nada foi alterado.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-5 gap-1.5"
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                {isFetching ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="size-3.5" aria-hidden />
                )}
                {isFetching ? 'Carregando…' : 'Tentar novamente'}
              </Button>
            </div>
          ) : data && summary ? (
            <>
              {/*
                ── Acerto da competência ──

                O card acompanha o mês selecionado. Antes ele mostrava o
                consolidado all-time enquanto a lista abaixo era filtrada — os
                números da tela não conversavam entre si.
              */}
              {/*
                O card mantém a identidade de card — o resumo da competência é
                um bloco, não uma seção de lista. Mas a margem passa a ser o
                MESMO recuo das seções: antes ele herdava o `px-6` do scroller
                e somava o próprio `px-4`, duas camadas para o mesmo respiro.
              */}
              <div className="mx-4 rounded-xl border border-border bg-muted/30 px-4 py-4">
                <p className="text-xs font-medium text-muted-foreground">
                  {/*
                    O título nomeia o que o número É: "Saldo a receber" com
                    pendência, "Saldo final do mês" quando tudo foi liquidado.
                    Mantê-lo em "Nada a acertar" sobre um valor histórico faria
                    os dois se contradizerem.
                  */}
                  {cardCompetencia.label}
                </p>
                {/*
                  Neutro, como em Bancos e no Orçamento.

                  Era verde quando positivo e vermelho quando negativo — cor
                  por direção, a mesma que a lista de Pessoas já removeu: o
                  verde colidia com o verde de "quitado", e a direção já está
                  no sinal e na composição abaixo.
                */}
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-[-0.02em]">
                  {competenceCardSign(cardCompetencia)}
                  {formatCurrency(Math.abs(cardCompetencia.net))}
                </p>

                {cardCompetencia.mode !== 'empty' && (
                  <>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>
                          A receber{' '}
                          <span className="font-medium text-foreground">
                            {formatCurrency(cardCompetencia.receivableTotal)}
                          </span>
                        </span>
                        <span>
                          A pagar{' '}
                          <span className="font-medium text-foreground">
                            {formatCurrency(cardCompetencia.debtTotal)}
                          </span>
                        </span>
                      </div>
                      {cardCompetencia.showSettleAction ? (
                        <Button
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setSettleOpen(true)}
                        >
                          <Check className="size-3.5" />
                          Quitar pendências
                        </Button>
                      ) : (
                        /*
                          Sem pendência não há o que quitar — e a conclusão
                          ocupa o lugar do botão, no verde de sucesso do
                          produto.
                        */
                        cardCompetencia.settledNote && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-paid">
                            <Check className="size-3.5" aria-hidden />
                            {cardCompetencia.settledNote}
                          </span>
                        )
                      )}
                    </div>

                    {/*
                      Explica quanto do total veio de competências anteriores —
                      sem isso o usuário não entende por que o acerto de
                      setembro contém um valor originado em agosto.
                    */}
                    {(monthSummary.carriedReceivable > 0 ||
                      monthSummary.carriedDebt > 0) && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Inclui{' '}
                        {monthSummary.carriedReceivable > 0 && (
                          <>
                            {formatCurrency(monthSummary.carriedReceivable)} a
                            receber
                          </>
                        )}
                        {monthSummary.carriedReceivable > 0 &&
                          monthSummary.carriedDebt > 0 &&
                          ' e '}
                        {monthSummary.carriedDebt > 0 && (
                          <>{formatCurrency(monthSummary.carriedDebt)} a pagar</>
                        )}{' '}
                        de períodos anteriores
                      </p>
                    )}
                  </>
                )}
              </div>

              {/*
                ── Em aberto ──

                Itens do universo desta competência: os originados nela, os que
                vencem nela e o carry-over ainda aberto. Sem chips — a
                competência já é o filtro.
              */}
              <div>
                {/*
                  ── O cabeçalho é CONSTANTE ──

                  No padrão de Fatura ("Transações · X" à esquerda, "+
                  Adicionar" à direita), a faixa existe independentemente de a
                  lista ter conteúdo: ela nomeia a seção e ancora a ação.

                  Antes, sem itens abertos, o cabeçalho sumia junto e restava
                  só a frase solta — e a ação de adicionar, que é justamente a
                  mais útil num mês vazio, ficava longe dali.

                  `h-11` fixo pelo mesmo motivo de Fatura: sem ele a faixa
                  encolheria conforme o conteúdo e o cabeçalho mudaria de
                  tamanho entre uma competência aberta e uma quitada.
                */}
                <DrawerSectionHeader
                  title={
                    <>
                      Em aberto · {monthSummary.itemCount}{' '}
                      {monthSummary.itemCount === 1 ? 'item' : 'itens'}
                    </>
                  }
                  action={
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={buttonVariants({
                        variant: 'ghost',
                        size: 'sm',
                        className:
                          'h-7 cursor-pointer gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground',
                      })}
                    >
                      <Plus className="size-3.5" />
                      Adicionar
                    </DropdownMenuTrigger>
                    {/*
                      As DUAS opções sobrevivem: aqui a ação é ambígua por
                      natureza (cobrança ou dívida), diferente de Fatura, onde
                      só existe transação. Reduzir a um botão simples obrigaria
                      a escolher um sentido por padrão.
                    */}
                    <DropdownMenuContent align="end" className="min-w-44">
                      <DropdownMenuItem onClick={openNewReceivable}>
                        <Plus className="size-3.5" />
                        Nova cobrança
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={openNewDebt}>
                        <Plus className="size-3.5" />
                        Nova dívida
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  }
                />

                {monthSummary.itemCount === 0 ? (
                  <DrawerSectionEmpty>
                    Nenhum valor em aberto para esta competência.
                  </DrawerSectionEmpty>
                ) : (
                  <div>
                    {monthReceivables.map((r) => (
                      <StatementRow
                        key={r.id}
                        kind="receivable"
                        item={r}
                        dueLabel={dueLabel(r, competence)}
                        onToggle={() => handleReceivableToggle(r)}
                        onEdit={() => handleEditReceivable(r)}
                        onDelete={() => handleDeleteReceivable(r)}
                      />
                    ))}
                    {monthDebts.map((d) => (
                      <StatementRow
                        key={d.id}
                        kind="debt"
                        item={d}
                        dueLabel={dueLabel(d, competence)}
                        onToggle={() => handleDebtToggle(d)}
                        onEdit={() => handleEditDebt(d)}
                        onDelete={() => handleDeleteDebt(d)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/*
                ── Histórico ──

                Usa o MESMO seletor do topo — não existe mais um segundo.
                Itens resolvidos, arquivados por `referenceMonth` — a competência a
                que o acerto pertence, não o mês em que o dinheiro se moveu.
              */}
              <div>
                {/*
                  A MESMA faixa de "Em aberto", sem ação à direita.

                  Era um `<p>` solto com `mb-2`: sem altura fixa, sem bordas e
                  com outro recuo — duas seções da mesma lista desenhadas por
                  regras diferentes, e a diferença aparecia como um degrau no
                  meio do drawer.
                */}
                <DrawerSectionHeader title="Histórico" />

                {historyReceivables.length === 0 &&
                historyDebts.length === 0 ? (
                  /* Histórico vazio ≠ nada em aberto: universos diferentes. */
                  <DrawerSectionEmpty>
                    Nenhum item resolvido neste período.
                  </DrawerSectionEmpty>
                ) : (
                <div>
                  <div>
                    {historyReceivables.map((r) => (
                      <StatementRow
                        key={r.id}
                        kind="receivable"
                        item={r}
                        /*
                          A data real da resolução, que o arquivamento por
                          competência não mostra sozinho.
                        */
                        dueLabel={resolvedLabel(r, 'receivable')}
                        onToggle={() => handleReceivableToggle(r)}
                        onEdit={() => handleEditReceivable(r)}
                        onDelete={() => handleDeleteReceivable(r)}
                        onEditSettlementDate={() =>
                          setSettlementDateItem({ kind: 'receivable', item: r })
                        }
                      />
                    ))}
                    {historyDebts.map((d) => (
                      <StatementRow
                        key={d.id}
                        kind="debt"
                        item={d}
                        dueLabel={resolvedLabel(d, 'debt')}
                        onToggle={() => handleDebtToggle(d)}
                        onEdit={() => handleEditDebt(d)}
                        onDelete={() => handleDeleteDebt(d)}
                        onEditSettlementDate={() =>
                          setSettlementDateItem({ kind: 'debt', item: d })
                        }
                      />
                    ))}
                  </div>
                </div>
                )}
              </div>

              {/*
                ── NÃO existe um vazio global depois das seções ──

                Havia um, condicionado a `summary.isFullySettled`, e ele
                sobrava: as duas seções já têm o vazio próprio, cada uma
                falando do seu universo. Numa competência sem atividade a tela
                dizia a mesma coisa três vezes — "nada a acertar" no summary,
                "nenhum valor em aberto para esta competência" e, depois do
                Histórico, "nenhum valor em aberto com C6".

                A terceira também respondia a pergunta ERRADA no lugar errado:
                `isFullySettled` é ALL-TIME, então a frase aparecia sob um
                Histórico que fala de um mês — e continuaria aparecendo num mês
                vazio de quem tem pendência em outro. O consolidado tem lugar
                próprio (o card e a mensagem do WhatsApp).
              */}
            </>
          ) : null}
        </div>
      </SheetContent>
      </Sheet>

      <MarkAsPaidDialog
        open={markPaidDebt !== null}
        kind="debt"
        createTransaction={user?.createExpenseOnDebtPaid ?? false}
        onConfirm={(payload) => {
          if (!markPaidDebt || !payload.paymentBankId || !payload.paymentType) return
          toggleDebtMut.mutate({
            id: markPaidDebt.id,
            isPaid: true,
            paymentBankId: payload.paymentBankId,
            paymentType: payload.paymentType,
            paymentDate: payload.paymentDate,
          })
          setMarkPaidDebt(null)
        }}
        onCancel={() => setMarkPaidDebt(null)}
      />
      <MarkAsPaidDialog
        open={markReceivedReceivable !== null}
        kind="receivable"
        createTransaction={user?.createIncomeOnReceivablePaid ?? false}
        onConfirm={(payload) => {
          if (!markReceivedReceivable || !payload.paymentDate) return
          toggleReceivableMut.mutate({
            id: markReceivedReceivable.id,
            isPaid: true,
            paymentDate: payload.paymentDate,
          })
          setMarkReceivedReceivable(null)
        }}
        onCancel={() => setMarkReceivedReceivable(null)}
      />
      <UnmarkPaidWarningDialog
        open={unmarkPaidTarget !== null}
        kind={unmarkPaidTarget?.kind ?? 'debt'}
        onConfirm={handleUnmarkPaidConfirm}
        onCancel={() => setUnmarkPaidTarget(null)}
      />
      {settlementDateItem && (
        <SettlementDateDialog
          open
          kind={settlementDateItem.kind}
          title={settlementDateItem.item.title}
          amount={Number(settlementDateItem.item.amount)}
          currentDate={settlementDateItem.item.paidAt ?? null}
          isPending={settlementDateMut.isPending}
          onConfirm={(paidAt) =>
            settlementDateMut.mutate({
              kind: settlementDateItem.kind,
              id: settlementDateItem.item.id,
              paidAt,
            })
          }
          onCancel={() => setSettlementDateItem(null)}
        />
      )}

      <SettlePersonDialog
        open={settleOpen}
        personName={person?.name ?? ''}
        /*
          Contagens da COMPETÊNCIA: o diálogo tem de descrever exatamente o que
          vai quitar. Usar o all-time prometeria um número e executaria outro.
        */
        competenceLabel={formatMonthYear(period.month, period.year)}
        debtsCount={monthDebts.length}
        receivablesCount={monthReceivables.length}
        carriedCount={
          [...monthReceivables, ...monthDebts].filter(
            (item) =>
              item.referenceMonth.year !== period.year ||
              item.referenceMonth.month !== period.month,
          ).length
        }
        hasPendingDebts={monthDebts.length > 0}
        hasPendingReceivables={monthReceivables.length > 0}
        createIncome={user?.createIncomeOnReceivablePaid ?? false}
        createExpense={user?.createExpenseOnDebtPaid ?? false}
        notYetDueCount={notYetDueCount}
        isPending={settleMut.isPending}
        onConfirm={(payload) => settleMut.mutate(payload)}
        onCancel={() => setSettleOpen(false)}
      />

      <DebtSheet
        open={sheetKind === 'debt'}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSheetKind(null)
            setEditDebt(null)
            setEditScope(null)
          }
        }}
        editTarget={editDebt}
        editScope={editScope}
        initialPersonId={person?.id}
        onSubmit={handleDebtSheetSubmit}
      />
      <ReceivableSheet
        open={sheetKind === 'receivable'}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSheetKind(null)
            setEditReceivable(null)
            setEditScope(null)
          }
        }}
        editTarget={editReceivable}
        editScope={editScope}
        initialPersonId={person?.id}
        onSubmit={handleReceivableSheetSubmit}
      />

      <InstallmentScopeDialog
        open={scopeDialog !== null}
        mode={scopeDialog?.mode ?? 'edit'}
        linkedWarning={Boolean(
          scopeDialog?.debt?.paymentTransactionId ||
          scopeDialog?.receivable?.transactionId ||
          scopeDialog?.receivable?.paymentTransactionId,
        )}
        onConfirm={handleScopeConfirm}
        onCancel={() => setScopeDialog(null)}
      />
      {/*
        Mesma confirmação da página de A Receber. O drawer de Pessoa
        permanece aberto: só a linha desaparece quando a lista revalida.
      */}
      <ConfirmDialog
        open={sourceDeleteTarget !== null}
        title="Excluir compra e cobrança?"
        description={
          <>
            Esta cobrança foi gerada pela compra{' '}
            <strong className="text-foreground">
              {sourceDeleteTarget?.title}
            </strong>
            . Para excluir a cobrança, a compra de origem também será excluída.
            Esta ação não pode ser desfeita.
          </>
        }
        confirmLabel="Excluir compra e cobrança"
        variant="destructive"
        isPending={sourceDeleteMut.isPending}
        onCancel={() => setSourceDeleteTarget(null)}
        onConfirm={() => {
          if (sourceDeleteTarget?.transactionId) {
            sourceDeleteMut.mutate(sourceDeleteTarget.transactionId)
          }
        }}
      />

      <DeleteLinkedWarningDialog
        open={linkedWarningTarget !== null}
        kind={linkedWarningTarget?.kind ?? 'debt'}
        /*
          Cobrança automática vem de uma compra; as demais têm comprovante de
          pagamento. O diálogo precisa nomear qual das duas o usuário perde.
        */
        link={
          linkedWarningTarget?.receivable?.transactionId ? 'purchase' : 'payment'
        }
        onConfirm={confirmLinkedDelete}
        onDeleteOnly={confirmLinkedDeleteOnly}
        onCancel={() => setLinkedWarningTarget(null)}
      />
      <Dialog open={deleteTarget !== null} onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir {deleteTarget?.kind === 'debt' ? 'dívida' : 'cobrança'}</DialogTitle>
            <DialogDescription>Esta ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmDelete}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
