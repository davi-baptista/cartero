'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  ChevronRight,
  Loader2,
  Check,
  Undo2,
  MoreVertical,
  MessageCircle,
  FileText,
  Download,
  Share2,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { MonthNav, monthBounds, currentPeriod, type MonthPeriod } from '@/components/month-nav'
import { MarkAsPaidDialog } from '../transactions/mark-as-paid-dialog'
import { UnmarkPaidWarningDialog } from '../transactions/unmark-paid-warning-dialog'
import { InstallmentScopeDialog } from '../transactions/installment-scope-dialog'
import { DeleteLinkedWarningDialog } from '../transactions/delete-linked-warning-dialog'
import { DebtSheet, type DebtFormData } from '../debts/debt-sheet'
import { ReceivableSheet, type ReceivableFormData } from '../receivables/receivable-sheet'
import { SettlePersonDialog } from './settle-person-dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { MotionRow } from '@/components/ui/motion-row'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  getPersons,
  createPerson,
  updatePerson,
  deletePerson,
  getPersonStatement,
  settlePerson,
} from '@/services/persons.service'
import { createDebt, updateDebt, deleteDebt } from '@/services/debts.service'
import { createReceivable, updateReceivable, deleteReceivable } from '@/services/receivables.service'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { generateStatementPdf, statementPdfFileName } from '@/lib/statement-pdf'
import { cn } from '@/lib/utils'
import type { Person, Debt, Receivable } from '@/types'
import { InstallmentScope, TransactionType } from '@/types'
import { useAuth } from '@/providers/auth-provider'

function normalizeWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('55') ? digits : `55${digits}`
}

// ─── Statement sheet ─────────────────────────────────────────────────────────

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
}: {
  person: Person | null
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { user } = useAuth()

  // Mês próprio do extrato — independente do mês global das outras telas.
  const [period, setPeriod] = useState<MonthPeriod>(currentPeriod)
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

  // Cada pessoa abre no mês corrente, não no mês da pessoa anterior.
  useEffect(() => {
    if (person) setPeriod(currentPeriod())
  }, [person?.id])

  const { data, isLoading } = useQuery({
    queryKey: ['person-statement', person?.id, startDate, endDate],
    queryFn: () => getPersonStatement(person!.id, { startDate, endDate }),
    enabled: !!person,
  })
  const { data: allStatement } = useQuery({
    queryKey: ['person-statement-all', person?.id, startDate, endDate],
    queryFn: () => getPersonStatement(person!.id, { startDate, endDate }),
    enabled: !!person,
  })

  async function invalidateStatement() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['person-statement', person?.id] }),
      qc.invalidateQueries({ queryKey: ['person-statement-all', person?.id] }),
      qc.invalidateQueries({ queryKey: ['debts'] }),
      qc.invalidateQueries({ queryKey: ['receivables'] }),
      qc.invalidateQueries({ queryKey: ['transactions'] }),
      qc.invalidateQueries({ queryKey: ['bank-invoices'] }),
      qc.invalidateQueries({ queryKey: ['budget'] }),
    ])
  }

  const createDebtMut = useMutation({
    mutationFn: createDebt,
    onSuccess: () => {
      invalidateStatement()
      setSheetKind(null)
      toast.success('DÃ­vida criada')
    },
    onError: () => toast.error('Erro ao criar dÃ­vida'),
  })

  const createReceivableMut = useMutation({
    mutationFn: createReceivable,
    onSuccess: () => {
      invalidateStatement()
      setSheetKind(null)
      toast.success('CobranÃ§a criada')
    },
    onError: () => toast.error('Erro ao criar cobranÃ§a'),
  })

  const updateDebtManageMut = useMutation({
    mutationFn: ({ id, payload, scope }: { id: string; payload: Parameters<typeof updateDebt>[1]; scope?: InstallmentScope }) =>
      updateDebt(id, payload, scope),
    onSuccess: () => {
      invalidateStatement()
      setSheetKind(null)
      setEditDebt(null)
      setEditScope(null)
      toast.success('DÃ­vida atualizada')
    },
    onError: () => toast.error('Erro ao salvar dÃ­vida'),
  })

  const updateReceivableManageMut = useMutation({
    mutationFn: ({ id, payload, scope }: { id: string; payload: Parameters<typeof updateReceivable>[1]; scope?: InstallmentScope }) =>
      updateReceivable(id, payload, scope),
    onSuccess: () => {
      invalidateStatement()
      setSheetKind(null)
      setEditReceivable(null)
      setEditScope(null)
      toast.success('CobranÃ§a atualizada')
    },
    onError: () => toast.error('Erro ao salvar cobranÃ§a'),
  })

  const deleteDebtMut = useMutation({
    mutationFn: ({ id, scope, preserveTransaction }: { id: string; scope?: InstallmentScope; preserveTransaction?: boolean }) =>
      deleteDebt(id, scope, preserveTransaction),
    onSuccess: () => {
      invalidateStatement()
      toast.success('DÃ­vida excluÃ­da')
    },
    onError: () => toast.error('Erro ao excluir dÃ­vida'),
  })

  const deleteReceivableMut = useMutation({
    mutationFn: ({ id, scope, preserveTransaction }: { id: string; scope?: InstallmentScope; preserveTransaction?: boolean }) =>
      deleteReceivable(id, scope, preserveTransaction),
    onSuccess: () => {
      invalidateStatement()
      toast.success('CobranÃ§a excluÃ­da')
    },
    onError: () => toast.error('Erro ao excluir cobranÃ§a'),
  })

  const toggleDebtMut = useMutation({
    mutationFn: ({ id, isPaid, paymentBankId, paymentType }: {
      id: string
      isPaid: boolean
      paymentBankId?: string
      paymentType?: TransactionType
    }) => updateDebt(id, { isPaid, paymentBankId, paymentType }),
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
    mutationFn: (payload: Parameters<typeof settlePerson>[1]) => settlePerson(person!.id, {
      ...payload,
      startDate,
      endDate,
    }),
    onSuccess: async (result) => {
      await invalidateStatement()
      setSettleOpen(false)
      toast.success(`${result.settledDebts + result.settledReceivables} itens resolvidos`)
    },
    onError: () => toast.error('Não foi possível quitar o saldo'),
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

  const netBalance = data?.netBalance ?? 0
  const isPositive = netBalance >= 0
  const pendingDebtsCount = allStatement?.debts.filter((item) => !item.isPaid).length ?? 0
  const pendingReceivablesCount = allStatement?.receivables.filter((item) => !item.isPaid).length ?? 0
  const pendingCount = pendingDebtsCount + pendingReceivablesCount
  const settlementNetBalance = allStatement?.netBalance ?? 0

  function buildStatementContext() {
    if (!person?.phone) {
      toast.error('Cadastre o número de WhatsApp desta pessoa primeiro')
      return null
    }

    const pendingReceivables = (data?.receivables ?? []).filter((item) => !item.isPaid)
    const pendingDebts = (data?.debts ?? []).filter((item) => !item.isPaid)
    if (pendingReceivables.length === 0 && pendingDebts.length === 0) {
      toast.info('Não há pendências no período selecionado')
      return null
    }

    const periodLabel = startDate && endDate
      ? `${formatDate(startDate)} a ${formatDate(endDate)}`
      : 'período selecionado'

    return { person, pendingReceivables, pendingDebts, periodLabel }
  }

  function buildWhatsAppMessage({
    person,
    pendingReceivables,
    pendingDebts,
    periodLabel,
  }: NonNullable<ReturnType<typeof buildStatementContext>>) {
    const totalReceivable = pendingReceivables.reduce((sum, item) => sum + Number(item.amount), 0)
    const totalDebt = pendingDebts.reduce((sum, item) => sum + Number(item.amount), 0)
    const balance = Number(data?.netBalance ?? 0)
    const balanceLine = balance > 0.005
      ? `Você está me devendo *${formatCurrency(balance)}* 🙂`
      : balance < -0.005
        ? `Estou te devendo *${formatCurrency(Math.abs(balance))}* 🙂`
        : 'Estamos quites nesse período — nada pendente! 🎉'
    const breakdownLines = [
      pendingReceivables.length > 0
        ? `Você me deve: *${formatCurrency(totalReceivable)}* (${pendingReceivables.length} ${pendingReceivables.length === 1 ? 'pendência' : 'pendências'})`
        : '',
      pendingDebts.length > 0
        ? `Eu te devo: *${formatCurrency(totalDebt)}* (${pendingDebts.length} ${pendingDebts.length === 1 ? 'pendência' : 'pendências'})`
        : '',
    ].filter(Boolean)

    return [
      `Oi, ${person.name}!`,
      '',
      `Resumo do nosso extrato — ${periodLabel}:`,
      '',
      breakdownLines.join('\n'),
      '',
      balanceLine,
    ].join('\n')
  }

  function sendStatementToWhatsApp() {
    const context = buildStatementContext()
    if (!context) return

    const message = buildWhatsAppMessage(context)
    const phone = normalizeWhatsAppPhone(context.person.phone!)
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  async function buildStatementPdf() {
    const context = buildStatementContext()
    if (!context) return null
    const { person, pendingReceivables, pendingDebts, periodLabel } = context

    const doc = await generateStatementPdf({
      personName: person.name,
      periodLabel,
      netBalance: Number(data?.netBalance ?? 0),
      receivables: pendingReceivables,
      debts: pendingDebts,
    })
    const fileName = statementPdfFileName(person.name)
    const message = buildWhatsAppMessage(context)
    const phone = normalizeWhatsAppPhone(person.phone!)

    return { doc, fileName, message, phone }
  }

  async function downloadStatementPdf() {
    const built = await buildStatementPdf()
    if (!built) return
    const { doc, fileName, message, phone } = built

    doc.save(fileName)
    try {
      await navigator.clipboard.writeText(message)
      toast.info('PDF baixado e mensagem copiada — cole na conversa que vai abrir no WhatsApp')
    } catch {
      toast.info('PDF baixado — anexe o arquivo na conversa que vai abrir no WhatsApp')
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  async function shareStatementPdf() {
    const built = await buildStatementPdf()
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
          {/* O Sheet cobre a barra superior, então o extrato tem o próprio
              seletor de mês — independente do mês global das outras telas. */}
          <div className="-mx-6 flex justify-center border-y border-border/60 px-6 py-1">
            <MonthNav period={period} onChange={setPeriod} />
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          ) : data ? (
            <>
              {/* Net balance summary */}
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-4">
                <p className="text-xs text-muted-foreground">Saldo líquido</p>
                <p
                  className={cn(
                    'mt-1 text-2xl font-semibold tabular-nums tracking-[-0.02em]',
                    isPositive ? 'text-receivable' : 'text-destructive',
                  )}
                >
                  {isPositive ? '+' : ''}
                  {formatCurrency(Math.abs(netBalance))}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isPositive
                    ? `${person?.name} te deve no total`
                    : `Você deve ${formatCurrency(Math.abs(netBalance))} para ${person?.name}`}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>
                      A receber{' '}
                      <span className="font-medium text-receivable">
                        {formatCurrency(data.totalReceivables)}
                      </span>
                    </span>
                    <span>
                      A pagar{' '}
                      <span className="font-medium text-destructive">
                        {formatCurrency(data.totalDebts)}
                      </span>
                    </span>
                  </div>
                  {pendingCount > 0 && (
                    <Button size="sm" className="gap-1.5" disabled={!allStatement} onClick={() => setSettleOpen(true)}>
                      <Check className="size-3.5" />
                      Quitar tudo
                    </Button>
                  )}
                </div>
              </div>

              {/* Receivables */}
              {data.receivables.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">A Receber</p>
                  <div className="border-t border-border">
                    {data.receivables.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2.5 border-b border-border py-2.5 last:border-b-0"
                      >
                        <ToggleButton
                          isPaid={r.isPaid}
                          onToggle={() => handleReceivableToggle(r)}
                          label={r.isPaid ? 'Marcar como pendente' : 'Marcar como recebido'}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className={cn(
                              'truncate text-sm',
                              r.isPaid && 'text-muted-foreground line-through',
                            )}
                          >
                            {r.title}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatDate(r.dueDate)}
                          </span>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 text-sm font-medium tabular-nums',
                            r.isPaid
                              ? 'text-muted-foreground line-through'
                              : 'text-receivable/80',
                          )}
                        >
                          +{formatCurrency(r.amount)}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label="Ações da cobrança">
                            <MoreVertical className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditReceivable(r)}>
                              <Pencil className="size-3.5" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDeleteReceivable(r)} className="text-destructive focus:text-destructive">
                              <Trash2 className="size-3.5" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Debts */}
              {data.debts.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Dívidas</p>
                  <div className="border-t border-border">
                    {data.debts.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-2.5 border-b border-border py-2.5 last:border-b-0"
                      >
                        <ToggleButton
                          isPaid={d.isPaid}
                          onToggle={() => handleDebtToggle(d)}
                          label={d.isPaid ? 'Marcar como pendente' : 'Marcar como paga'}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className={cn(
                              'truncate text-sm',
                              d.isPaid && 'text-muted-foreground line-through',
                            )}
                          >
                            {d.title}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatDate(d.dueDate)}
                          </span>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 text-sm font-medium tabular-nums',
                            d.isPaid ? 'text-muted-foreground line-through' : 'text-destructive',
                          )}
                        >
                          -{formatCurrency(d.amount)}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label="Ações da dívida">
                            <MoreVertical className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditDebt(d)}>
                              <Pencil className="size-3.5" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDeleteDebt(d)} className="text-destructive focus:text-destructive">
                              <Trash2 className="size-3.5" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.debts.length === 0 && data.receivables.length === 0 && (
                <p className="text-center text-sm text-muted-foreground">
                  Nenhuma dívida ou cobrança no mês selecionado.
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
        netBalance={settlementNetBalance}
        hasPendingDebts={pendingDebtsCount > 0}
        hasPendingReceivables={pendingReceivablesCount > 0}
        createIncome={user?.createIncomeOnReceivablePaid ?? false}
        createExpense={user?.createExpenseOnDebtPaid ?? false}
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
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-sm" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{editTarget ? 'Editar pessoa' : 'Nova pessoa'}</SheetTitle>
          <SheetDescription>
            {editTarget ? 'Atualize o nome.' : 'Cadastre um contato para vincular dívidas e cobranças.'}
          </SheetDescription>
        </SheetHeader>

        <form
          id="person-form"
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col gap-4 px-6 py-5"
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

        <SheetFooter className="px-6 pb-6 pt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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

  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Person | null>(null)
  const [statementPerson, setStatementPerson] = useState<Person | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Person | null>(null)

  const { data: persons = [], isLoading } = useQuery({
    queryKey: ['persons'],
    queryFn: getPersons,
  })

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
        ) : persons.length === 0 ? (
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
      />

      {/* Delete confirm */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover pessoa</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover{' '}
              <strong className="text-foreground">{deleteTarget?.name}</strong>? As dívidas e
              cobranças vinculadas não serão excluídas, apenas desvinculadas.
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
