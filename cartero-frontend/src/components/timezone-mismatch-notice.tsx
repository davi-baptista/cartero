'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/providers/auth-provider'
import { updateMe } from '@/services/users.service'
import { resolveDeviceTimeZone, resolveMismatchDecision } from '@/lib/timezone-settings'

type Mismatch = { account: string; device: string }

export function TimezoneMismatchNotice() {
  const { user, updateUser } = useAuth()
  const queryClient = useQueryClient()
  const [mismatch, setMismatch] = useState<Mismatch | null>(null)
  /*
    Par account->device já decidido nesta montagem lógica — ver
    `resolveMismatchDecision` para o porquê (Strict Mode do React, dev only).
  */
  const shownForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!user?.timeZone) {
      setMismatch(null)
      return
    }

    const check = () => {
      const device = resolveDeviceTimeZone()
      const decision = resolveMismatchDecision(user.id, user.timeZone, device, shownForRef.current)

      if (!decision.show) {
        setMismatch(null)
        return
      }

      shownForRef.current = `${decision.mismatch.account}->${decision.mismatch.device}`
      setMismatch(decision.mismatch)
    }

    check()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [user?.id, user?.timeZone])

  if (!mismatch) return null

  const accept = async () => {
    try {
      const updated = await updateMe({ timeZone: mismatch.device })
      updateUser(updated)
      await queryClient.invalidateQueries()
      setMismatch(null)
      toast.success(`Timezone atualizada para ${mismatch.device}`)
    } catch {
      toast.error('Não foi possível atualizar a timezone')
    }
  }

  return (
    <aside className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-muted/50 px-4 py-3 text-sm">
      <p>
        O dispositivo está em <strong>{mismatch.device}</strong>, mas sua conta usa{' '}
        <strong>{mismatch.account}</strong>. Isso afeta datas financeiras e horários de notificações.
      </p>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={() => void accept()}>Atualizar</Button>
        <Button size="sm" variant="ghost" onClick={() => setMismatch(null)}>Manter atual</Button>
      </div>
    </aside>
  )
}
