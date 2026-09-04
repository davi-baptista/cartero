'use client'

import { useEffect, useMemo } from 'react'
import { useForm, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getInvoiceCloseDate,
  getInvoiceDueDate,
} from '@/lib/invoice-dates'
import { formatDate, formatMonthYear } from '@/lib/formatters'
import { formatDateValue } from '@/lib/date'
import type { Bank } from '@/types'

const numberField = (message: string) => z.preprocess(
  (v) => (v === '' || v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v)),
  z.number({ message }).int().min(1, 'Mínimo 1').max(31, 'Máximo 31'),
)

const schema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  invoiceDueDate: numberField('Dia obrigatório'),
  invoiceDueDaysAfterClose: numberField('Informe quantos dias antes a fatura fecha'),
})

export type BankFormData = z.infer<typeof schema>

interface BankSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editTarget: Bank | null
  onSubmit: (data: BankFormData) => Promise<void>
  /**
   * Competência de referência da projeção do ciclo.
   *
   * Vem da SUPERFÍCIE que abriu o editor — o seletor de `/banks` ou a rota do
   * cartão —, nunca de `new Date()`: o mês exibido é a autoridade do app, e
   * projetar sobre outro faria o drawer falar de um ciclo que não é o da tela.
   */
  period?: { month: number; year: number }
}

export function BankSheet({
  open,
  onOpenChange,
  editTarget,
  onSubmit,
  period,
}: BankSheetProps) {
  const isEditing = editTarget !== null


  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<BankFormData>({
    resolver: zodResolver(schema) as unknown as Resolver<BankFormData>,
  })

  useEffect(() => {
    if (open) {
      if (editTarget) {
        reset({
          name: editTarget.name,
          invoiceDueDate: editTarget.invoiceDueDate,
          invoiceDueDaysAfterClose: editTarget.invoiceDueDaysAfterClose ?? 7,
        })
      } else {
        reset({ name: '', invoiceDueDate: undefined, invoiceDueDaysAfterClose: 7 })
      }
    }
  }, [open, editTarget, reset])

  /*
    A projeção segue o que está DIGITADO, não o que está salvo: o usuário
    precisa ver o efeito antes de confirmar. Enquanto o vencimento estiver
    vazio ou inválido não há ciclo a mostrar — melhor omitir a seção que
    exibir uma data inventada.
  */
  /*
    `useWatch` em vez de `watch()`: aquele devolve uma função que o React
    Compiler não consegue memoizar, e o lint avisa que valores derivados dela
    podem ficar velhos. Este é subscrição declarativa e re-renderiza sozinho.
  */
  const dueDay = useWatch({ control, name: 'invoiceDueDate' })
  const daysAfterClose = useWatch({
    control,
    name: 'invoiceDueDaysAfterClose',
  })

  const ciclo = useMemo(() => {
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return null

    const base = period ?? currentPeriod()
    const seguinte =
      base.month === 12
        ? { month: 1, year: base.year + 1 }
        : { month: base.month + 1, year: base.year }

    const projetar = (p: { month: number; year: number }) => ({
      ...p,
      close: formatDate(
        formatDateValue(
          getInvoiceCloseDate(p.year, p.month, dueDay, daysAfterClose),
        ),
      ),
      due: formatDate(
        formatDateValue(getInvoiceDueDate(p.year, p.month, dueDay)),
      ),
    })

    return { atual: projetar(base), proxima: projetar(seguinte) }
  }, [dueDay, daysAfterClose, period])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md" showCloseButton>
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>{isEditing ? 'Editar banco' : 'Novo banco'}</SheetTitle>
          <SheetDescription>
            {isEditing ? 'Atualize os dados do banco.' : 'Preencha os dados para registrar um novo banco.'}
          </SheetDescription>
        </SheetHeader>

        <form
          id="bank-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="bank-name">Nome</Label>
            <Input
              id="bank-name"
              placeholder="Ex: Nubank, Itaú, Bradesco..."
              aria-invalid={!!errors.name}
              {...register('name')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invoice-due-date">Dia de vencimento da fatura</Label>
            <Input
              id="invoice-due-date"
              type="number"
              min={1}
              max={31}
              placeholder="Ex: 6"
              aria-invalid={!!errors.invoiceDueDate}
              {...register('invoiceDueDate', { valueAsNumber: true })}
            />
            {errors.invoiceDueDate && (
              <p className="text-xs text-destructive">{errors.invoiceDueDate.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invoice-due-days-after-close">A fatura fecha quantos dias antes?</Label>
            <Input
              id="invoice-due-days-after-close"
              type="number"
              min={1}
              max={31}
              placeholder="Ex: 7"
              aria-invalid={!!errors.invoiceDueDaysAfterClose}
              {...register('invoiceDueDaysAfterClose', { valueAsNumber: true })}
            />
            <p className="text-xs text-muted-foreground">
              Normalmente são alguns dias antes do vencimento. O Cartero calcula a data exata de cada fatura.
            </p>
            {errors.invoiceDueDaysAfterClose && (
              <p className="text-xs text-destructive">{errors.invoiceDueDaysAfterClose.message}</p>
            )}
          </div>

          {/*
            ── O que a configuração PRODUZ ──

            Os dois campos acima são abstratos ("dia 6", "7 dias antes"), e o
            usuário precisa de datas para conferir se acertou. Esta seção
            projeta o ciclo — e acompanha o que ele digita, então o efeito de
            uma mudança aparece antes de salvar.

            Read-only de propósito: fechamento é DERIVADO do vencimento menos o
            intervalo. Transformá-lo em input criaria um terceiro número capaz
            de contradizer os outros dois.
          */}
          {ciclo && (
            <div className="border-t border-border pt-4">
              <p className="text-[11px] font-medium text-muted-foreground">
                Ciclo projetado
              </p>

              <div className="mt-2 space-y-1.5">
                <CycleRow
                  label="Fatura de"
                  value={capitalize(
                    formatMonthYear(ciclo.atual.month, ciclo.atual.year),
                  )}
                />
                <CycleRow label="Fecha em" value={ciclo.atual.close} />
                <CycleRow label="Vence em" value={ciclo.atual.due} />
              </div>

              <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                <CycleRow
                  label="Próxima"
                  value={capitalize(
                    formatMonthYear(ciclo.proxima.month, ciclo.proxima.year),
                  )}
                />
                <CycleRow label="Fecha em" value={ciclo.proxima.close} />
                <CycleRow label="Vence em" value={ciclo.proxima.due} />
              </div>

              {/*
                O boundary explicitado. Sem esta frase o usuário não tem como
                saber, pela tela, em qual fatura cai uma compra feita no
                próprio dia do fechamento — e é a dúvida mais comum sobre a
                configuração.

                O cutoff é EXCLUSIVO: o dia do fechamento já pertence ao ciclo
                seguinte. A frase mudou junto com a policy.
              */}
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Compras feitas no dia do fechamento entram na próxima fatura.
              </p>
            </div>
          )}
        </form>

        <SheetFooter className="px-6 pb-6 pt-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="bank-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isEditing ? 'Salvar alterações' : 'Criar banco'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Uma linha da projeção: rótulo à esquerda, valor à direita.
 *
 * Mesma anatomia do `DetailRow` dos drawers de detalhe — dois lados, sem
 * moldura própria. Um card aqui criaria caixa dentro de caixa.
 */
function CycleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-xs tabular-nums">{value}</span>
    </div>
  )
}

/** A competência de hoje, quando a superfície não informa uma. */
function currentPeriod(): { month: number; year: number } {
  const hoje = new Date()
  return { month: hoje.getMonth() + 1, year: hoje.getFullYear() }
}

function capitalize(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}
