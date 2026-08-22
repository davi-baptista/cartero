import { describe, expect, it } from 'vitest';
import {
  InvalidInstallmentSplitError,
  fromCents,
  splitInstallmentAmount,
  splitInstallmentCents,
  toCents,
} from './installment.helper';

/**
 * O rateio é a fonte de verdade do parcelamento: a soma das parcelas tem de
 * bater exatamente com o total que o usuário digitou, em qualquer combinação
 * de valor e quantidade. Um centavo criado ou perdido aqui vira divergência
 * entre a compra e a soma das faturas.
 */

/** Soma em centavos — evita reintroduzir erro de ponto flutuante na asserção. */
function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + toCents(value), 0);
}

describe('toCents / fromCents', () => {
  it('converte reais em centavos inteiros', () => {
    expect(toCents(100)).toBe(10000);
    expect(toCents(0.1)).toBe(10);
    expect(toCents(2196.69)).toBe(219669);
  });

  it('arredonda imprecisão de ponto flutuante em vez de truncar', () => {
    // 10.999999... precisa virar 1100, não 1099.
    expect(toCents(10.999999999)).toBe(1100);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it('faz o round-trip sem perda', () => {
    for (const value of [0.01, 1, 33.33, 219.67, 2196.69]) {
      expect(fromCents(toCents(value))).toBeCloseTo(value, 10);
    }
  });
});

describe('splitInstallmentCents — divisão exata', () => {
  it('divide sem resto quando o total é múltiplo da quantidade', () => {
    expect(splitInstallmentCents(100000, 10)).toEqual(Array(10).fill(10000));
  });

  it('parcela única recebe o total', () => {
    expect(splitInstallmentCents(9999, 1)).toEqual([9999]);
  });
});

describe('splitInstallmentCents — resto distribuído nas primeiras', () => {
  it('R$ 100,00 em 3x → 33,34 · 33,33 · 33,33', () => {
    expect(splitInstallmentCents(10000, 3)).toEqual([3334, 3333, 3333]);
  });

  it('R$ 10,00 em 3x → 3,34 · 3,33 · 3,33', () => {
    expect(splitInstallmentCents(1000, 3)).toEqual([334, 333, 333]);
  });

  it('R$ 0,10 em 3x → 0,04 · 0,03 · 0,03', () => {
    expect(splitInstallmentCents(10, 3)).toEqual([4, 3, 3]);
  });

  it('a diferença entre a maior e a menor parcela nunca passa de 1 centavo', () => {
    const parcels = splitInstallmentCents(10000, 7);
    expect(Math.max(...parcels) - Math.min(...parcels)).toBe(1);
  });

  it('as parcelas maiores vêm primeiro', () => {
    const parcels = splitInstallmentCents(10000, 3);
    expect(parcels[0]).toBeGreaterThanOrEqual(parcels[parcels.length - 1]);
  });
});

describe('splitInstallmentCents — entradas inválidas', () => {
  it('recusa total que não é inteiro', () => {
    expect(() => splitInstallmentCents(100.5, 2)).toThrow(
      InvalidInstallmentSplitError,
    );
  });

  it('recusa quantidade zero ou negativa', () => {
    expect(() => splitInstallmentCents(1000, 0)).toThrow(
      InvalidInstallmentSplitError,
    );
    expect(() => splitInstallmentCents(1000, -3)).toThrow(
      InvalidInstallmentSplitError,
    );
  });

  it('recusa quantidade fracionária', () => {
    expect(() => splitInstallmentCents(1000, 2.5)).toThrow(
      InvalidInstallmentSplitError,
    );
  });

  it('recusa total pequeno demais para a quantidade', () => {
    // R$ 0,02 não vira 3 parcelas: alguma ficaria com zero.
    expect(() => splitInstallmentCents(2, 3)).toThrow(
      InvalidInstallmentSplitError,
    );
  });
});

describe('splitInstallmentAmount — casos reais do Cartero', () => {
  it('R$ 1.000,00 em 10x soma exatamente o total', () => {
    const parcels = splitInstallmentAmount(1000, 10);
    expect(parcels).toHaveLength(10);
    expect(sumCents(parcels)).toBe(toCents(1000));
    expect(parcels.every((value) => value === 100)).toBe(true);
  });

  it('R$ 2.196,69 em 10x soma exatamente o total', () => {
    // O caso da Televisão: 219669 centavos ÷ 10 deixa resto 9.
    const parcels = splitInstallmentAmount(2196.69, 10);
    expect(sumCents(parcels)).toBe(toCents(2196.69));
    expect(parcels[0]).toBeCloseTo(219.67, 10);
    expect(parcels[9]).toBeCloseTo(219.66, 10);
  });

  it('R$ 44,47 em 6x soma exatamente o total', () => {
    const parcels = splitInstallmentAmount(44.47, 6);
    expect(sumCents(parcels)).toBe(toCents(44.47));
  });

  it('R$ 861,30 em 10x reproduz o valor do Guarda Roupa', () => {
    const parcels = splitInstallmentAmount(861.3, 10);
    expect(parcels.every((value) => value === 86.13)).toBe(true);
    expect(sumCents(parcels)).toBe(toCents(861.3));
  });

  it('R$ 352,20 em 12x reproduz o valor da Alexa', () => {
    const parcels = splitInstallmentAmount(352.2, 12);
    expect(parcels.every((value) => value === 29.35)).toBe(true);
    expect(sumCents(parcels)).toBe(toCents(352.2));
  });

  it('R$ 100,00 em 3x nunca produz 99,99 nem 100,01', () => {
    expect(sumCents(splitInstallmentAmount(100, 3))).toBe(10000);
  });
});

describe('splitInstallmentAmount — restos específicos', () => {
  it.each([
    [1, 'um centavo de resto'],
    [2, 'dois centavos'],
    [5, 'cinco centavos'],
    [9, 'nove centavos'],
  ])('resto de %i centavo(s) é distribuído sem perda', (remainder) => {
    const count = 10;
    const totalCents = 10000 + remainder;
    const parcels = splitInstallmentCents(totalCents, count);

    expect(parcels).toHaveLength(count);
    expect(parcels.reduce((sum, value) => sum + value, 0)).toBe(totalCents);
    // Exatamente `remainder` parcelas recebem o centavo extra.
    expect(
      parcels.filter((value) => value === Math.max(...parcels)),
    ).toHaveLength(remainder);
  });
});

describe('invariantes do rateio', () => {
  // Varredura ampla no lugar de property-based testing, que exigiria uma
  // dependência nova. Cobre combinações de total e quantidade suficientes
  // para expor qualquer erro de arredondamento sistemático.
  const totals = [1, 2, 7, 10, 99, 100, 333, 1000, 4447, 219669, 1000000];
  const counts = [1, 2, 3, 4, 6, 7, 10, 11, 12, 24, 36, 64];

  it('a soma das parcelas é sempre exatamente o total', () => {
    for (const totalCents of totals) {
      for (const count of counts) {
        if (totalCents < count) continue;
        const parcels = splitInstallmentCents(totalCents, count);
        expect(parcels.reduce((sum, value) => sum + value, 0)).toBe(totalCents);
      }
    }
  });

  it('a quantidade de parcelas é sempre a pedida', () => {
    for (const totalCents of totals) {
      for (const count of counts) {
        if (totalCents < count) continue;
        expect(splitInstallmentCents(totalCents, count)).toHaveLength(count);
      }
    }
  });

  it('nenhuma parcela é zero ou negativa', () => {
    for (const totalCents of totals) {
      for (const count of counts) {
        if (totalCents < count) continue;
        const parcels = splitInstallmentCents(totalCents, count);
        expect(parcels.every((value) => value > 0)).toBe(true);
      }
    }
  });

  it('a diferença entre parcelas nunca passa de 1 centavo', () => {
    for (const totalCents of totals) {
      for (const count of counts) {
        if (totalCents < count) continue;
        const parcels = splitInstallmentCents(totalCents, count);
        expect(Math.max(...parcels) - Math.min(...parcels)).toBeLessThanOrEqual(
          1,
        );
      }
    }
  });

  it('é determinístico: mesma entrada, mesmas parcelas', () => {
    for (const totalCents of totals) {
      for (const count of counts) {
        if (totalCents < count) continue;
        expect(splitInstallmentCents(totalCents, count)).toEqual(
          splitInstallmentCents(totalCents, count),
        );
      }
    }
  });
});
