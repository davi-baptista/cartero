'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Users, ChevronRight, Loader2, MoreVertical, TriangleAlert, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  periodFromDate,
} from '@/components/month-nav'
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
import {
} from '@/services/debts.service'
import {
  getPersons,
  createPerson,
  updatePerson,
  deletePerson,
} from '@/services/persons.service'
import {
} from '@/services/receivables.service'
import {
} from '@/lib/person-settlement-view'
import {
} from '@/lib/person-statement'
import { PersonStatementDrawer } from '@/components/person-statement-drawer'
import type { Person } from '@/types'

// ─── Statement sheet ─────────────────────────────────────────────────────────

/**
 * Uma linha de pendência ou de histórico no extrato da pessoa.
 *
 * As duas listas (cobranças e dívidas) tinham blocos JSX quase idênticos
 * repetidos inline, divergindo só no sinal, na cor e nos rótulos de ação.
 */



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
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-foreground" />
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
      <PersonStatementDrawer
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
