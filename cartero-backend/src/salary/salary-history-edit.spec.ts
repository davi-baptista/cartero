import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SalaryService } from './salary.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Edição de uma competência já cadastrada
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O caso concreto: "cadastrei meu salário de janeiro errado".
 *
 * A propriedade central é que corrigir UMA entrada não cria nem move nenhuma
 * outra. O modelo é de alterações pontuais com herança até a próxima — se a
 * edição materializasse fevereiro e março, a próxima correção de janeiro
 * deixaria de propagar, porque haveria entradas reais no caminho.
 */

interface Entry {
  id: string;
  userId: string;
  year: number;
  month: number;
  amount: number;
}

const OUTRO_USUARIO = 'user-2';

/** A trilha salarial do enunciado: jan 4500, abr 5000, ago 5500. */
function trilhaPadrao(): Entry[] {
  return [
    { id: 'e-jan', userId: USER_ID, year: 2026, month: 1, amount: 4500 },
    { id: 'e-abr', userId: USER_ID, year: 2026, month: 4, amount: 5000 },
    { id: 'e-ago', userId: USER_ID, year: 2026, month: 8, amount: 5500 },
  ];
}

/**
 * Duplo que respeita `userId`, `year` e `month` no `where`.
 *
 * Sem honrar `userId`, o teste de ownership passaria mesmo com o filtro
 * removido do serviço — que é justamente a proteção em questão.
 */
function buildHarness(entries: Entry[] = trilhaPadrao()) {
  const prisma: any = {
    salaryHistory: {
      findMany: vi.fn(async ({ where, orderBy }: any) => {
        void orderBy;
        return entries
          .filter((entry) => entry.userId === where.userId)
          .sort((a, b) => b.year - a.year || b.month - a.month)
          .map((entry) => ({ ...entry, amount: money(entry.amount) }));
      }),

      updateMany: vi.fn(async ({ where, data }: any) => {
        const alvos = entries.filter(
          (entry) =>
            entry.userId === where.userId &&
            entry.year === where.year &&
            entry.month === where.month,
        );
        for (const alvo of alvos) alvo.amount = data.amount;
        return { count: alvos.length };
      }),

      findFirst: vi.fn(async ({ where }: any) => {
        // Mesma regra do banco: última entrada com competência <= a pedida.
        const target = where.OR[1];
        const winner = entries
          .filter((entry) => entry.userId === where.userId)
          .filter(
            (entry) =>
              entry.year < target.year ||
              (entry.year === target.year && entry.month <= target.month.lte),
          )
          .sort((a, b) => b.year - a.year || b.month - a.month)[0];

        return winner
          ? {
              amount: money(winner.amount),
              year: winner.year,
              month: winner.month,
            }
          : null;
      }),
    },
    user: { update: vi.fn(async () => ({})) },
  };

  return {
    service: new SalaryService(prisma as PrismaService),
    prisma,
    entries,
  };
}

describe('Listagem do histórico', () => {
  it('devolve só entradas REAIS, da mais recente para a mais antiga', async () => {
    const { service } = buildHarness();

    const history = await service.list(USER_ID);

    expect(history).toHaveLength(3);
    expect(history.map((entry) => entry.month)).toEqual([8, 4, 1]);
    /*
      Fevereiro e março NÃO aparecem: são resolvidos por herança e não existem
      como registro. Materializá-los sugeriria que cada mês tem valor próprio.
    */
    expect(history.map((entry) => entry.month)).not.toContain(2);
    expect(history.map((entry) => entry.month)).not.toContain(3);
  });

  it('não vaza entradas de outro usuário', async () => {
    const { service } = buildHarness([
      ...trilhaPadrao(),
      { id: 'x', userId: OUTRO_USUARIO, year: 2026, month: 5, amount: 90000 },
    ]);

    const history = await service.list(USER_ID);

    expect(history).toHaveLength(3);
    expect(history.some((entry) => entry.amount === 90000)).toBe(false);
  });

  it('histórico vazio devolve lista vazia', async () => {
    const { service } = buildHarness([]);
    expect(await service.list(USER_ID)).toEqual([]);
  });
});

describe('Edição do valor de uma competência', () => {
  it('corrige a entrada existente', async () => {
    const { service, entries } = buildHarness();

    const result = await service.updateAmount(
      USER_ID,
      { year: 2026, month: 1 },
      4700,
    );

    expect(result).toMatchObject({ year: 2026, month: 1, amount: 4700 });
    expect(entries.find((entry) => entry.month === 1)?.amount).toBe(4700);
  });

  it('competência inexistente → 404, sem criar nada', async () => {
    const { service, entries } = buildHarness();

    await expect(
      service.updateAmount(USER_ID, { year: 2026, month: 3 }, 9999),
    ).rejects.toBeInstanceOf(NotFoundException);

    /*
      O ponto: PATCH não é upsert silencioso. Um mês digitado errado precisa
      falhar — criar março mudaria a renda resolvida de março em diante.
    */
    expect(entries).toHaveLength(3);
    expect(entries.some((entry) => entry.month === 3)).toBe(false);
  });

  it('não edita entrada de outro usuário', async () => {
    const alheia: Entry = {
      id: 'alheia',
      userId: OUTRO_USUARIO,
      year: 2026,
      month: 5,
      amount: 9000,
    };
    const { service } = buildHarness([...trilhaPadrao(), alheia]);

    await expect(
      service.updateAmount(USER_ID, { year: 2026, month: 5 }, 1),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Intocada — e 404, não 403: a existência da linha alheia não é revelada.
    expect(alheia.amount).toBe(9000);
  });

  it('a competência não muda: só o valor é reescrito', async () => {
    const { service, prisma, entries } = buildHarness();

    await service.updateAmount(USER_ID, { year: 2026, month: 1 }, 4700);

    const [{ data, where }] = prisma.salaryHistory.updateMany.mock.calls.map(
      (call: any[]) => call[0],
    );
    expect(Object.keys(data)).toEqual(['amount']);
    expect(where).toMatchObject({ userId: USER_ID, year: 2026, month: 1 });

    // O unique (userId, year, month) continua o mesmo.
    const jan = entries.find((entry) => entry.id === 'e-jan');
    expect(jan).toMatchObject({ year: 2026, month: 1 });
  });

  it('renda zero é válida', async () => {
    // Zero é renda conhecida (alguém entre empregos), não ausência de dado.
    const { service, entries } = buildHarness();

    await service.updateAmount(USER_ID, { year: 2026, month: 1 }, 0);

    expect(entries.find((entry) => entry.month === 1)?.amount).toBe(0);
  });
});

describe('Propagação: editar janeiro não toca abril nem agosto', () => {
  it('as outras entradas permanecem intactas', async () => {
    const { service, entries } = buildHarness();

    await service.updateAmount(USER_ID, { year: 2026, month: 1 }, 4700);

    expect(entries.find((entry) => entry.month === 4)?.amount).toBe(5000);
    expect(entries.find((entry) => entry.month === 8)?.amount).toBe(5500);
    // E nenhuma entrada nova foi criada para os meses herdados.
    expect(entries).toHaveLength(3);
  });

  it('jan/fev/mar passam a resolver o valor corrigido', async () => {
    const { service } = buildHarness();

    await service.updateAmount(USER_ID, { year: 2026, month: 1 }, 4700);

    for (const month of [1, 2, 3]) {
      const resolved = await service.resolve(USER_ID, { year: 2026, month });
      expect(resolved.amount).toBe(4700);
      /*
        `effectiveFrom` continua apontando para JANEIRO mesmo ao resolver
        março: o valor é herdado, não um registro próprio de março.
      */
      expect(resolved.effectiveFrom).toEqual({ year: 2026, month: 1 });
    }
  });

  it('abril em diante continua com o próprio valor', async () => {
    const { service } = buildHarness();

    await service.updateAmount(USER_ID, { year: 2026, month: 1 }, 4700);

    const abril = await service.resolve(USER_ID, { year: 2026, month: 4 });
    expect(abril.amount).toBe(5000);
    expect(abril.effectiveFrom).toEqual({ year: 2026, month: 4 });

    const julho = await service.resolve(USER_ID, { year: 2026, month: 7 });
    expect(julho.amount).toBe(5000);

    const agosto = await service.resolve(USER_ID, { year: 2026, month: 8 });
    expect(agosto.amount).toBe(5500);
    expect(agosto.effectiveFrom).toEqual({ year: 2026, month: 8 });
  });

  it('meses anteriores à primeira entrada seguem desconhecidos', async () => {
    const { service } = buildHarness();

    await service.updateAmount(USER_ID, { year: 2026, month: 1 }, 4700);

    const dezembro = await service.resolve(USER_ID, { year: 2025, month: 12 });
    expect(dezembro.known).toBe(false);
    expect(dezembro.amount).toBeNull();
  });

  it('editar a última entrada propaga para o futuro', async () => {
    const { service } = buildHarness();

    await service.updateAmount(USER_ID, { year: 2026, month: 8 }, 6000);

    for (const competence of [
      { year: 2026, month: 8 },
      { year: 2026, month: 12 },
      { year: 2027, month: 3 },
    ]) {
      expect((await service.resolve(USER_ID, competence)).amount).toBe(6000);
    }
    // E janeiro continua onde estava.
    expect(
      (await service.resolve(USER_ID, { year: 2026, month: 1 })).amount,
    ).toBe(4500);
  });
});

describe('Cache User.salary após a correção', () => {
  /*
    Relógio fixo: sem ele o teste passaria a afirmar outra coisa conforme a
    data real avança, e um dia deixaria de proteger o que foi escrito para
    proteger.
  */
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 15, 12)));
  });
  afterEach(() => vi.useRealTimers());

  it('corrigir o passado NÃO muda a renda de hoje', async () => {
    const { service, prisma } = buildHarness();

    await service.updateAmount(USER_ID, { year: 2026, month: 1 }, 4700);

    /*
      Hoje é agosto: a renda vigente é a de agosto (5500). O cache é
      RECALCULADO pelo resolver, nunca copiado do valor recém-gravado — senão
      corrigir janeiro faria o perfil exibir 4700.
    */
    const [{ data }] = prisma.user.update.mock.calls.map(
      (call: any[]) => call[0],
    );
    expect(data.salary).toBe(5500);
  });

  it('corrigir a competência corrente ATUALIZA a renda de hoje', async () => {
    const { service, prisma } = buildHarness();

    await service.updateAmount(USER_ID, { year: 2026, month: 8 }, 6000);

    const [{ data }] = prisma.user.update.mock.calls.map(
      (call: any[]) => call[0],
    );
    expect(data.salary).toBe(6000);
  });
});
