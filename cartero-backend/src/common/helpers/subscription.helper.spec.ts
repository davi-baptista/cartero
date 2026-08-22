import { describe, expect, it } from 'vitest';
import {
  addCycles,
  chargeDateForCycle,
  compareCycles,
  currentCycle,
  formatCycle,
  parseCycle,
  pendingCycles,
} from './subscription.helper';

/**
 * Assinaturas são governadas por CICLOS ("YYYY-MM"), não por datas. O ciclo é o
 * mês de competência; a data da cobrança é derivada dele. Essa separação é o
 * que impede uma assinatura no dia 31 de escorregar de mês em mês.
 *
 * `pendingCycles` é a peça de idempotência: dado `lastGeneratedFor`, ela sozinha
 * diz o que falta gerar — sem varrer transações.
 */

/** "Hoje" determinístico, sempre explícito. */
function today(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

describe('parseCycle / formatCycle', () => {
  it('faz o round-trip de um ciclo', () => {
    expect(formatCycle(parseCycle('2026-08'))).toBe('2026-08');
  });

  it('preserva o zero à esquerda do mês', () => {
    expect(formatCycle({ year: 2026, month: 3 })).toBe('2026-03');
  });

  it('rejeita formato inválido', () => {
    expect(() => parseCycle('2026-8')).toThrow(/Ciclo inválido/);
    expect(() => parseCycle('08-2026')).toThrow(/Ciclo inválido/);
    expect(() => parseCycle('')).toThrow(/Ciclo inválido/);
  });

  it('rejeita mês fora de 1-12', () => {
    expect(() => parseCycle('2026-00')).toThrow(/fora de 1-12/);
    expect(() => parseCycle('2026-13')).toThrow(/fora de 1-12/);
  });
});

describe('addCycles', () => {
  it('avança dentro do mesmo ano', () => {
    expect(addCycles({ year: 2026, month: 3 }, 2)).toEqual({
      year: 2026,
      month: 5,
    });
  });

  it('atravessa a virada de ano para frente', () => {
    expect(addCycles({ year: 2026, month: 11 }, 3)).toEqual({
      year: 2027,
      month: 2,
    });
  });

  it('atravessa a virada de ano para trás', () => {
    expect(addCycles({ year: 2026, month: 2 }, -3)).toEqual({
      year: 2025,
      month: 11,
    });
  });

  it('dezembro + 1 é janeiro do ano seguinte', () => {
    expect(addCycles({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
  });

  it('avança doze meses exatos', () => {
    expect(addCycles({ year: 2026, month: 8 }, 12)).toEqual({
      year: 2027,
      month: 8,
    });
  });
});

describe('compareCycles', () => {
  it('ordena por ano antes de mês', () => {
    expect(
      compareCycles({ year: 2025, month: 12 }, { year: 2026, month: 1 }),
    ).toBeLessThan(0);
  });

  it('devolve zero para o mesmo ciclo', () => {
    expect(
      compareCycles({ year: 2026, month: 6 }, { year: 2026, month: 6 }),
    ).toBe(0);
  });

  it('é positivo quando o primeiro é mais recente', () => {
    expect(
      compareCycles({ year: 2026, month: 9 }, { year: 2026, month: 4 }),
    ).toBeGreaterThan(0);
  });
});

describe('currentCycle', () => {
  it('extrai o ciclo do "hoje" informado, em UTC', () => {
    expect(currentCycle(today(2026, 8, 19))).toEqual({ year: 2026, month: 8 });
  });
});

describe('chargeDateForCycle', () => {
  it('usa o dia pedido quando o mês o comporta', () => {
    const date = chargeDateForCycle({ year: 2026, month: 3 }, 15);
    expect(date.getUTCDate()).toBe(15);
    expect(date.getUTCMonth() + 1).toBe(3);
  });

  it('trunca para o último dia em meses curtos', () => {
    expect(chargeDateForCycle({ year: 2026, month: 2 }, 31).getUTCDate()).toBe(
      28,
    );
    expect(chargeDateForCycle({ year: 2026, month: 4 }, 31).getUTCDate()).toBe(
      30,
    );
  });

  it('respeita fevereiro em ano bissexto', () => {
    expect(chargeDateForCycle({ year: 2028, month: 2 }, 31).getUTCDate()).toBe(
      29,
    );
  });

  it('não reescreve o dia original: o ciclo seguinte volta ao dia 31', () => {
    // A regra central. O truncamento é por ciclo, nunca persistido — senão uma
    // assinatura no 31 viraria 28 depois de fevereiro, de forma permanente.
    expect(chargeDateForCycle({ year: 2026, month: 2 }, 31).getUTCDate()).toBe(
      28,
    );
    expect(chargeDateForCycle({ year: 2026, month: 3 }, 31).getUTCDate()).toBe(
      31,
    );
  });
});

describe('pendingCycles — assinatura nova', () => {
  it('gera o ciclo corrente quando o dia da cobrança já passou', () => {
    const cycles = pendingCycles('2026-08', null, 5, today(2026, 8, 19));
    expect(cycles.map(formatCycle)).toEqual(['2026-08']);
  });

  it('gera o ciclo corrente no próprio dia da cobrança', () => {
    // O corte é `charge > todayUtc`: cobrar hoje conta como vencido.
    const cycles = pendingCycles('2026-08', null, 19, today(2026, 8, 19));
    expect(cycles.map(formatCycle)).toEqual(['2026-08']);
  });

  it('não gera nada quando o dia da cobrança ainda não chegou', () => {
    const cycles = pendingCycles('2026-08', null, 25, today(2026, 8, 19));
    expect(cycles).toEqual([]);
  });

  it('não gera nada quando a assinatura começa no futuro', () => {
    const cycles = pendingCycles('2026-12', null, 5, today(2026, 8, 19));
    expect(cycles).toEqual([]);
  });
});

describe('pendingCycles — histórico retroativo', () => {
  it('traz todos os ciclos desde o início quando nada foi gerado', () => {
    const cycles = pendingCycles('2026-05', null, 10, today(2026, 8, 19));
    expect(cycles.map(formatCycle)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
  });

  it('atravessa a virada de ano no histórico', () => {
    const cycles = pendingCycles('2025-11', null, 10, today(2026, 2, 19));
    expect(cycles.map(formatCycle)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('exclui o ciclo corrente do retroativo se a cobrança ainda não venceu', () => {
    const cycles = pendingCycles('2026-06', null, 25, today(2026, 8, 19));
    expect(cycles.map(formatCycle)).toEqual(['2026-06', '2026-07']);
  });
});

describe('pendingCycles — idempotência via lastGeneratedFor', () => {
  it('retoma do ciclo seguinte ao último gerado', () => {
    const cycles = pendingCycles('2026-05', '2026-06', 10, today(2026, 8, 19));
    expect(cycles.map(formatCycle)).toEqual(['2026-07', '2026-08']);
  });

  it('não gera nada quando o último gerado é o ciclo corrente', () => {
    // A garantia de "rodar duas vezes no mesmo dia não duplica".
    const cycles = pendingCycles('2026-05', '2026-08', 10, today(2026, 8, 19));
    expect(cycles).toEqual([]);
  });

  it('não regenera ciclos passados nem com startedAt antigo', () => {
    const cycles = pendingCycles('2024-01', '2026-08', 10, today(2026, 8, 19));
    expect(cycles).toEqual([]);
  });

  it('lastGeneratedFor tem precedência sobre startedAt', () => {
    // Mesmo que startedAt seja mais recente, o marcador manda.
    const cycles = pendingCycles('2026-08', '2026-08', 1, today(2026, 8, 19));
    expect(cycles).toEqual([]);
  });

  it('uma execução seguida da outra é estável', () => {
    // Simula o cron rodando, avançando o marcador, e rodando de novo.
    const first = pendingCycles('2026-06', null, 10, today(2026, 8, 19));
    expect(first.map(formatCycle)).toEqual(['2026-06', '2026-07', '2026-08']);

    const marker = formatCycle(first[first.length - 1]);
    const second = pendingCycles('2026-06', marker, 10, today(2026, 8, 19));
    expect(second).toEqual([]);
  });

  it('retoma a geração quando o mês avança', () => {
    // É o que acontece com uma assinatura pausada e retomada: o marcador fica
    // congelado, e ao voltar ela gera todos os ciclos do intervalo.
    const cycles = pendingCycles('2026-01', '2026-05', 10, today(2026, 8, 19));
    expect(cycles.map(formatCycle)).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('assinatura no dia 31 gera fevereiro sem travar', () => {
    // Fevereiro trunca para 28 e é gerado normalmente. Março ainda NÃO entra:
    // em 05/03 a cobrança do dia 31 não venceu — o ciclo corrente só conta
    // depois que o dia da cobrança chega.
    const cycles = pendingCycles('2026-02', '2026-01', 31, today(2026, 3, 5));
    expect(cycles.map(formatCycle)).toEqual(['2026-02']);
    expect(chargeDateForCycle(cycles[0], 31).getUTCDate()).toBe(28);
  });

  it('assinatura no dia 31 volta ao dia 31 depois de fevereiro', () => {
    // Já no fim de março, o ciclo de março entra e a cobrança volta ao dia 31 —
    // a passagem por fevereiro não empurrou a data para trás.
    const cycles = pendingCycles('2026-02', '2026-01', 31, today(2026, 3, 31));
    expect(cycles.map(formatCycle)).toEqual(['2026-02', '2026-03']);
    expect(chargeDateForCycle(cycles[0], 31).getUTCDate()).toBe(28);
    expect(chargeDateForCycle(cycles[1], 31).getUTCDate()).toBe(31);
  });
});
