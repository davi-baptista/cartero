'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { apiErrorMessage } from '@/lib/api-error'
import { MotionRow } from '@/components/ui/motion-row'
import {
  FinancialListRow,
  ROW_AMOUNT_CLASS,
  ROW_AMOUNT_TONE,
  ROW_ICON_BG_CLASS,
  ROW_ICON_CLASS,
  ROW_TRAILING_META_CLASS,
} from '@/components/ui/financial-list-row'
import { SubscriptionDetailDrawer } from './subscription-detail-drawer'
import { useDetailNavigation } from '@/lib/detail-navigation'
import { useDetailEntity } from '@/lib/use-detail-entity'
import { useDetailTaskAnchor } from '@/lib/use-detail-task-anchor'
import { SubscriptionSheet, type SubscriptionFormData } from './subscription-sheet'
import {
  getSubscription,
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
  onView,
}: {
  subscription: Subscription
  /** A row inteira é navegação: identifica e abre. Administrar é do drawer. */
  onView: (s: Subscription) => void
}) {
  const inactive = !subscription.isActive

  return (
    <FinancialListRow
      onView={() => onView(subscription)}
      ariaLabel={`Ver detalhes de ${subscription.title}`}
      /* Pausada perde ênfase — a lista inteira, não só um campo. */
      className={cn(inactive && 'opacity-55')}
      leading={
        <div className={cn(ROW_ICON_CLASS, ROW_ICON_BG_CLASS)}>
          <Repeat className="size-4.5 text-muted-foreground sm:size-5" aria-hidden />
        </div>
      }
      title={subscription.title}
      titleAdornment={
        inactive ? (
          <span className="inline-flex shrink-0 items-center rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Pausada
          </span>
        ) : null
      }
      meta={
        <>
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
        </>
      }
      trailing={
        <>
          <span className={cn(ROW_AMOUNT_CLASS, ROW_AMOUNT_TONE.out)}>
            −{formatCurrency(Number(subscription.amount))}
          </span>
          {/*
            `nextCharge` vem do BACKEND, pela mesma regra que decide a geração.
            Pausada não mostra data: inventar uma seria mentir sobre o estado.
          */}
          <span className={ROW_TRAILING_META_CLASS}>
            {inactive
              ? 'Pausada'
              : subscription.nextCharge
                ? formatDate(subscription.nextCharge)
                : `Todo dia ${subscription.dayOfMonth}`}
          </span>
        </>
      }
      trailingCompact={
        <span className={cn(ROW_AMOUNT_CLASS, ROW_AMOUNT_TONE.out)}>
          −{formatCurrency(Number(subscription.amount))}
        </span>
      }
    />
  )
}

export default function SubscriptionsPage() {
  const qc = useQueryClient()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Subscription | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Subscription | null>(null)
  /*
    Assinatura cujo detalhe está aberto. Guarda o objeto, não o id: a lista
    pode ser refiltrada com o drawer aberto, e reencontrar por id devolveria
    `undefined` no meio do uso.
  */
  /*
    A identidade do detalhe vem da URL — `?subscriptionId=`. Antes era um
    `useState` com a assinatura inteira: o Back saía da página, o refresh
    perdia o painel, e o link não podia ser compartilhado.
  */
  const detail = useDetailNavigation('subscriptionId')

  /*
    ── Uma tarefa está sobreposta ao detalhe ──

    DERIVADO dos states de tarefa: um flag próprio precisaria ser limpo em
    cada saída — cancelar, salvar, erro, Escape — e esquecer uma delas
    deixaria o painel invisível para sempre.

    Só esconde. A identidade segue na URL, então cancelar volta à mesma
    assinatura e o refresh restaura o contexto.
  */


  const taskOpen = sheetOpen || deleteTarget !== null

  /*
    Fecha SOMENTE as tarefas transientes desta página.

    Nada de filtro, busca, cache ou URL: a navegação que disparou isto já
    aconteceu, e mexer nela de novo atropelaria o usuário.
  */
  const closeTransientTasks = () => {
    setSheetOpen(false)
    setEditTarget(null)
    setDeleteTarget(null)
  }

  /*
    ── A tarefa lembra de qual detalhe nasceu ──

    Sem isto, o Back apaga o `?subscriptionId=` e o formulário fica flutuando
    sobre a lista, ancorado a uma assinatura que já não está aberta.

    A regra ingênua — "sumiu o id, feche tudo" — não serve: "Nova assinatura"
    abre o mesmo `sheetOpen` sem nenhum id, e fecharia na cara do usuário.
  */
  const taskAnchor = useDetailTaskAnchor({
    detailId: detail.openId,
    taskOpen,
    onOrphaned: closeTransientTasks,
  })



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
  /*
    A lista já carregada resolve o clique sem requisição; a busca por id cobre
    link direto e refresh. Id que não resolve limpa o param em vez de deixar o
    painel vazio.
  */
  const { entity: detailEntity } = useDetailEntity({
    openId: detail.openId,
    fromList: subscriptions.find((s) => s.id === detail.openId),
    fetchById: getSubscription,
    queryKey: 'subscription',
    onNotFound: detail.close,
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
      /*
        Só o SUCESSO limpa a URL. Falha mantém o param: o registro continua
        existindo, e o usuário volta ao detalhe dele em vez de a uma lista sem
        contexto nenhum.
      */
      detail.close()
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
          <Button onClick={() => {
            taskAnchor.beginStandalone()
            setEditTarget(null)
            setSheetOpen(true)
          }}>
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
          <Button className="mt-5" onClick={() => {
            taskAnchor.beginStandalone()
            setEditTarget(null)
            setSheetOpen(true)
          }}>
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
                onView={(sub) => detail.open(sub.id)}
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

      {/*
        Toda ação fecha o detalhe antes de abrir o próprio diálogo: dois
        overlays empilhados disputariam o foco, e o de baixo continuaria
        mostrando o estado velho depois que a ação terminasse.

        Os handlers são os MESMOS que a row usava — pausar segue direto pela
        mutation, excluir continua passando pelo ConfirmDialog.
      */}
      <SubscriptionDetailDrawer
        subscription={taskOpen ? null : detailEntity}
        onOpenChange={(open) => !open && detail.close()}
        onEdit={(s) => {
          taskAnchor.beginFromDetail()
          setEditTarget(s)
          setSheetOpen(true)
        }}
        onDelete={(s) => {
          taskAnchor.beginFromDetail()
          setDeleteTarget(s)
        }}
        onToggle={(s) => {
          updateMut.mutate({ id: s.id, payload: { isActive: !s.isActive } })
        }}
      />
    </div>
  )
}
