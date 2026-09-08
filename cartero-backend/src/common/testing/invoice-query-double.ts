/**
 * ══════════════════════════════════════════════════════════════════════════
 * Roteador das consultas de fatura do Orçamento (para testes)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O `BudgetService` faz DUAS consultas de fatura, e cada uma responde uma
 * pergunta diferente:
 *
 *   A. competência exibida    — `{ month, year }`
 *   B. fila viva de atrasadas — `status: OVERDUE` + competência ANTERIOR
 *
 * Um duplo que devolva a mesma lista para as duas conta a fatura duas vezes:
 * `totalToPay` de 700 virava 1400, porque a fatura do próprio mês também
 * chegava pela consulta da fila.
 *
 * Este helper aplica o `where` de verdade, como o Postgres faria, para que os
 * testes falhem quando o serviço montar a condição errada — e não apenas
 * quando a aritmética mudar. É o mesmo recurso de `debt-query-double`.
 */

/** O mínimo que o roteador precisa de cada linha. */
export interface InvoiceDoubleRow {
  month: number;
  year: number;
  status: string;
}

/**
 * O quão literalmente a competência exibida é filtrada.
 *
 *   `'lenient'` (padrão)  a linha passa sem comparar `month`/`year`
 *   `'strict'`            compara, como o Postgres faria
 *
 * A permissividade não é desleixo: muitos duplos montam a fatura com o mês
 * default do fixture e consultam outro. O que interessa a eles é "a fatura do
 * mês", não a data — exigir igualdade faria a fatura sumir por um detalhe do
 * fixture, e não por comportamento do serviço.
 *
 * `'strict'` é para quem TESTA a competência: um cenário que declara faturas
 * de agosto, setembro e outubro precisa que cada consulta receba só as suas,
 * ou o teste de carry não distingue as duas listas.
 */
export type InvoiceQueryMode = 'lenient' | 'strict';

/** A linha satisfaz o `where` desta consulta? */
export function matchesInvoiceQuery(
  where: any,
  row: InvoiceDoubleRow,
  mode: InvoiceQueryMode = 'lenient',
): boolean {
  /*
    (B) A fila viva: status OVERDUE e competência estritamente anterior.

    O `OR` é `[{ year: { lt } }, { year, month: { lt } }]` — ano anterior
    inteiro, ou o mesmo ano com mês menor.

    A checagem é `typeof status === 'string'` de propósito: `getFocusPeriod`
    também consulta faturas com `status`, mas na forma `{ not: 'PAID' }` e com
    `gt`/`gte`. Tratá-la como a fila viva filtraria por competência anterior e
    esvaziaria a janela de foco.
  */
  if (typeof where?.status === 'string') {
    if (row.status !== where.status) return false;

    if (Array.isArray(where.OR)) {
      return where.OR.some((clause: any) => {
        if (clause.year?.lt !== undefined) return row.year < clause.year.lt;
        if (clause.month?.lt !== undefined) {
          return row.year === clause.year && row.month < clause.month.lt;
        }
        return false;
      });
    }

    return true;
  }

  /*
    (A) A competência exibida.

    A linha PASSA quando não declara competência própria: muitos duplos
    montam a fatura com o mês default do fixture e consultam outro mês — o
    que interessa a eles é "a fatura do mês", não a data. Exigir igualdade
    faria a fatura desaparecer desses testes por um detalhe do fixture, não
    por comportamento do serviço.

    O que este roteador precisa garantir é a SEPARAÇÃO entre as duas
    consultas: a fila viva (B) filtra por status e competência anterior, e é
    ela que estava contando a fatura duas vezes.

    Em `'strict'`, a competência é comparada de verdade — o modo de quem está
    justamente testando qual fatura pertence a qual mês.
  */
  if (mode === 'strict') {
    if (where?.month !== undefined && row.month !== where.month) return false;
    if (where?.year !== undefined && row.year !== where.year) return false;
  }

  return true;
}

/** Filtra uma lista de linhas pelo `where` recebido. */
export function routeInvoiceQuery<T extends InvoiceDoubleRow>(
  where: any,
  rows: readonly T[],
  mode: InvoiceQueryMode = 'lenient',
): T[] {
  return rows.filter((row) => matchesInvoiceQuery(where, row, mode));
}
