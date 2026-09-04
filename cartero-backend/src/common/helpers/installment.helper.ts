/**
 * Rateio do valor de uma compra parcelada.
 *
 * O usuário informa o TOTAL da compra; o Cartero divide entre as parcelas. A
 * divisão raramente é exata — R$ 100 em 3x dá 33,333... — então o resto em
 * centavos é distribuído nas PRIMEIRAS parcelas, que é a convenção das
 * operadoras de cartão no Brasil (a primeira vem um centavo maior, nunca menor).
 *
 * Todo o cálculo é feito em centavos inteiros. Dividir reais em ponto flutuante
 * produz erros silenciosos: `100 / 3 * 3` não devolve 100 em IEEE-754, e um
 * centavo perdido por compra vira divergência entre a soma das parcelas e o
 * total que o usuário digitou.
 */

/** Erro de entrada inválida — a validação do DTO deve impedir que chegue aqui. */
export class InvalidInstallmentSplitError extends Error {}

/**
 * Converte reais em centavos inteiros.
 *
 * `Math.round` em vez de truncamento: um `amount` que chegue como 10.999999
 * por imprecisão de ponto flutuante deve virar 1100, não 1099.
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Converte centavos inteiros de volta para reais. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Normaliza um valor em reais para dois decimais exatos.
 *
 * Somar valores em ponto flutuante acumula resíduo — dez parcelas de 33,33
 * podem produzir 333.29999999999995. Passar pelo inteiro de centavos devolve
 * o número que o usuário espera ver.
 */
export function round2(amount: number): number {
  return fromCents(toCents(amount));
}

/**
 * Divide `totalCents` em `count` parcelas cuja soma é exatamente `totalCents`.
 *
 * O resto da divisão inteira é distribuído de uma em uma nas primeiras
 * parcelas, então a diferença entre a maior e a menor nunca passa de 1 centavo.
 *
 * R$ 100,00 em 3x → [3334, 3333, 3333]
 */
export function splitInstallmentCents(
  totalCents: number,
  count: number,
): number[] {
  if (!Number.isInteger(totalCents)) {
    throw new InvalidInstallmentSplitError(
      'O total deve estar em centavos inteiros',
    );
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new InvalidInstallmentSplitError(
      'A quantidade de parcelas deve ser um inteiro maior que zero',
    );
  }
  if (totalCents < count) {
    // Cada parcela precisa de ao menos 1 centavo — R$ 0,02 não vira 3 parcelas.
    throw new InvalidInstallmentSplitError(
      'O valor total é pequeno demais para essa quantidade de parcelas',
    );
  }

  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;

  return Array.from({ length: count }, (_, index) =>
    index < remainder ? base + 1 : base,
  );
}

/**
 * Mesma divisão, em reais — a forma usada pelos serviços.
 *
 * É a única fonte de verdade do rateio: criação e, futuramente, a prévia devem
 * chamar esta função em vez de recalcular por conta própria.
 */
export function splitInstallmentAmount(total: number, count: number): number[] {
  return splitInstallmentCents(toCents(total), count).map(fromCents);
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Identidade de parcelamento — LINEAGE, nunca cardinalidade
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Uma compra não deixa de ser parcelada porque as outras parcelas foram
 * removidas. `1/5` que sobreviveu a uma exclusão parcial continua sendo a
 * primeira de cinco: o fato histórico não muda, e a tela continua — com
 * razão — mostrando `1/5`.
 *
 * ── O bug que isto corrige ──
 *
 * A decisão era `parentId !== null || temFilhasAgora`. A primeira parcela é a
 * RAIZ (`parentId` nulo, as outras apontam para ela), então bastava excluir
 * as irmãs para a série inteira deixar de ser reconhecida:
 *
 *   preview   isInstallment: false, deletableCount: 1   ← incoerente consigo
 *   execute   OPEN_SCOPE_REQUIRES_INSTALLMENT           ← recusa o que o
 *                                                         preview ofereceu
 *
 * A UI usava um terceiro critério — a regex do título, que SOBREVIVE à
 * exclusão — e por isso abria o fluxo de parcelas para algo que o servidor já
 * não aceitava.
 *
 * ── As duas evidências de lineage ──
 *
 * `parentId` prova filiação: quem aponta para uma raiz nasceu numa série.
 *
 * O sufixo `N/M` no título prova a origem da RAIZ, e é o único vestígio que
 * ela guarda depois de perder as filhas. Não é heurística de exibição: a
 * criação escreve esse sufixo justamente para marcar a série, e
 * `getInstallmentIndex` já dependia dele para ordenar.
 *
 * Nenhum campo novo foi criado: `installmentTotal`/`installmentGroupId` não
 * existem neste schema, e inventá-los exigiria migration para um fato que o
 * título já carrega.
 */

/** O sufixo que a criação escreve em cada parcela: `Nome 3/12`. */
const INSTALLMENT_TITLE_SUFFIX = /\s(\d+)\/(\d+)$/;

/** `{ number, total }` quando o título numera a parcela, senão `null`. */
export function parseInstallmentTitle(
  title: string,
): { number: number; total: number } | null {
  const match = title.match(INSTALLMENT_TITLE_SUFFIX);
  if (!match) return null;

  const number = Number(match[1]);
  const total = Number(match[2]);

  /*
    `x/1` não é parcelamento: a criação nunca gera esse sufixo para compra à
    vista, e tratá-lo como série faria uma transação simples entrar no
    lifecycle de parcelas.
  */
  if (!Number.isInteger(number) || !Number.isInteger(total)) return null;
  if (total < 2 || number < 1 || number > total) return null;

  return { number, total };
}

/**
 * Esta transação pertence a uma compra parcelada?
 *
 * Autoridade ÚNICA de prévia e execução. Não consulta o banco: a resposta está
 * na própria linha, e é isso que a torna estável quando as irmãs já não
 * existem.
 *
 * Uma compra genuinamente simples continua fora — é o que preserva a recusa
 * `OPEN_SCOPE_REQUIRES_INSTALLMENT` para quem deve recebê-la.
 */
export function belongsToInstallmentSeries(transaction: {
  parentId: string | null;
  title: string;
}): boolean {
  if (transaction.parentId !== null) return true;
  return parseInstallmentTitle(transaction.title) !== null;
}
