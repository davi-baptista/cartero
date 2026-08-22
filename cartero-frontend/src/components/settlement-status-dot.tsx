import {
  DEBT_STATUS_LABEL,
  RECEIVABLE_STATUS_LABEL,
  settlementStatus,
  type SettlementStatus,
} from '@/lib/settlement-status'

/**
 * Indicador de status de uma pendência — Dívidas e A Receber.
 *
 * As duas páginas tinham este componente duplicado byte a byte, divergindo só
 * no rótulo de conclusão ("Pago" / "Recebido"). Duas cópias significam que
 * qualquer correção de cor ou de texto acessível precisava ser feita duas
 * vezes, e a divergência de vocabulário já havia acontecido nos contadores.
 *
 * O pendente NÃO usa verde. Verde é conclusão; um item em aberto pintado de
 * verde só porque pertence à seção A Receber lê como já recebido.
 */
interface SettlementStatusDotProps {
  item: { isPaid: boolean; dueDate: string }
  domain: 'debt' | 'receivable'
}

export function SettlementStatusDot({
  item,
  domain,
}: SettlementStatusDotProps) {
  const status = settlementStatus(item)
  const label = (
    domain === 'debt' ? DEBT_STATUS_LABEL : RECEIVABLE_STATUS_LABEL
  )[status]

  return (
    <>
      {status === 'overdue' ? (
        /*
          O atraso pulsa: é o único estado que pede ação hoje. Fica atrás de
          `aria-hidden` porque a animação não carrega informação — o texto ao
          lado é que informa.
        */
        <span
          className="relative flex size-2.5 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/50 opacity-75" />
          <span className="size-2.5 rounded-full bg-destructive" />
        </span>
      ) : (
        <span
          className={`size-2.5 shrink-0 rounded-full ${DOT_CLASS[status]}`}
          aria-hidden="true"
        />
      )}
      <span className="sr-only">{label}</span>
    </>
  )
}

/**
 * Cor do ponto por status.
 *
 * `overdue` não aparece aqui: ele tem marcação própria acima, com a camada de
 * pulso.
 */
const DOT_CLASS: Record<Exclude<SettlementStatus, 'overdue'>, string> = {
  paid: 'bg-receivable',
  pending: 'bg-pending',
}
