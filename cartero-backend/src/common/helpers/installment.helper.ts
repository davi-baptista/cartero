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
