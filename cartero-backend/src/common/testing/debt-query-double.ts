/**
 * ══════════════════════════════════════════════════════════════════════════
 * Roteador das consultas de dívida do Orçamento (para testes)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O `BudgetService` faz três consultas de dívida, e cada uma responde uma
 * pergunta diferente sobre a competência financeira:
 *
 *   A. `openDueInMonth`   — `isPaid: false` + vence dentro do mês
 *   B. `currentOpenPrior` — `isPaid: false` + venceu antes (só mês corrente)
 *   C. `paidInMonth`      — `paidAt` dentro da janela do mês
 *
 * Um duplo que devolva a mesma lista para todas conta a dívida mais de uma
 * vez: uma dívida paga casaria em (A) e em (C), e o total dobraria. Foi
 * exatamente esse erro — "expected 1000 to be 500" — que apareceu quando a
 * semântica passou a atribuir a dívida resolvida ao mês do pagamento.
 *
 * Este helper aplica o `where` de verdade, como o Postgres faria, para que os
 * testes falhem quando o serviço montar a condição errada — e não apenas
 * quando a aritmética mudar.
 */

/** O mínimo que o roteador precisa de cada linha. */
export interface DebtDoubleRow {
  isPaid: boolean;
  paidAt: Date | null;
  dueDate: Date;
}

/** A linha satisfaz o `where` desta consulta? */
export function matchesDebtQuery(where: any, row: DebtDoubleRow): boolean {
  if (where?.isPaid !== undefined && where.isPaid !== row.isPaid) return false;

  // (C) Paga na janela do mês — qualquer vencimento.
  if (where?.paidAt?.gte && where?.paidAt?.lt) {
    return (
      row.paidAt != null &&
      row.paidAt >= where.paidAt.gte &&
      row.paidAt < where.paidAt.lt
    );
  }

  // (A) Vence dentro do mês.
  if (where?.dueDate?.gte && where?.dueDate?.lt) {
    return row.dueDate >= where.dueDate.gte && row.dueDate < where.dueDate.lt;
  }

  // (B) Venceu antes do mês.
  if (where?.dueDate?.lt) return row.dueDate < where.dueDate.lt;

  return false;
}

/** Filtra uma lista de linhas pelo `where` recebido. */
export function routeDebtQuery<T extends DebtDoubleRow>(
  where: any,
  rows: readonly T[],
): T[] {
  return rows.filter((row) => matchesDebtQuery(where, row));
}
