'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Repeat, Pause, Play, MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { apiErrorMessage } from '@/lib/api-error'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MotionRow } from '@/components/ui/motion-row'
import { SubscriptionSheet, type SubscriptionFormData } from './subscription-sheet'
import {
  getSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
} from '@/services/subscriptions.service'
import { formatCurrency, formatDate, TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { Subscription } from '@/types'

function SubscriptionRow({
  subscription,
  onEdit,
  onToggle,
  onDelete,
}: {
  subscription: Subscription
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const inactive = !subscription.isActive

  return (
    <div
      className={cn(
        'group flex min-w-0 items-center gap-3 border-b border-border/60 py-3.5 last:border-b-0 sm:gap-4',
        inactive && 'opacity-55',
      )}
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/40 sm:size-11">
        <Repeat className="size-4.5 text-muted-foreground" aria-hidden />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium leading-tight sm:text-[15px]">
            {subscription.title}
          </span>
          {inactive && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Pausada
            </span>
          )}
        </div>
        {/*
          Duas linhas com papéis distintos: primeiro o que a cobrança É (forma,
          banco, categoria), depois QUANDO acontece. Tudo numa linha só deixava
          o metadado mais consequente — a próxima cobrança — perdido no meio de
          texto do mesmo peso.
        */}
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
          <span className="shrink-0">{TRANSACTION_TYPE_LABELS[subscription.type]}</span>
          {subscription.bank && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{subscription.bank.name}</span>
            </>
          )}
          {subscription.category && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{subscription.category.name}</span>
            </>
          )}
        </div>

        {/*
          `nextCharge` vem do BACKEND, calculada pela mesma regra que decide a
          geração. Pausada não mostra data: inventar uma seria mentir sobre o
          estado — e esta era a informação que faltava para alguém notar que a
          geração havia parado.
        */}
        <div className="text-[11px] text-muted-foreground/80">
          {inactive ? (
            <span>Sem cobranças enquanto estiver pausada</span>
          ) : subscription.nextCharge ? (
            <span>
              Próxima cobrança{' '}
              <span className="text-foreground/80">
                {formatDate(subscription.nextCharge)}
              </span>
            </span>
          ) : (
            <span>Todo dia {subscription.dayOfMonth}</span>
          )}
        </div>
      </div>

      <span className="shrink-0 text-[15px] font-semibold tabular-nums tracking-[-0.02em] text-destructive">
        −{formatCurrency(Number(subscription.amount))}
      </span>

      {/* Ações — visíveis no hover em desktop, sempre acessíveis no mobile */}
      <div className="flex shrink-0 items-center gap-0.5">
        <div className="hidden gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
          <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={inactive ? 'Retomar' : 'Pausar'} title={inactive ? 'Retomar' : 'Pausar'}>
            {inactive ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Editar" title="Editar">
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Excluir" title="Excluir" className="text-muted-foreground hover:text-destructive">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="sm:hidden" aria-label="Ações" />}>
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onToggle}>
              {inactive ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {inactive ? 'Retomar' : 'Pausar'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="size-3.5" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export default function SubscriptionsPage() {
  const qc = useQueryClient()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Subscription | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Subscription | null>(null)

  const {
    data: subscriptions = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: getSubscriptions,
  })

  /** Mutações em assinatura geram transações — o resto do app precisa saber. */
  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['subscriptions'] })
    // Compromissos deriva das assinaturas ativas e ficava com dados velhos
    // ao navegar entre as duas telas.
    qc.invalidateQueries({ queryKey: ['commitments'] })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['invoices'] })
    qc.invalidateQueries({ queryKey: ['bank-invoices'] })
    qc.invalidateQueries({ queryKey: ['budget'] })
  }

  /**
   * Chave da tentativa de criação em curso.
   *
   * A mesma chave precisa sobreviver a um retry do MESMO submit — falha de
   * rede, resposta perdida, novo clique depois de um erro recuperável. Gerar
   * uma UUID por requisição anularia a idempotência: cada retry pareceria uma
   * tentativa nova e criaria outra assinatura.
   *
   * É zerada no sucesso, para que o próximo cadastro seja outra tentativa.
   */
  const creationKeyRef = useRef<string | null>(null)

  function currentCreationKey(): string {
    creationKeyRef.current ??= crypto.randomUUID()
    return creationKeyRef.current
  }

  // Fechar o drawer é responsabilidade da página, como nos demais: assim um
  // erro mantém o formulário aberto com o que foi digitado.
  const createMut = useMutation({
    mutationFn: createSubscription,
    onSuccess: (result) => {
      invalidateAll()
      setSheetOpen(false)
      // Criação confirmada: a próxima tentativa é outra tentativa, e precisa
      // de uma chave nova. Sem isto, um segundo cadastro reusaria a chave e o
      // backend devolveria a assinatura anterior.
      creationKeyRef.current = null

      const { generated, skipped, failed, failures } = result.generation

      /**
       * Falha parcial: o cadastro existe, alguns lançamentos não.
       *
       * Um toast vermelho de "erro ao criar" seria falso — a assinatura está
       * lá. E a distinção entre `failed` e `skipped` importa: o primeiro será
       * tentado de novo na próxima execução, o segundo foi descartado de
       * propósito e não volta.
       */
      if (failed > 0) {
        const reason = failures[0]?.reason
        toast.warning(
          `Assinatura criada, mas ${failed === 1 ? '1 cobrança não pôde ser gerada' : `${failed} cobranças não puderam ser geradas`}. Será tentado novamente.${reason ? ` (${reason})` : ''}`,
        )
        return
      }

      /**
       * `skipped` entra na mensagem porque o silêncio confundia: uma criação
       * retroativa cujos ciclos caíram todos em faturas já pagas mostrava
       * apenas "Assinatura criada", sem explicar por que nada foi lançado.
       *
       * A pluralização compara com 1, e não com "> 1": o padrão anterior
       * produzia "0 cobrança" justamente no caso em que tudo foi pulado.
       */
      const parts: string[] = []
      if (generated > 0) {
        parts.push(
          `${generated} ${generated === 1 ? 'lançamento gerado' : 'lançamentos gerados'}`,
        )
      }
      if (skipped > 0) {
        // "Pulado" e não "pendente": fatura paga descarta o ciclo em
        // definitivo, e prometer nova tentativa seria enganoso.
        parts.push(
          `${skipped} ${skipped === 1 ? 'pulado' : 'pulados'} (fatura já paga)`,
        )
      }

      toast.success(
        result.alreadyExisted
          ? 'Assinatura já havia sido criada'
          : parts.length > 0
            ? `Assinatura criada — ${parts.join(' · ')}`
            : 'Assinatura criada',
      )
    },
    onError: (error) =>
      toast.error(
        apiErrorMessage(error, 'Erro ao criar assinatura — verifique sua conexão e tente novamente'),
      ),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateSubscription>[1] }) =>
      updateSubscription(id, payload),
    onSuccess: (_data, variables) => {
      invalidateAll()
      setSheetOpen(false)
      setEditTarget(null)
      /**
       * O toast nomeia o que mudou.
       *
       * "Assinatura atualizada" não dizia se ela ficou ativa ou pausada — e o
       * estado alternado é a única informação que importa quando a ação foi um
       * toggle. Edição de campos segue com a mensagem genérica.
       */
      if (variables.payload.isActive === true) {
        toast.success('Assinatura reativada')
      } else if (variables.payload.isActive === false) {
        toast.success(
          'Assinatura pausada — os lançamentos já criados permanecem',
        )
      } else {
        toast.success('Assinatura atualizada')
      }
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao atualizar assinatura')),
  })

  const deleteMut = useMutation({
    mutationFn: deleteSubscription,
    onSuccess: () => {
      invalidateAll()
      setDeleteTarget(null)
      toast.success('Assinatura excluída')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, 'Erro ao excluir assinatura')),
  })

  const monthlyTotal = useMemo(
    () =>
      subscriptions
        .filter((s) => s.isActive)
        .reduce((sum, s) => sum + Number(s.amount), 0),
    [subscriptions],
  )

  const activeCount = subscriptions.filter((s) => s.isActive).length

  async function handleSubmit(data: SubscriptionFormData) {
    if (editTarget) {
      // `startedAt` fica de fora: é imutável, e o backend o ignora de todo modo.
      const { title, bankId, categoryId, type, amount, description, dayOfMonth } =
        data
      await updateMut.mutateAsync({
        id: editTarget.id,
        payload: {
          title,
          bankId,
          categoryId,
          type,
          amount,
          description,
          dayOfMonth,
        },
      })
    } else {
      // A chave acompanha a tentativa: um retry do mesmo submit reusa a mesma
      // e o backend devolve a assinatura já criada em vez de duplicá-la.
      await createMut.mutateAsync({ ...data, creationKey: currentCreationKey() })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Assinaturas</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Cobranças que se repetem todo mês
            </p>
          </div>
          <Button onClick={() => { setEditTarget(null); setSheetOpen(true) }}>
            <Plus className="size-4" />
            Nova assinatura
          </Button>
        </div>
        {!isLoading && activeCount > 0 && (
          <p className="mt-1.5 text-sm">
            <span className="text-muted-foreground">Por mês </span>
            <span className="font-medium tabular-nums tracking-[-0.01em] text-destructive">
              {formatCurrency(monthlyTotal)}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              · {activeCount} ativa{activeCount > 1 ? 's' : ''}
            </span>
          </p>
        )}
      </div>

      {/* List */}
      {/* Falha de API não pode parecer "nenhuma assinatura". */}
      {isError ? (
        <QueryError
          message="Não foi possível carregar as assinaturas"
          isFetching={isFetching}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border/60 py-3.5">
              <Skeleton className="size-10 shrink-0 rounded-xl sm:size-11" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      ) : subscriptions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-muted/40">
            <Repeat className="size-7 text-muted-foreground" />
          </div>
          <p className="text-base font-semibold">Ainda sem assinaturas</p>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
            Cadastre o que você paga todo mês — Netflix, Spotify, academia — e o
            lançamento aparece sozinho na data certa.
          </p>
          <Button className="mt-5" onClick={() => { setEditTarget(null); setSheetOpen(true) }}>
            <Plus className="size-4" />
            Nova assinatura
          </Button>
        </div>
      ) : (
        <div>
          {subscriptions.map((s, i) => (
            <MotionRow key={s.id} index={i}>
              <SubscriptionRow
                subscription={s}
                onEdit={() => { setEditTarget(s); setSheetOpen(true) }}
                onToggle={() =>
                  updateMut.mutate({ id: s.id, payload: { isActive: !s.isActive } })
                }
                onDelete={() => setDeleteTarget(s)}
              />
            </MotionRow>
          ))}
        </div>
      )}

      <SubscriptionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editSubscription={editTarget}
        onSubmit={handleSubmit}
      />

      {/* A descrição já era precisa sobre o efeito real (os lançamentos
          existentes permanecem) — preservada como está. */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Excluir assinatura"
        description={
          <>
            <strong className="text-foreground">{deleteTarget?.title}</strong> deixa
            de gerar novos lançamentos. Os que já foram criados continuam no
            extrato.
          </>
        }
        isPending={deleteMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />
    </div>
  )
}
