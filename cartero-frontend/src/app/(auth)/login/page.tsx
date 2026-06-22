'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/providers/auth-provider'
import { login as loginService } from '@/services/auth.service'

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const router = useRouter()
  const { login } = useAuth()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(values: FormData) {
    try {
      const { accessToken, user } = await loginService(values.email, values.password)
      login(accessToken, user)
      router.replace('/overview')
    } catch {
      toast.error('Email ou senha incorretos')
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card px-8 py-8">
      <div className="mb-7">
        <p className="mb-2 text-sm font-semibold text-primary">Cartero</p>
        <h1 className="text-xl font-semibold tracking-tight">Entrar</h1>
        <p className="mt-1 text-sm text-muted-foreground">Acesse com seu email e senha</p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="seu@email.com"
            autoFocus
            autoComplete="email"
            className="h-11"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          {errors.email && (
            <p id="email-error" className="text-xs text-destructive">
              {errors.email.message}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <PasswordInput
            id="password"
            placeholder="••••••••"
            autoComplete="current-password"
            className="h-11"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
            {...register('password')}
          />
          {errors.password && (
            <p id="password-error" className="text-xs text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>
        <Button type="submit" className="mt-2 h-11 w-full font-semibold" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Entrando...
            </>
          ) : (
            'Entrar'
          )}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Não tem conta?{' '}
        <Link href="/register" className="text-foreground underline-offset-4 hover:underline">
          Criar conta
        </Link>
      </p>
    </div>
  )
}
