import { describe, expect, it, vi } from 'vitest';
import { SalaryService } from './salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import {
  compareCompetence,
  currentCompetence,
  isCurrentCompetence,
} from 'src/common/helpers/salary.helper';
import { USER_ID, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Resolução da renda mensal (Fase 9A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Cada `SalaryHistory` é uma ALTERAÇÃO que vale a partir de uma competência e
 * segue valendo até a próxima. O usuário não recadastra o mesmo valor todo
 * mês — é o carry-forward que faz isso.
 *
 * A distinção que este arquivo protege acima de tudo:
 *
 *   `known: false`  →  não sabemos (mês anterior à primeira entrada)
 *   `amount: 0`     →  sabemos, e a renda é zero
 *
 * Tratar os dois como a mesma coisa é o que fazia a tela dizer "R$ 0,00" para
 * um mês sobre o qual ninguém informou nada.
 */

interface Entry {
  year: number;
  month: number;
  amount: number;
}

/**
 * Duplo que aplica a MESMA regra do banco: a última entrada com competência
 * `<=` a pedida.
 *
 * Um duplo que devolvesse sempre a primeira linha passaria mesmo com o
 * `orderBy` do serviço invertido.
 */
function buildHarness(entries: Entry[] = []) {
  const writes: any[] = [];

  const prisma: any = {
    salaryHistory: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        void orderBy;
        const target = where.OR[1];
        const applicable = entries
          .filter(
            (entry) =>
              entry.year < target.year ||
              (entry.year === target.year && entry.month <= target.month.lte),
          )
          .sort((a, b) => b.year - a.year || b.month - a.month);

        const winner = applicable[0];
        return winner
          ? {
              amount: money(winner.amount),
              year: winner.year,
              month: winner.month,
            }
          : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = entries.find(
          (entry) =>
            entry.year === where.userId_year_month.year &&
            entry.month === where.userId_year_month.month,
        );
        if (existing) {
          existing.amount = update.amount;
          writes.push({ kind: 'update', ...where.userId_year_month });
          return { ...existing, amount: money(existing.amount) };
        }
        entries.push({
          year: create.year,
          month: create.month,
          amount: create.amount,
        });
        writes.push({ kind: 'create', year: create.year, month: create.month });
        return { ...create, amount: money(create.amount) };
      }),
    },
    user: {
      update: vi.fn(async ({ data }: any) => {
        writes.push({ kind: 'cache', salary: data.salary });
        return {};
      }),
    },
  };

  return {
    service: new SalaryService(prisma as PrismaService),
    prisma,
    writes,
    entries,
  };
}

describe('Resolução por competência', () => {
  it('sem nenhuma entrada, a renda é DESCONHECIDA', async () => {
    const harness = buildHarness([]);

    const result = await harness.service.resolve(USER_ID, {
      year: 2026,
      month: 8,
    });

    expect(result.known).toBe(false);
    expect(result.amount).toBeNull();
  });

  it('no mês da entrada, resolve o valor', async () => {
    const harness = buildHarness([{ year: 2026, month: 8, amount: 5000 }]);

    const result = await harness.service.resolve(USER_ID, {
      year: 2026,
      month: 8,
    });

    expect(result).toMatchObject({
      known: true,
      amount: 5000,
      effectiveFrom: { year: 2026, month: 8 },
    });
  });

  it('carry-forward: meses seguintes herdam o valor', async () => {
    // O ponto do modelo. Sem isso o usuário recadastraria a mesma renda todo
    // mês, e qualquer mês esquecido viraria "desconhecido".
    const harness = buildHarness([{ year: 2026, month: 8, amount: 5000 }]);

    const setembro = await harness.service.resolve(USER_ID, {
      year: 2026,
      month: 9,
    });
    const dezembro = await harness.service.resolve(USER_ID, {
      year: 2026,
      month: 12,
    });

    expect(setembro.amount).toBe(5000);
    expect(dezembro.amount).toBe(5000);
  });

  it('carry-forward atravessa a virada de ano', async () => {
    /**
     * A comparação é lexicográfica sobre (ano, mês).
     *
     * Um filtro `month <= 3` solto pegaria março de qualquer ano — inclusive
     * de 2025 — e resolveria a renda errada. Por isso a query combina
     * `year < pedido` OR (`year = pedido` AND `month <= pedido`).
     */
    const harness = buildHarness([{ year: 2026, month: 8, amount: 5000 }]);

    const result = await harness.service.resolve(USER_ID, {
      year: 2027,
      month: 3,
    });

    expect(result.amount).toBe(5000);
  });

  it('mês ANTERIOR à primeira entrada é desconhecido', async () => {
    /**
     * A regra que sustenta o backfill conservador.
     *
     * Sabemos o valor atual, não desde quando ele vale. Devolver 5000 para
     * julho afirmaria um fato que ninguém informou — e reescreveria a sobra de
     * um mês já encerrado.
     */
    const harness = buildHarness([{ year: 2026, month: 8, amount: 5000 }]);

    const result = await harness.service.resolve(USER_ID, {
      year: 2026,
      month: 7,
    });

    expect(result.known).toBe(false);
    expect(result.amount).toBeNull();
  });

  it('com três alterações, usa a última aplicável', async () => {
    const harness = buildHarness([
      { year: 2026, month: 1, amount: 4000 },
      { year: 2026, month: 4, amount: 4500 },
      { year: 2026, month: 8, amount: 5000 },
    ]);

    const meses = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((month) =>
        harness.service.resolve(USER_ID, { year: 2026, month }),
      ),
    );

    expect(meses.map((m) => m.amount)).toEqual([
      4000,
      4000,
      4000, // jan–mar
      4500,
      4500,
      4500,
      4500, // abr–jul
      5000,
      5000, // ago–set
    ]);
  });

  it('amount zero é renda CONHECIDA e igual a zero', async () => {
    /**
     * Zero é legítimo — alguém entre empregos. O contrato precisa distinguir
     * isso de "não registrado", senão a tela mostra a mesma coisa para
     * situações opostas.
     */
    const harness = buildHarness([{ year: 2026, month: 8, amount: 0 }]);

    const result = await harness.service.resolve(USER_ID, {
      year: 2026,
      month: 8,
    });

    expect(result.known).toBe(true);
    expect(result.amount).toBe(0);
  });
});

describe('Upsert', () => {
  it('definir duas vezes a mesma competência não duplica', async () => {
    const harness = buildHarness([]);

    await harness.service.upsert(USER_ID, {
      year: 2026,
      month: 8,
      amount: 5000,
    });
    await harness.service.upsert(USER_ID, {
      year: 2026,
      month: 8,
      amount: 5000,
    });

    const created = harness.writes.filter((w) => w.kind === 'create');
    const updated = harness.writes.filter((w) => w.kind === 'update');
    expect(created).toHaveLength(1);
    expect(updated).toHaveLength(1);
    expect(harness.entries).toHaveLength(1);
  });

  it('alterar o mês corrente atualiza a mesma entrada', async () => {
    const harness = buildHarness([{ year: 2026, month: 8, amount: 5000 }]);

    await harness.service.upsert(USER_ID, {
      year: 2026,
      month: 8,
      amount: 5500,
    });

    expect(harness.entries).toHaveLength(1);
    expect(harness.entries[0].amount).toBe(5500);
  });

  it('alteração retroativa NÃO sobrescreve entradas posteriores', async () => {
    /**
     * Cenário do item 13: existe abr=4500; o usuário registra jan=4000.
     *
     * Resultado esperado: jan–mar valem 4000, e abril CONTINUA 4500. Cada
     * entrada é uma alteração pontual, não um valor retroativo global.
     */
    const harness = buildHarness([{ year: 2026, month: 4, amount: 4500 }]);

    await harness.service.upsert(USER_ID, {
      year: 2026,
      month: 1,
      amount: 4000,
    });

    const [jan, mar, abr, mai] = await Promise.all([
      harness.service.resolve(USER_ID, { year: 2026, month: 1 }),
      harness.service.resolve(USER_ID, { year: 2026, month: 3 }),
      harness.service.resolve(USER_ID, { year: 2026, month: 4 }),
      harness.service.resolve(USER_ID, { year: 2026, month: 5 }),
    ]);

    expect(jan.amount).toBe(4000);
    expect(mar.amount).toBe(4000);
    expect(abr.amount).toBe(4500);
    expect(mai.amount).toBe(4500);
  });

  it('inserção ENTRE duas entradas respeita as duas', async () => {
    // Item 32: jan=4000, ago=5000; insere mai=4500.
    const harness = buildHarness([
      { year: 2026, month: 1, amount: 4000 },
      { year: 2026, month: 8, amount: 5000 },
    ]);

    await harness.service.upsert(USER_ID, {
      year: 2026,
      month: 5,
      amount: 4500,
    });

    const meses = await Promise.all(
      [4, 5, 7, 8].map((month) =>
        harness.service.resolve(USER_ID, { year: 2026, month }),
      ),
    );

    expect(meses.map((m) => m.amount)).toEqual([4000, 4500, 4500, 5000]);
  });

  it('alterar entrada intermediária mantém as vizinhas', async () => {
    // Item 31: jan=4000, abr=4500, ago=5000 → abr passa a 4700.
    const harness = buildHarness([
      { year: 2026, month: 1, amount: 4000 },
      { year: 2026, month: 4, amount: 4500 },
      { year: 2026, month: 8, amount: 5000 },
    ]);

    await harness.service.upsert(USER_ID, {
      year: 2026,
      month: 4,
      amount: 4700,
    });

    const meses = await Promise.all(
      [3, 4, 7, 8].map((month) =>
        harness.service.resolve(USER_ID, { year: 2026, month }),
      ),
    );

    expect(meses.map((m) => m.amount)).toEqual([4000, 4700, 4700, 5000]);
  });
});

describe('Cache `User.salary`', () => {
  it('sincroniza quando a alteração afeta o mês corrente', async () => {
    const now = currentCompetence();
    const harness = buildHarness([]);

    await harness.service.upsert(USER_ID, {
      year: now.year,
      month: now.month,
      amount: 5000,
    });

    const cache = harness.writes.filter((w) => w.kind === 'cache');
    expect(cache.at(-1)?.salary).toBe(5000);
  });

  it('entrada FUTURA não antecipa o valor no cache', async () => {
    /**
     * Item 14/33: o usuário agenda um aumento para o mês seguinte.
     *
     * `User.salary` é a renda de HOJE. Antecipá-la faria o perfil exibir um
     * valor que ainda não vale, e qualquer tela sem mês passaria a mentir.
     * O cache é RECALCULADO pelo resolver, não copiado do valor gravado.
     */
    const now = currentCompetence();
    const future =
      now.month === 12
        ? { year: now.year + 1, month: 1 }
        : { year: now.year, month: now.month + 1 };

    const harness = buildHarness([
      { year: now.year, month: now.month, amount: 5000 },
    ]);

    await harness.service.upsert(USER_ID, { ...future, amount: 5500 });

    const cache = harness.writes.filter((w) => w.kind === 'cache');
    // Continua 5000: o mês corrente não mudou.
    expect(cache.at(-1)?.salary).toBe(5000);

    // Mas o mês futuro resolve o valor novo.
    const futuro = await harness.service.resolve(USER_ID, future);
    expect(futuro.amount).toBe(5500);
  });

  it('entrada PASSADA não altera o cache do mês corrente', async () => {
    const now = currentCompetence();
    const harness = buildHarness([
      { year: now.year, month: now.month, amount: 5000 },
    ]);

    await harness.service.upsert(USER_ID, {
      year: now.year - 1,
      month: 1,
      amount: 3000,
    });

    const cache = harness.writes.filter((w) => w.kind === 'cache');
    expect(cache.at(-1)?.salary).toBe(5000);
  });
});

describe('Helpers de competência', () => {
  it('compara cronologicamente, não numericamente', () => {
    // dez/2025 vem ANTES de jan/2026, embora 12 > 1.
    expect(
      compareCompetence({ year: 2025, month: 12 }, { year: 2026, month: 1 }),
    ).toBeLessThan(0);
  });

  it('a competência corrente respeita o fuso de Fortaleza', () => {
    /**
     * O servidor roda em UTC. Em 31/08 às 22h de Fortaleza já é 01/09 em UTC,
     * e `new Date().getMonth()` diria setembro — gravando a alteração no mês
     * errado na última noite do mês.
     */
    const utcVirouSetembro = new Date('2026-09-01T01:00:00.000Z');

    expect(currentCompetence(utcVirouSetembro)).toEqual({
      year: 2026,
      month: 8,
    });
    expect(
      isCurrentCompetence({ year: 2026, month: 8 }, utcVirouSetembro),
    ).toBe(true);
  });
});
