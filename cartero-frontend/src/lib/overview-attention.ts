import { InvoiceStatus } from '@/types'
import type { Bank, Debt, Invoice, Receivable } from '@/types'
import { parseInvoiceDate } from '@/lib/invoice-dates'
import { formatDateValue, parseDateOnly } from '@/lib/date'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * "Atenção agora" — seleção pura
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Extraído do `overview/page.tsx` (Overview Agenda V1) sem alterar
 * comportamento — era lógica inline dentro de `useMemo`s do componente, sem
 * cobertura própria. Este módulo só reorganiza; nenhuma regra de seleção,
 * ordenação, limite ou amount semantics mudou.
 *
 * Responde: "o que ainda exige minha atenção NESTE MOMENTO?" — sempre
 * relativo a HOJE, independente de qual mês está selecionado no calendário
 * da mesma tela. Isso é proposital e continua sendo: uma dívida vencida em
 * junho, vista em setembro, continua aqui.
 *
 * Nota sobre "hoje" (Temporal Stabilization V1): `attentionDueUrgency`
 * tratava "vence hoje" como `overdue`, divergindo de `settlementStatus`
 * (Calendário) e das authorities de backend (Invoice, Debt/Receivable),
 * que sempre trataram o dia do vencimento como AINDA não vencido — há o
 * dia inteiro para resolver. Essa divergência foi corrigida: agora
 * `dueDate < today` é a única condição de `overdue`; `dueDate === today`
 * é `urgent` (mesmo rótulo/cor de "vence em breve", sem taxonomia nova).
 *
 * `today` é injetável em toda função exportada (mesmo padrão de
 * `invoice-timing.ts`) para permitir testes determinísticos; o padrão
 * `new Date()` preserva o comportamento de produção.
 */

export const ATTENTION_LIMIT = 3
export const ATTENTION_DAYS_WINDOW = 7

export type AttentionDueUrgency = 'overdue' | 'urgent'

/**
 * Urgência de prazo para dívidas/recebíveis dentro do painel de atenção.
 *
 * Comparação por `Date` local (fuso do navegador). `dueDate < today` é
 * `overdue`; `dueDate === today` é `urgent` — o dia do vencimento em si
 * NUNCA é "em atraso" (mesma regra canônica de `settlementStatus`, das
 * authorities de Invoice e de Debt/Receivable no backend).
 */
export function attentionDueUrgency(
  dateString: string,
  today: Date = new Date(),
): AttentionDueUrgency {
  const todayStart = parseDateOnly(formatDateValue(today))
  const target = parseDateOnly(dateString)
  const diff = Math.round(
    (target.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24),
  )
  return diff < 0 ? 'overdue' : 'urgent'
}

/**
 * Faturas que exigem atenção agora.
 *
 * OVERDUE sempre entra. OPEN entra se o fechamento cai em até
 * `ATTENTION_DAYS_WINDOW` dias (com fallback para o vencimento quando o
 * fechamento já passou e o cron ainda não rodou). CLOSED entra pelo mesmo
 * critério de vencimento. PAID nunca entra. Sem limite de quantidade — todas
 * as que passam no filtro aparecem (comportamento original preservado).
 */
export function selectAttentionInvoices(
  invoices: readonly Invoice[],
  banks: readonly Bank[],
  today: Date = new Date(),
): Invoice[] {
  const now = new Date(today)
  now.setHours(0, 0, 0, 0)

  return invoices
    .filter((inv) => {
      if (Number(inv.totalAmount) === 0) return false
      if (inv.status === InvoiceStatus.OVERDUE) return true
      if (inv.status !== InvoiceStatus.OPEN && inv.status !== InvoiceStatus.CLOSED) {
        return false
      }
      const bank = banks.find((b) => b.id === inv.bankId)
      if (!bank) return false

      if (inv.status === InvoiceStatus.OPEN) {
        const close = parseInvoiceDate(inv.closeDate)
        close.setHours(0, 0, 0, 0)
        const closeDiff = Math.round(
          (close.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        )
        if (closeDiff >= 0) return closeDiff <= ATTENTION_DAYS_WINDOW
        // Fechamento já passou mas o status ainda é OPEN (cron atrasado) —
        // cai para o vencimento abaixo.
      }

      const due = parseInvoiceDate(inv.dueDate)
      due.setHours(0, 0, 0, 0)
      const diffDays = Math.round(
        (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      )
      return diffDays <= ATTENTION_DAYS_WINDOW
    })
    .sort((a, b) => {
      if (a.status === InvoiceStatus.OVERDUE && b.status !== InvoiceStatus.OVERDUE) return -1
      if (b.status === InvoiceStatus.OVERDUE && a.status !== InvoiceStatus.OVERDUE) return 1
      return a.year !== b.year ? a.year - b.year : a.month - b.month
    })
}

/** Janela móvel (hoje + `ATTENTION_DAYS_WINDOW` dias), como string `YYYY-MM-DD`. */
export function attentionWindowEnd(today: Date = new Date()): string {
  const d = new Date(today)
  d.setDate(d.getDate() + ATTENTION_DAYS_WINDOW)
  return formatDateValue(d)
}

/**
 * Dívidas/recebíveis pendentes dentro da janela (inclui atraso de qualquer
 * antiguidade — sem cutoff inferior), ordenados por vencimento ascendente,
 * ainda SEM o corte de `ATTENTION_LIMIT` — quem consome decide se aplica.
 */
export function selectPendingByDueDate<T extends { isPaid: boolean; dueDate: string }>(
  items: readonly T[],
  windowEnd: string,
): T[] {
  return items
    .filter((item) => !item.isPaid && item.dueDate <= windowEnd)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

export interface AttentionSelection {
  invoices: Invoice[]
  debtsAll: Debt[]
  debts: Debt[]
  receivablesAll: Receivable[]
  receivables: Receivable[]
  windowEnd: string
}

/** Monta a seleção completa do painel — mesmo corte por domínio de hoje. */
export function buildAttentionSelection(
  input: {
    invoices: readonly Invoice[]
    banks: readonly Bank[]
    debts: readonly Debt[]
    receivables: readonly Receivable[]
  },
  today: Date = new Date(),
): AttentionSelection {
  const windowEnd = attentionWindowEnd(today)
  const debtsAll = selectPendingByDueDate(input.debts, windowEnd)
  const receivablesAll = selectPendingByDueDate(input.receivables, windowEnd)

  return {
    invoices: selectAttentionInvoices(input.invoices, input.banks, today),
    debtsAll,
    debts: debtsAll.slice(0, ATTENTION_LIMIT),
    receivablesAll,
    receivables: receivablesAll.slice(0, ATTENTION_LIMIT),
    windowEnd,
  }
}
