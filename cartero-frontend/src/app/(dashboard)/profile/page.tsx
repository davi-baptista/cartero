'use client'

import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/providers/auth-provider'
import { updateMe } from '@/services/users.service'
import { getSalary, upsertSalary } from '@/services/salary.service'
import { SalaryHistorySheet } from '../budget/salary-history-sheet'
import {
  getPublicKey,
  subscribePush,
  unsubscribePush,
  getSubscriptionStatus,
} from '@/services/notifications.service'
import {
  enablePushNotifications,
  disablePushNotifications,
  getExistingPushSubscription,
  rollbackPushSubscription,
  isBraveBrowser,
  isPushSupported,
} from '@/lib/push'
import {
  pushToggleState,
  isToggleChecked,
  isToggleDisabled,
  pushToggleHint,
  shouldDiscardLocalBeforeEnabling,
  enableOutcome,
  type PushToggleState,
} from '@/lib/push-toggle-state'
import { pushErrorMessage } from '@/lib/push-error-copy'
import { formatCurrency } from '@/lib/formatters'
import { MaintenanceMode } from './maintenance-mode'

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: string
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/30">
      <div className="px-5 pt-5 pb-4">
        <p className="text-[15px] font-semibold tracking-tight">{title}</p>
        {description && (
          <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
        )}
        <div className="mt-4 flex flex-col gap-4">{children}</div>
      </div>
      <div className="flex justify-end border-t border-border px-5 py-3">
        {footer}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { user, updateUser } = useAuth()
  const qc = useQueryClient()

  const [name, setName] = useState(user?.name ?? '')
  /*
    A renda ATUAL é resolvida pela competência corrente, não lida de
    `User.salary`.

    O cache só é reescrito quando alguma ação do usuário afeta o mês corrente.
    Com histórico ago=5000 e out=5500, ao virar outubro nenhuma escrita
    acontece: o cache continuaria 5000 e esta tela mostraria um valor que já
    não vale. O resolver não tem esse problema — ele responde pela data.
  */
  const currentMonth = useMemo(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  }, [])

  const { data: resolvedSalary, isLoading: salaryLoading } = useQuery({
    queryKey: ['salary', currentMonth.year, currentMonth.month],
    queryFn: () => getSalary(currentMonth.year, currentMonth.month),
  })

  /*
    `null` = o usuário ainda não digitou nada; o campo mostra a renda
    resolvida. Derivar em render evita o `setState` dentro de efeito (que
    dispara render em cascata e faz o campo piscar o valor antigo).
  */
  const [salaryDraft, setSalaryDraft] = useState<number | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  /** Valor exibido: o rascunho, ou a renda que vale hoje. */
  const salary = salaryDraft ?? resolvedSalary?.amount ?? 0
  const [createIncomeOnReceivablePaid, setCreateIncomeOnReceivablePaid] = useState(
    user?.createIncomeOnReceivablePaid ?? false,
  )
  const [createExpenseOnDebtPaid, setCreateExpenseOnDebtPaid] = useState(
    user?.createExpenseOnDebtPaid ?? false,
  )
  const [notifyDaysBefore, setNotifyDaysBefore] = useState(
    user?.notifyDaysBefore ?? 3,
  )
  /**
   * Verdade do device atual: inscrição local + registro no backend para ESTE
   * endpoint. `checking` é o estado inicial — antes de reconciliar não há o que
   * afirmar, e exibir ON prematuramente é justamente a mentira que esta
   * rodada remove.
   */
  const [localEndpoint, setLocalEndpoint] = useState<string | null>(null)
  const [backendRegistered, setBackendRegistered] = useState<boolean | null>(null)
  const [pushChecking, setPushChecking] = useState(true)
  const [pushSupported, setPushSupported] = useState(true)
  const [pushPermission, setPushPermission] =
    useState<NotificationPermission>('default')
  const [pushBusy, setPushBusy] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  /**
   * Reconciliação no mount.
   *
   * Antes bastava `getExistingPushSubscription() !== null`. Isso responde "o
   * PushManager deste browser tem uma inscrição?", que não prova que o backend
   * ainda a tem — ele a remove sem log quando o push service responde
   * `404/410`. Agora a inscrição local só vira ON depois que o servidor
   * confirma o MESMO endpoint.
   *
   * A consulta ao backend só acontece quando existe inscrição local: sem ela o
   * device já está OFF e não há endpoint a perguntar.
   */
  useEffect(() => {
    let cancelled = false

    async function reconcile() {
      if (!isPushSupported()) {
        if (!cancelled) {
          setPushSupported(false)
          setPushChecking(false)
        }
        return
      }

      if (typeof Notification !== 'undefined' && !cancelled) {
        setPushPermission(Notification.permission)
      }

      try {
        const subscription = await getExistingPushSubscription()
        if (cancelled) return

        if (subscription === null) {
          setLocalEndpoint(null)
          setBackendRegistered(null)
          return
        }

        setLocalEndpoint(subscription.endpoint)
        const registered = await getSubscriptionStatus(subscription.endpoint)
        if (!cancelled) setBackendRegistered(registered)
      } catch {
        /**
         * Falha ao reconciliar não pode virar ON. Sem confirmação do servidor
         * o device é tratado como não registrado — o erro aparece se o usuário
         * tentar ativar.
         */
        if (!cancelled) setBackendRegistered(false)
      } finally {
        if (!cancelled) setPushChecking(false)
      }
    }

    void reconcile()
    return () => {
      cancelled = true
    }
  }, [])

  const pushState: PushToggleState = pushToggleState({
    supported: pushSupported,
    permission: pushPermission,
    localEndpoint,
    backendRegistered,
    checking: pushChecking,
  })
  const pushHint = pushToggleHint(pushState)

  // Sync form when user changes (e.g. on mount if context hydrates after render)
  useEffect(() => {
    if (user) {
      setName(user.name)

      setCreateIncomeOnReceivablePaid(user.createIncomeOnReceivablePaid ?? false)
      setCreateExpenseOnDebtPaid(user.createExpenseOnDebtPaid ?? false)
      setNotifyDaysBefore(user.notifyDaysBefore ?? 3)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const nameMut = useMutation({
    mutationFn: () => updateMe({ name: name.trim() }),
    onSuccess: (updated) => {
      updateUser(updated)
      toast.success('Nome atualizado')
    },
    onError: () => toast.error('Não foi possível atualizar o nome'),
  })

  /**
   * Salvar aqui significa "esta é minha renda a partir deste mês".
   *
   * Antes gravava `User.salary` direto, e o Orçamento usava esse valor para
   * calcular QUALQUER mês — então corrigir a renda hoje reescrevia a sobra de
   * meses já encerrados. Agora a alteração cria/atualiza a entrada do mês
   * corrente no histórico, e os meses anteriores ficam intactos.
   *
   * O usuário não precisa entender o histórico para fazer uma alteração
   * simples: o formulário continua sendo um campo e um botão.
   */
  const salaryMut = useMutation({
    mutationFn: () => {
      const now = new Date()
      return upsertSalary({
        amount: salary,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      })
    },
    onSuccess: (result) => {
      // `User.salary` é sincronizado no backend quando a alteração afeta o mês
      // corrente — que é sempre o caso aqui.
      // Merge: `updateUser` espera o usuário completo, e só a renda mudou.
      if (user) {
        updateUser({
          ...user,
          salary: result.currentSalary.amount ?? undefined,
        })
      }
      void qc.invalidateQueries({ queryKey: ['budget'] })
      void qc.invalidateQueries({ queryKey: ['salary'] })
      // Esta ação cria/atualiza a entrada do mês corrente no histórico.
      void qc.invalidateQueries({ queryKey: ['salary-history'] })
      // Volta a seguir o resolver em vez do rascunho já salvo.
      setSalaryDraft(null)
      toast.success('Renda atualizada')
    },
    onError: () => toast.error('Não foi possível atualizar a renda'),
  })

  const notifyDaysMut = useMutation({
    mutationFn: () => updateMe({ notifyDaysBefore }),
    onSuccess: (updated) => {
      updateUser(updated)
      toast.success('Preferência de notificação atualizada')
    },
    onError: () => toast.error('Não foi possível atualizar a preferência'),
  })

  const passwordMut = useMutation({
    mutationFn: () => updateMe({ password: newPassword }),
    onSuccess: () => {
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Senha atualizada')
    },
    onError: () => toast.error('Não foi possível atualizar a senha'),
  })

  const preferencesMut = useMutation({
    mutationFn: () => updateMe({ createIncomeOnReceivablePaid, createExpenseOnDebtPaid }),
    onSuccess: (updated) => {
      updateUser(updated)
      toast.success('Preferências atualizadas')
    },
    onError: () => toast.error('Não foi possível atualizar as preferências'),
  })

  async function handleTogglePush(nextEnabled: boolean) {
    setPushBusy(true)
    try {
      if (nextEnabled) {
        await enablePushForThisDevice()
      } else {
        await disablePushForThisDevice()
      }
    } finally {
      setPushBusy(false)
    }
  }

  /**
   * Ativação como transação lógica: ON só é publicado depois de
   * `pushManager.subscribe` E do registro no backend. A ordem importa — o
   * inverso deixaria o browser inscrito com o servidor sem linha, que é o
   * half-enabled que a visita seguinte leria como ON.
   */
  async function enablePushForThisDevice() {
    let created: PushSubscription | null = null

    try {
      const publicKey = await getPublicKey()

      /**
       * Inscrição local que o backend não reconhece é descartada antes de
       * pedir outra. Reenviá-la ressuscitaria o endpoint possivelmente
       * invalidado por `404/410`.
       */
      const forceFresh = shouldDiscardLocalBeforeEnabling(pushState)
      const subscription = await enablePushNotifications(publicKey, {
        forceFresh,
      })
      created = subscription

      if (typeof Notification !== 'undefined') {
        setPushPermission(Notification.permission)
      }

      await subscribePush(subscription.toJSON())

      setLocalEndpoint(subscription.endpoint)
      setBackendRegistered(true)
      toast.success('Notificações ativadas neste dispositivo')
    } catch (error) {
      /**
       * O registro no backend falhou depois da inscrição local existir:
       * desfaz, para não deixar o browser inscrito sem destino no servidor.
       * A decisão vem de `enableOutcome`, que é o que os testes vigiam.
       */
      const outcome = enableOutcome({
        localCreated: created !== null,
        backendRegistered: false,
      })
      if (outcome.rollbackLocal && created) {
        await rollbackPushSubscription(created)
      }

      const localAfter = await getExistingPushSubscription().catch(() => null)
      setLocalEndpoint(localAfter?.endpoint ?? null)
      setBackendRegistered(localAfter ? false : null)

      if (typeof Notification !== 'undefined') {
        setPushPermission(Notification.permission)
      }

      toast.error(
        pushErrorMessage(error, {
          isBrave: await isBraveBrowser(),
          permission:
            typeof Notification !== 'undefined'
              ? Notification.permission
              : 'default',
        }),
      )
    }
  }

  /**
   * Desativa APENAS este device. O backend recebe o endpoint deste browser, e
   * `deleteMany({ userId, endpoint })` não alcança as inscrições dos outros.
   */
  async function disablePushForThisDevice() {
    const endpoint = localEndpoint

    try {
      const removed = await disablePushNotifications()
      const target = removed ?? endpoint
      if (target) await unsubscribePush(target)

      setLocalEndpoint(null)
      setBackendRegistered(null)
      toast.success('Notificações desativadas neste dispositivo')
    } catch {
      /**
       * Desativação parcial (uma ponta caiu, a outra não): reconcilia contra o
       * estado real em vez de afirmar ON ou OFF por suposição.
       */
      const localAfter = await getExistingPushSubscription().catch(() => null)

      if (localAfter === null) {
        setLocalEndpoint(null)
        setBackendRegistered(null)
      } else {
        setLocalEndpoint(localAfter.endpoint)
        const registered = await getSubscriptionStatus(localAfter.endpoint).catch(
          () => false,
        )
        setBackendRegistered(registered)
      }

      toast.error('Não foi possível desativar as notificações. Tente de novo.')
    }
  }

  function handlePasswordSave() {
    if (newPassword.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem')
      return
    }
    passwordMut.mutate()
  }

  if (!user) return null

  const currentSalary = resolvedSalary?.amount ?? null
  const salaryUnchanged = salary === (currentSalary ?? 0)
  const preferencesUnchanged =
    createIncomeOnReceivablePaid === (user.createIncomeOnReceivablePaid ?? false) &&
    createExpenseOnDebtPaid === (user.createExpenseOnDebtPaid ?? false)

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Meu perfil</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Gerencie seus dados pessoais e preferências
        </p>
      </div>

      <div className="flex max-w-xl flex-col gap-4">
        {/* Dados pessoais */}
        <SectionCard
          title="Dados pessoais"
          footer={
            <Button
              size="sm"
              onClick={() => nameMut.mutate()}
              disabled={
                nameMut.isPending ||
                !name.trim() ||
                name.trim() === user.name
              }
            >
              {nameMut.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          }
        >
          <Field label="Nome">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
              className="h-8 text-sm"
              maxLength={100}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim() && name.trim() !== user.name) {
                  nameMut.mutate()
                }
              }}
            />
          </Field>
          <Field label="Email">
            <Input
              value={user.email}
              disabled
              className="h-8 text-sm"
              aria-label="Email — somente leitura"
            />
            <p className="text-[11px] text-muted-foreground/60">
              O email não pode ser alterado
            </p>
          </Field>
        </SectionCard>

        {/* Salário */}
        <SectionCard
          title="Renda mensal"
          description="Vale a partir do mês atual. Para registrar a renda de um mês anterior, use a página de Orçamento"
          footer={
            <Button
              size="sm"
              onClick={() => salaryMut.mutate()}
              disabled={salaryMut.isPending || salaryUnchanged || salaryLoading}
            >
              {salaryMut.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          }
        >
          <Field label="Renda mensal">
            <div className="flex">
              <span className="flex h-8 items-center rounded-l-lg border border-r-0 border-input bg-muted/40 px-3 text-sm text-muted-foreground select-none">
                R$
              </span>
              <CurrencyInput
                value={salary}
                onChange={setSalaryDraft}
                disabled={salaryLoading}
                className="h-8 rounded-l-none text-sm"
              />
            </div>
            {/*
              Enquanto carrega, o campo fica desabilitado: mostrar R$ 0,00
              editável convidaria o usuário a salvar um valor que ele não
              digitou, sobrescrevendo a renda real.
            */}
            {salaryLoading ? (
              <p className="text-[11px] text-muted-foreground/60">
                Carregando…
              </p>
            ) : currentSalary != null ? (
              <p className="text-[11px] text-muted-foreground/60">
                Atual: {formatCurrency(currentSalary)}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground/60">
                Nenhuma renda registrada ainda.
              </p>
            )}

            {/*
              Acesso ao histórico também aqui: "cadastrei janeiro errado" é uma
              correção de perfil tanto quanto de orçamento, e obrigar o usuário
              a descobrir a outra tela para isso seria arbitrário.
            */}
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Histórico salarial
            </button>
          </Field>
        </SectionCard>

        {/* Preferências financeiras */}
        <SectionCard
          title="Preferências financeiras"
          description="Escolha se o sistema deve criar uma transação ao marcar um valor como pago ou recebido"
          footer={
            <Button
              size="sm"
              onClick={() => preferencesMut.mutate()}
              disabled={preferencesMut.isPending || preferencesUnchanged}
            >
              {preferencesMut.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          }
        >
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/40">
            <input
              type="checkbox"
              checked={createIncomeOnReceivablePaid}
              onChange={(event) => setCreateIncomeOnReceivablePaid(event.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Criar receita ao marcar “A Receber” como recebido</span>
              <span className="text-xs text-muted-foreground">Gera uma receita vinculada ao recebimento.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/40">
            <input
              type="checkbox"
              checked={createExpenseOnDebtPaid}
              onChange={(event) => setCreateExpenseOnDebtPaid(event.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Criar gasto ao marcar “Dívidas” como paga</span>
              <span className="text-xs text-muted-foreground">Gera um gasto no banco e na forma de pagamento escolhidos.</span>
            </span>
          </label>
        </SectionCard>

        {/* Notificações */}
        <SectionCard
          title="Notificações"
          description="Receba um aviso no celular quando algo estiver vencendo"
          footer={
            <Button
              size="sm"
              onClick={() => notifyDaysMut.mutate()}
              disabled={notifyDaysMut.isPending || notifyDaysBefore === (user.notifyDaysBefore ?? 3)}
            >
              {notifyDaysMut.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          }
        >
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/40">
            <input
              type="checkbox"
              checked={isToggleChecked(pushState)}
              disabled={isToggleDisabled(pushState, pushBusy)}
              aria-describedby={pushHint ? 'push-toggle-hint' : undefined}
              onChange={(event) => handleTogglePush(event.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Ativar notificações push</span>
              <span className="text-xs text-muted-foreground">
                {pushState === 'checking'
                  ? 'Verificando o registro deste dispositivo…'
                  : 'Avisa mesmo com o app fechado. Pede permissão do navegador na primeira vez.'}
              </span>
              {pushHint ? (
                <span
                  id="push-toggle-hint"
                  className={
                    pushState === 'mismatch'
                      ? 'text-xs text-pending'
                      : 'text-xs text-muted-foreground'
                  }
                >
                  {pushHint}
                </span>
              ) : null}
            </span>
          </label>
          <Field label="Avisar com quantos dias de antecedência">
            <Input
              type="number"
              min={1}
              max={30}
              value={notifyDaysBefore}
              onChange={(e) => setNotifyDaysBefore(Number(e.target.value))}
              className="h-8 w-24 text-sm"
            />
          </Field>
        </SectionCard>

        {/* Senha */}
        <SectionCard
          title="Senha"
          footer={
            <Button
              size="sm"
              onClick={handlePasswordSave}
              disabled={
                passwordMut.isPending || !newPassword || !confirmPassword
              }
            >
              {passwordMut.isPending ? 'Salvando…' : 'Alterar senha'}
            </Button>
          }
        >
          <Field label="Nova senha">
            <div className="relative">
              <Input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="h-8 pr-8 text-sm"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={showNew ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showNew ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </Field>
          <Field label="Confirmar nova senha">
            <div className="relative">
              <Input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a nova senha"
                className="h-8 pr-8 text-sm"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={showConfirm ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showConfirm ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </button>
            </div>
          </Field>
        </SectionCard>

        <MaintenanceMode />
      </div>

      <SalaryHistorySheet open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  )
}
