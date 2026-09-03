import {
  BANK_TRAILING_LABEL,
  BANK_TRAILING_TONE,
  bankTrailingState,
  type BankTrailingState,
} from '@/lib/bank-invoice-selection'
import { invoiceTimingClass, invoiceTimingLabel } from '@/lib/invoice-timing'
import { InvoiceStatus } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A row de fatura, decidida em UM lugar
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A mesma fatura aparece em Bancos e na seção Faturas do Orçamento, e as duas
 * telas montavam a row por caminhos diferentes. O resultado divergiu num ponto
 * específico e difícil de notar:
 *
 *   Bancos      Inter · Venceu em 10/09/2026 [VERDE]   R$ 10,00   PAGA
 *   Orçamento   Inter · Venceu em 10/09/2026 [cinza]   R$ 10,00   PAGA
 *
 * A causa não era um helper errado: `invoiceTimingClass` devolve
 * `text-muted-foreground` para `PAID` — um ciclo quitado não tem prazo a
 * cumprir, e a cor dele vem do status. Bancos corrigia isso com uma
 * condicional DENTRO do JSX, trocando o tom por `text-paid` quando pago.
 *
 * Aquela condicional era a policy real, e vivia num lugar onde ninguém que
 * consumisse o helper a encontraria. Este módulo a transforma na autoridade
 * única: as duas telas passam a pedir o mesmo objeto e não têm mais como
 * divergir.
 *
 * ── A anatomia que as duas compartilham ──
 *
 *   nome                        ← identidade
 *   prazo                       ← o que acontece temporalmente
 *                    valor      ← quanto (sempre NEUTRO)
 *                    estado     ← o fato persistido
 *
 * ── Por que o valor nunca entra aqui ──
 *
 * R$ 1.940,95 é o mesmo número pago ou não. A cor informa ESTADO, e o estado
 * tem dois lugares próprios: o prazo e o trailing. Este presenter devolve tom
 * para os dois e para nada mais — não há como uma tela pedir "a cor do valor".
 */

export interface InvoiceRowPresentation {
  /** Prazo abaixo do nome — "Fecha em 4d", "Venceu em 10/09/2026". */
  timingLabel: string
  /** Tom do prazo, ou string vazia para o neutro. */
  timingTone: string
  /** Estado persistido, abaixo do valor — "Fatura aberta", "Paga". */
  statusLabel: string
  /** Tom do estado. */
  statusTone: string
  state: BankTrailingState
}

/**
 * O mínimo que a apresentação precisa saber da fatura.
 *
 * `status` tipado pelo enum — `bankTrailingState` faz um `switch` exaustivo
 * sobre ele, e um `string` solto perderia a garantia de que todo estado novo
 * seja tratado.
 */
export interface PresentableInvoice {
  status: InvoiceStatus
  closeDate: string
  dueDate: string
}

/**
 * A apresentação de uma row de fatura.
 *
 * `null` representa banco sem fatura na competência: não há prazo a mostrar —
 * nenhuma data existe para contar —, e o estado é "Sem fatura".
 */
export function invoiceRowPresentation(
  invoice: PresentableInvoice | null,
  today: Date = new Date(),
): InvoiceRowPresentation {
  if (invoice === null) {
    return {
      timingLabel: '',
      timingTone: '',
      statusLabel: BANK_TRAILING_LABEL.noInvoice,
      statusTone: BANK_TRAILING_TONE.noInvoice,
      state: 'noInvoice',
    }
  }

  const state = bankTrailingState(invoice)

  return {
    timingLabel: invoiceTimingLabel(invoice, today),
    /*
      ── Fatura paga tinge o prazo de verde ──

      "Venceu em 10/09" ao lado de "PAGA" fala do MESMO fato resolvido, e sair
      cinza fazia a linha parecer meio-concluída. Com a cor compartilhada ela
      se lê como encerrada de relance — e não é um tom inventado: é o mesmo
      `text-paid` do trailing.

      Nos outros estados vale a régua temporal (`invoiceTimingClass`): vermelho
      no atraso, âmbar em ≤7 dias, neutro no resto.
    */
    timingTone:
      state === 'paid'
        ? BANK_TRAILING_TONE.paid
        : invoiceTimingClass(invoice, today),
    statusLabel: BANK_TRAILING_LABEL[state],
    statusTone: BANK_TRAILING_TONE[state],
    state,
  }
}

/** A row tem prazo a exibir? Sem fatura, não há. */
export function hasTimingLabel(p: InvoiceRowPresentation): boolean {
  return p.timingLabel.length > 0
}
