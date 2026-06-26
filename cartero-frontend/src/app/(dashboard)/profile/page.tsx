'use client'

import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/providers/auth-provider'
import { updateMe } from '@/services/users.service'
import { formatCurrency } from '@/lib/formatters'

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

  const [name, setName] = useState(user?.name ?? '')
  const [salary, setSalary] = useState(
    user?.salary != null ? String(Number(user.salary)) : '',
  )
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Sync form when user changes (e.g. on mount if context hydrates after render)
  useEffect(() => {
    if (user) {
      setName(user.name)
      setSalary(user.salary != null ? String(Number(user.salary)) : '')
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

  const salaryMut = useMutation({
    mutationFn: () => updateMe({ salary: parseFloat(salary) }),
    onSuccess: (updated) => {
      updateUser(updated)
      toast.success('Salário atualizado')
    },
    onError: () => toast.error('Não foi possível atualizar o salário'),
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

  const parsedSalary = salary !== '' ? parseFloat(salary) : null
  const currentSalary = user.salary != null ? Number(user.salary) : null
  const salaryUnchanged = parsedSalary === currentSalary
  const salaryInvalid = salary !== '' && (isNaN(parsedSalary!) || parsedSalary! < 0)

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
          title="Salário"
          description="Usado para calcular o saldo disponível na página de orçamento"
          footer={
            <Button
              size="sm"
              onClick={() => salaryMut.mutate()}
              disabled={
                salaryMut.isPending ||
                salary === '' ||
                salaryInvalid ||
                salaryUnchanged
              }
            >
              {salaryMut.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          }
        >
          <Field label="Salário mensal">
            <div className="flex">
              <span className="flex h-8 items-center rounded-l-lg border border-r-0 border-input bg-muted/40 px-3 text-sm text-muted-foreground select-none">
                R$
              </span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                placeholder="0,00"
                className="h-8 rounded-l-none text-sm"
              />
            </div>
            {currentSalary != null && (
              <p className="text-[11px] text-muted-foreground/60">
                Atual: {formatCurrency(currentSalary)}
              </p>
            )}
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
      </div>
    </div>
  )
}
