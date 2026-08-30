import type { QueryClient } from '@tanstack/react-query'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O que depende do estado de uma fatura
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Marcar como paga e reabrir mexem no mesmo fato — `Invoice.status` — e
 * precisavam invalidar o mesmo conjunto. Cada uma tinha a sua lista, e elas já
 * divergiam: reabrir invalidava `budget`, pagar não.
 *
 * ── Por que `receivables` e `person-statement` entram ──
 *
 * A O3.2 passou a devolver `sourceDeleteBlockReason` junto de cada cobrança
 * automática, derivado da fatura da compra de origem. Sem invalidar essas duas
 * queries, uma lista já carregada continuaria dizendo `null` depois de a
 * fatura virar PAID — e ofereceria "Excluir compra e cobrança" para uma
 * operação que o backend recusa.
 *
 * Não é falha de segurança: a guarda continua no delete. É a UI prometendo o
 * que não pode cumprir, que era justamente o que a O3.2 veio consertar.
 *
 * ── Prefixos, não chaves completas ──
 *
 * `['person-statement']` alcança todas as variantes `[.., personId, período]`
 * pelo casamento por prefixo do React Query. Montar as chaves à mão exigiria
 * saber quais pessoas e meses estão em cache — e erraria em silêncio ao
 * esquecer uma.
 *
 * A lista é deliberada, nunca `invalidateQueries()` sem filtro: só o que
 * realmente muda quando uma fatura muda de status.
 */
export function invalidateInvoiceDependents(
  qc: QueryClient,
  /*
    `null` é estado real dos chamadores (o drawer abre sem fatura selecionada),
    não descuido — aceitar aqui evita um `?? undefined` em cada call site.
  */
  scope: {
    invoiceId?: string | null
    bankId?: string | null
  } = {},
) {
  /* A própria fatura e a lista do banco — o que já era invalidado. */
  if (scope.invoiceId) {
    qc.invalidateQueries({ queryKey: ['invoice', scope.invoiceId] })
  }
  if (scope.bankId) {
    qc.invalidateQueries({ queryKey: ['bank-invoices', scope.bankId] })
  }
  qc.invalidateQueries({ queryKey: ['invoices'] })

  /* O total comprometido do mês muda quando a fatura é paga ou reaberta. */
  qc.invalidateQueries({ queryKey: ['budget'] })

  /*
    As duas superfícies que carregam `sourceDeleteBlockReason`: a lista de A
    Receber e as pendências do extrato da pessoa.
  */
  qc.invalidateQueries({ queryKey: ['receivables'] })
  qc.invalidateQueries({ queryKey: ['person-statement'] })
}
