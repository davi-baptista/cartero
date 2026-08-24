'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Users, ChevronRight, Loader2, Check, Undo2, MoreVertical, MessageCircle, FileText, Download, Share2, TriangleAlert, RotateCcw } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  MonthNav,
  monthBounds,
  currentPeriod,
  periodFromDate,
  type MonthPeriod,
} from '@/components/month-nav'
import { MarkAsPaidDialog } from '../transactions/mark-as-paid-dialog'
import { UnmarkPaidWarningDialog } from '../transactions/unmark-paid-warning-dialog'
import { InstallmentScopeDialog } from '../transactions/installment-scope-dialog'
import { DeleteLinkedWarningDialog } from '../transactions/delete-linked-warning-dialog'
import { DebtSheet, type DebtFormData } from '../debts/debt-sheet'
import { ReceivableSheet, type ReceivableFormData } from '../receivables/receivable-sheet'
import { settlementStatus } from '@/lib/settlement-status'
import { apiErrorMessage } from '@/lib/api-error'
import { SettlePersonDialog } from './settle-person-dialog'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MotionRow } from '@/components/ui/motion-row'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { formatCurrency, formatDate, formatMonthYear } from '@/lib/formatters'
import { generateStatementPdf, statementPdfFileName } from '@/lib/statement-pdf'
import { createDebt, updateDebt, deleteDebt } from '@/services/debts.service'
import {
  getPersons,
  createPerson,
  updatePerson,
  deletePerson,
  getPersonStatement,
  settlePerson,
} from '@/services/persons.service'
import { createReceivable, updateReceivable, deleteReceivable } from '@/services/receivables.service'
import {
  dueLabel,
  openItemsFor,
  resolvedLabel,
  summarizeCompetence,
} from '@/lib/person-settlement-view'
import {
  buildWhatsAppMessage,
  normalizeWhatsAppPhone,
} from '@/lib/person-statement'
import { cn } from '@/lib/utils'
import type { Person, Debt, Receivable } from '@/types'
import { InstallmentScope, TransactionType } from '@/types'
import { useAuth } from '@/providers/auth-provider'

// ─── Statement sheet ─────────────────────────────────────────────────────────

/**
 * Uma linha de pendência ou de histórico no extrato da pessoa.
 *
 * As duas listas (cobranças e dívidas) tinham blocos JSX quase idênticos
 * repetidos inline, divergindo só no sinal, na cor e nos rótulos de ação.
 */
function StatementRow({
  kind,
  item,
  dueLabel: dueLabelText,
  onToggle,
  onEdit,
  onDelete,
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
}) {
  const status = settlementStatus(item)
  const isReceivable = kind === 'receivable'
  /** Cobrança automática: a compra é a fonte de verdade dos seus valores. */
  const isAutomatic =
    isReceivable && Boolean((item as Receivable).transactionId)

  return (
    <div className="flex items-center gap-2.5 border-b border-border py-2.5 last:border-b-0">
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
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'truncate text-sm',
              item.isPaid && 'text-muted-foreground line-through',
            )}
          >
            {item.title}
          </span>
          {isAutomatic && (
            /*
              Indicação discreta da origem: explica por que valor e vencimento
              desta cobrança não são editáveis aqui.
            */
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Compra no cartão
            </span>
          )}
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
        </span>
      </div>
      <span
        className={cn(
          'shrink-0 text-sm font-medium tabular-nums',
          item.isPaid
            ? 'text-muted-foreground line-through'
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
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-3.5" /> Editar
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-3.5" /> Excluir
          </DropdownMenuItem>
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

function StatementSheet({
  person,
  open,
  onClose,
  initialPeriod,
}: {
  person: Person | null
  open: boolean
  onClose: () => void
  /** Mês pedido pela URL; sem ele o extrato abre no mês corrente. */
  initialPeriod?: MonthPeriod
}) {
  const qc = useQueryClient()
  const { user } = useAuth()

  // Mês próprio do extrato — independente do mês global das outras telas.
  const [period, setPeriod] = useState<MonthPeriod>(
    () => initialPeriod ?? currentPeriod(),
  )
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
  const [linkedWarningTarget, setLinkedWarningTarget] = useState<{
    kind: 'debt' | 'receivable'
    debt?: Debt
    receivable?: Receivable
  } | null>(null)

  // Cada pessoa abre no mês corrente — ou no que a URL pediu, quando a
  // navegação veio do orçamento — e não no mês da pessoa anterior.
  useEffect(() => {
    if (person) setPeriod(initialPeriod ?? currentPeriod())
  }, [person?.id, initialPeriod])



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
  const pendingDebts = data?.pending.debts ?? []
  const pendingReceivables = data?.pending.receivables ?? []
  /*
    Histórico = universo de PERÍODO. Nome distinto do consolidado de propósito:
    `period.settled*` não pode ser confundido com `pending`.
  */
  const historyDebts = data?.period.settledDebts ?? []
  const historyReceivables = data?.period.settledReceivables ?? []

  /*
    Competência inteligente: o backend indica qual mês abrir.

    Enquanto existir item aberto originado no mês ANTERIOR que ainda não
    venceu, o acerto daquele mês continua em andamento e é o que o usuário quer
    conferir — o jantar de agosto que vence com a fatura em 10/09.

    Aplicada UMA vez por pessoa (`appliedFor`): depois disso a navegação manual
    manda, e reaplicar jogaria o usuário de volta para agosto a cada refetch.
    A URL, quando presente, tem prioridade — foi uma escolha explícita.
  */
  const defaultApplied = useRef<string | null>(null)
  const defaultCompetence = data?.settlement.defaultCompetence
  /*
    O identificador estável, declarado à parte.

    O efeito depende conceitualmente do ID — não do objeto `person`, que é
    recriado a cada resposta da query. Extrair a string deixa a dependência
    honesta: o que o efeito lê é exatamente o que ele declara, e ele não
    reexecuta quando a mesma pessoa volta numa nova referência.
  */
  const personId = person?.id

  useEffect(() => {
    if (!personId || !defaultCompetence) return
    if (initialPeriod) return
    if (defaultApplied.current === personId) return

    defaultApplied.current = personId
    setPeriod({
      year: defaultCompetence.year,
      month: defaultCompetence.month,
    })
  }, [personId, defaultCompetence, initialPeriod])

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

  function handleDeleteReceivable(receivable: Receivable) {
    if ((receivable.transactionId || receivable.paymentTransactionId) && !receivable.parentId) {
      setLinkedWarningTarget({ kind: 'receivable', receivable })
    } else if (receivable.parentId) {
      setScopeDialog({ kind: 'receivable', mode: 'delete', receivable })
    } else {
      setDeleteTarget({ kind: 'receivable', receivable })
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

    if (summary.isFullySettled) {
      toast.info('Não há pendências para enviar')
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
      summary,
      pendingReceivables,
      pendingDebts,
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
      O PDF recebe o MESMO `summary` que o drawer exibe.

      Ele não recalcula nada: se recalculasse, os dois poderiam divergir — e o
      documento é justamente o que a outra pessoa vai conferir.
    */
    const doc = await generateStatementPdf({
      personName: context.person.name,
      periodLabel: context.periodLabel,
      summary: context.summary,
      pendingReceivables: context.pendingReceivables,
      pendingDebts: context.pendingDebts,
      settledReceivables: context.historyReceivables,
      settledDebts: context.historyDebts,
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
          <div className="flex flex-col gap-2 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger className={buttonVariants({ variant: 'outline', size: 'sm', className: 'gap-1.5' })}>
                  <Plus className="size-3.5" />
                  Adicionar dívida ou cobrança
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-44">
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
            </div>
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

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 pt-4 pb-5">
          {/*
            UM seletor governa tudo: card, lista em aberto e histórico.

            A versão anterior tinha filtros (Todos/Em atraso/Este mês/Próximos)
            mais um segundo seletor no histórico — financeiramente correto, mas
            poluído. A competência mensal já responde a pergunta central.
          */}
          <div className="-mx-6 flex justify-center border-y border-border/60 px-6 py-1">
            <MonthNav period={period} onChange={setPeriod} />
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-3">
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
              className="flex flex-col items-center justify-center py-14 text-center"
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
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-4">
                <p className="text-xs text-muted-foreground">
                  {monthSummary.isEmpty
                    ? 'Nada a acertar'
                    : monthSummary.net > 0.005
                      ? 'Saldo a receber'
                      : monthSummary.net < -0.005
                        ? 'Saldo a pagar'
                        : 'Saldo líquido zerado'}
                </p>
                <p
                  className={cn(
                    'mt-1 text-2xl font-semibold tabular-nums tracking-[-0.02em]',
                    monthSummary.net > 0.005 && 'text-receivable',
                    monthSummary.net < -0.005 && 'text-destructive',
                    Math.abs(monthSummary.net) <= 0.005 && 'text-foreground',
                  )}
                >
                  {monthSummary.net > 0.005 && '+'}
                  {monthSummary.net < -0.005 && '-'}
                  {formatCurrency(Math.abs(monthSummary.net))}
                </p>

                {!monthSummary.isEmpty && (
                  <>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>
                          A receber{' '}
                          <span className="font-medium text-receivable">
                            {formatCurrency(monthSummary.receivableTotal)}
                          </span>
                        </span>
                        <span>
                          A pagar{' '}
                          <span className="font-medium text-destructive">
                            {formatCurrency(monthSummary.debtTotal)}
                          </span>
                        </span>
                      </div>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setSettleOpen(true)}
                      >
                        <Check className="size-3.5" />
                        Quitar pendências
                      </Button>
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
              {monthSummary.isEmpty ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Nenhum valor em aberto para esta competência.
                </p>
              ) : (
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Em aberto · {monthSummary.itemCount}{' '}
                    {monthSummary.itemCount === 1 ? 'item' : 'itens'}
                  </p>
                  <div className="border-t border-border">
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
                </div>
              )}

              {/*
                ── Histórico ──

                Usa o MESMO seletor do topo — não existe mais um segundo.
                Itens resolvidos, arquivados por `referenceMonth` — a competência a
                que o acerto pertence, não o mês em que o dinheiro se moveu.
              */}
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Histórico
                </p>

                {historyReceivables.length === 0 &&
                historyDebts.length === 0 ? (
                  /* Histórico vazio ≠ nada em aberto: universos diferentes. */
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Nenhum item resolvido neste período.
                  </p>
                ) : (
                <div>
                  <div className="border-t border-border">
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
                      />
                    ))}
                  </div>
                </div>
                )}
              </div>

              {/*
                Nada em aberto: mensagem própria da seção.

                Antes o vazio combinava "sem pendências" com "nada quitado no
                mês" numa frase só — misturando os dois universos que esta
                reorganização separou. Agora o Histórico tem o seu próprio
                vazio, e este cobre apenas o consolidado.
              */}
              {summary.isFullySettled && (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  Nenhum valor em aberto com {person?.name ?? 'esta pessoa'}.
                </p>
              )}
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

// ─── Person form sheet ────────────────────────────────────────────────────────

function PersonFormSheet({
  open,
  onOpenChange,
  editTarget,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editTarget: Person | null
  onSubmit: (name: string, phone: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName(editTarget?.name ?? '')
      setPhone(editTarget?.phone ?? '')
    }
  }, [open, editTarget])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await onSubmit(name.trim(), phone.trim())
      setName('')
      setPhone('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        Largura e scroll alinhados aos outros drawers (`sm:max-w-md`).

        Com `sm:max-w-sm` e um form sem `overflow-y-auto`, em notebook o
        conteúdo empurrava o footer para fora da área visível — o botão de
        salvar ficava inalcançável.
      */}
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{editTarget ? 'Editar pessoa' : 'Nova pessoa'}</SheetTitle>
          <SheetDescription>
            {editTarget ? 'Atualize o nome.' : 'Cadastre um contato para vincular dívidas e cobranças.'}
          </SheetDescription>
        </SheetHeader>

        <form
          id="person-form"
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              placeholder="Ex: Fabricio, Maria..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">WhatsApp (opcional)</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              placeholder="Ex: (85) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Inclua o DDD. O código do Brasil (+55) será adicionado automaticamente.
            </p>
          </div>
        </form>

        <SheetFooter className="shrink-0 border-t border-border/60 px-6 pb-6 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button type="submit" form="person-form" disabled={submitting || !name.trim()}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {editTarget ? 'Salvar' : 'Criar pessoa'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PersonsPage() {
  const qc = useQueryClient()
  const searchParams = useSearchParams()
  const personIdParam = searchParams.get('personId')
  const periodParam = searchParams.get('period')

  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Person | null>(null)
  const [statementPerson, setStatementPerson] = useState<Person | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Person | null>(null)
  const openedFromUrl = useRef(false)

  // `?period=YYYY-MM`. Memoizado porque vira dependência de efeito no sheet.
  const urlPeriod = useMemo(() => {
    if (!periodParam) return undefined
    return periodFromDate(`${periodParam}-01`)
  }, [periodParam])

  const {
    data: persons = [],
    isLoading,
    isError,
    isSuccess,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['persons'],
    queryFn: getPersons,
  })

  // Abre o extrato já na pessoa e no mês que a navegação pediu — usado pelo
  // card de dívidas do orçamento. Só na chegada: depois o controle é do
  // usuário, e reabrir o sheet a cada render seria prendê-lo ali.
  useEffect(() => {
    if (openedFromUrl.current || !personIdParam || persons.length === 0) return
    const target = persons.find((p) => p.id === personIdParam)
    if (!target) return
    openedFromUrl.current = true
    setStatementPerson(target)
  }, [personIdParam, persons])

  const createMut = useMutation({
    mutationFn: ({ name, phone }: { name: string; phone: string }) =>
      createPerson({ name, phone: phone || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      setFormOpen(false)
      toast.success('Pessoa criada')
    },
    onError: () => toast.error('Erro ao criar pessoa — tente novamente'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, name, phone }: { id: string; name: string; phone: string }) =>
      updatePerson(id, { name, phone: phone || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['debts'] })
      qc.invalidateQueries({ queryKey: ['receivables'] })
      setFormOpen(false)
      setEditTarget(null)
      toast.success('Pessoa atualizada')
    },
    onError: () => toast.error('Erro ao salvar — tente novamente'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePerson(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['debts'] })
      qc.invalidateQueries({ queryKey: ['receivables'] })
      toast.success('Pessoa removida')
    },
    onError: () => toast.error('Erro ao remover — tente novamente'),
  })

  async function handleFormSubmit(name: string, phone: string) {
    if (editTarget) {
      await updateMut.mutateAsync({ id: editTarget.id, name, phone })
    } else {
      await createMut.mutateAsync({ name, phone })
    }
  }

  function handleEdit(person: Person) {
    setEditTarget(person)
    setFormOpen(true)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pessoas</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Contatos vinculados a dívidas e cobranças
          </p>
        </div>
        <Button
          onClick={() => {
            setEditTarget(null)
            setFormOpen(true)
          }}
        >
          <Plus className="size-4" />
          Nova pessoa
        </Button>
      </div>

      {/* List */}
      <div className="border-t border-border">
        {isLoading ? (
          <div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-border px-1 py-3 last:border-b-0"
              >
                <Skeleton className="size-8 shrink-0 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : isError ? (
          /*
            Erro não é lista vazia.

            Sem este ramo, a API fora do ar mostrava "Nenhuma pessoa
            cadastrada" — o app afirmando que o usuário não tem contatos
            quando só não conseguiu buscá-los.
          */
          <div
            role="alert"
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-destructive/10">
              <TriangleAlert className="size-5 text-destructive/70" aria-hidden />
            </div>
            <p className="text-sm font-medium">
              Não foi possível carregar as pessoas
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Verifique sua conexão e tente novamente.
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
        ) : isSuccess && persons.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-muted/50">
              <Users className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Nenhuma pessoa cadastrada</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Cadastre contatos para vincular dívidas e cobranças a pessoas específicas.
            </p>
          </div>
        ) : (
          <div>
            {persons.map((person, i) => (
              <MotionRow key={person.id} index={i}>
                <div className="group flex items-center gap-3 px-1 py-3">
                  {/* Avatar */}
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                    {person.name[0].toUpperCase()}
                  </div>

                  {/* Name */}
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                    onClick={() => setStatementPerson(person)}
                  >
                    <span className="truncate text-sm font-medium">{person.name}</span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
                  </button>

                  {/* Actions — desktop hover */}
                  <div className="hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => handleEdit(person)}
                      aria-label="Editar pessoa"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(person)}
                      aria-label="Remover pessoa"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>

                  {/* Mobile dropdown */}
                  <div className="sm:hidden">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label="Mais opções"
                      >
                        <MoreVertical className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setStatementPerson(person)}>
                          <ChevronRight className="size-3.5" />
                          Ver extrato
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleEdit(person)}>
                          <Pencil className="size-3.5" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteTarget(person)} className="text-destructive focus:text-destructive">
                          <Trash2 className="size-3.5" />
                          Remover
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </MotionRow>
            ))}
          </div>
        )}
      </div>

      {/* Person form sheet */}
      <PersonFormSheet
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditTarget(null)
        }}
        editTarget={editTarget}
        onSubmit={handleFormSubmit}
      />

      {/* Statement sheet */}
      <StatementSheet
        person={statementPerson}
        open={statementPerson !== null}
        onClose={() => setStatementPerson(null)}
        initialPeriod={urlPeriod}
      />

      {/* Delete confirm */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover pessoa</DialogTitle>
            {/*
              A cópia diz o que de fato acontece.

              O FK `personId` é `ON DELETE SET NULL` em Debt, Receivable e
              Transaction, e o nome da contraparte foi gravado em
              `creditorName`/`debtorName` na criação — então os registros
              sobrevivem E continuam legíveis. Por isso a exclusão é permitida
              mesmo com pendências: ela encerra o cadastro do contato, não os
              compromissos.
            */}
            <DialogDescription>
              Remover{' '}
              <strong className="text-foreground">{deleteTarget?.name}</strong>{' '}
              apaga apenas o contato. As dívidas, cobranças e transações
              continuam no histórico, com o nome dela preservado — nenhum valor
              é excluído.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteMut.mutate(deleteTarget.id)
                  setDeleteTarget(null)
                }
              }}
            >
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
