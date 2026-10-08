'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createCategory } from '@/services/categories.service'
import type { Category } from '@/types'

export function InlineCategoryCreate({ onCreated }: { onCreated: (category: Category) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const reset = () => { setExpanded(false); setName('') }
  const mutation = useMutation({
    mutationFn: createCategory,
    onSuccess: (created) => {
      queryClient.setQueryData<Category[]>(['categories'], (old) => [...(old ?? []), created])
      void queryClient.invalidateQueries({ queryKey: ['categories'] })
      onCreated(created)
      reset()
    },
    onError: () => toast.error('Não foi possível criar a categoria.'),
  })
  const confirm = () => { if (name.trim()) mutation.mutate({ name: name.trim() }) }
  if (!expanded) return <button type="button" onClick={() => { setExpanded(true); setTimeout(() => nameRef.current?.focus(), 0) }} className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"><Plus className="size-3" />Criar categoria</button>
  return <div className="flex gap-1.5">
    <Input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome da categoria" aria-label="Nome da categoria" className="h-8 text-sm" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); confirm() } if (event.key === 'Escape') reset() }} />
    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={!name.trim() || mutation.isPending} onClick={confirm} aria-label="Confirmar">{mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}</Button>
    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={reset} aria-label="Cancelar"><X className="size-3.5" /></Button>
  </div>
}
