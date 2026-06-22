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
  X,
  Check,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { DatePicker } from '@/components/ui/date-picker'
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
  getPersons,
  createPerson,
  updatePerson,
  deletePerson,
  getPersonStatement,
} from '@/services/persons.service'
import { updateDebt } from '@/services/debts.service'
import { updateReceivable } from '@/services/receivables.service'
import { formatCurrency, formatDate } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { Person, Debt, Receivable } from '@/types'

// ─── Statement sheet ─────────────────────────────────────────────────────────

function ToggleButton({
  isPaid,
  onToggle,
  label,
}: {
  isPaid: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.85 }}
      transition={{ duration: 0.1 }}
      onClick={onToggle}
      aria-label={label}
      title={label}
      className="group/dot flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/50 ring-1 ring-border/50 transition-colors hover:bg-muted hover:ring-border"
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

  function defaultStart() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }
  function defaultEnd() {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
  }

  const [startDate, setStartDate] = useState<string | undefined>(defaultStart)
  const [endDate, setEndDate] = useState<string | undefined>(defaultEnd)

  useEffect(() => {
    if (person) {
      setStartDate(defaultStart())
      setEndDate(defaultEnd())
    }
  }, [person?.id])

  const { data, isLoading } = useQuery({
    queryKey: ['person-statement', person?.id, startDate, endDate],
    queryFn: () => getPersonStatement(person!.id, { startDate, endDate }),
    enabled: !!person,
  })

  const toggleDebtMut = useMutation({
    mutationFn: ({ id, isPaid }: { id: string; isPaid: boolean }) =>
      updateDebt(id, { isPaid }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['person-statement', person?.id] })
      qc.invalidateQueries({ queryKey: ['debts'] })
    },
    onError: () => toast.error('Erro ao atualizar — tente novamente'),
  })

  const toggleReceivableMut = useMutation({
    mutationFn: ({ id, isPaid }: { id: string; isPaid: boolean }) =>
      updateReceivable(id, { isPaid }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['person-statement', person?.id] })
      qc.invalidateQueries({ queryKey: ['receivables'] })
    },
    onError: () => toast.error('Erro ao atualizar — tente novamente'),
  })

  const netBalance = data?.netBalance ?? 0
  const isPositive = netBalance >= 0
  const hasFilters = !!(startDate || endDate)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{person?.name}</SheetTitle>
          <SheetDescription>Extrato consolidado de dívidas e cobranças</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          {/* Date filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-36">
              <DatePicker value={startDate} onChange={setStartDate} placeholder="Data início" />
            </div>
            <div className="w-36">
              <DatePicker value={endDate} onChange={setEndDate} placeholder="Data fim" />
            </div>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setStartDate(undefined); setEndDate(undefined) }}
                className="gap-1 text-muted-foreground"
              >
                <X className="size-3.5" />
                Limpar
              </Button>
            )}
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
                <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
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
                          onToggle={() => toggleReceivableMut.mutate({ id: r.id, isPaid: !r.isPaid })}
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
                          onToggle={() => toggleDebtMut.mutate({ id: d.id, isPaid: !d.isPaid })}
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
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.debts.length === 0 && data.receivables.length === 0 && (
                <p className="text-center text-sm text-muted-foreground">
                  Nenhuma dívida ou cobrança{hasFilters ? ' no período selecionado' : ` vinculada a ${person?.name}`}.
                </p>
              )}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
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
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) setName(editTarget?.name ?? '')
  }, [open, editTarget])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await onSubmit(name.trim())
      setName('')
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
    mutationFn: (name: string) => createPerson({ name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      setFormOpen(false)
      toast.success('Pessoa criada')
    },
    onError: () => toast.error('Erro ao criar pessoa — tente novamente'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updatePerson(id, { name }),
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

  async function handleFormSubmit(name: string) {
    if (editTarget) {
      await updateMut.mutateAsync({ id: editTarget.id, name })
    } else {
      await createMut.mutateAsync(name)
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
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    onClick={() => setStatementPerson(person)}
                  >
                    <span className="truncate text-sm font-medium">{person.name}</span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
                  </button>

                  {/* Actions */}
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
