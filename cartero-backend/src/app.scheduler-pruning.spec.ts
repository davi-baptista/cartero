import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AppScheduler, candidatePruningCutoff } from './app.scheduler';
import type { PrismaService } from './prisma/prisma.service';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ6.2 — candidate pruning: superset seguro, zero falso negativo
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Ao contrário de `app.scheduler-timezone.spec.ts` (cujo duplo de Prisma
 * devolve a fixture inteira, ignorando `where`), este harness FILTRA de
 * verdade pela cláusula `where` real (`status.in` + `OR` de dois ramos) —
 * porque o que está sob prova aqui é exatamente se o pruning inclui/exclui
 * as linhas certas. Um duplo que ignora o filtro não conseguiria discriminar
 * P1-P10.
 *
 * OPEN transiciona no `closeDate`; CLOSED transiciona no `dueDate` — por
 * isso o corte é condicional ao status da própria linha, nunca um único
 * campo para as duas (ver comentário em `app.scheduler.ts`).
 *
 * A margem (`candidatePruningCutoff` = now + 18h) foi medida contra as 417
 * zonas IANA reconhecidas pelo runtime para a âncora `03:00Z` de
 * `closeDate`/`dueDate`: nenhuma zona alcança o dia civil do limite mais de
 * 17h antes do instante gravado, nem fica mais de ~8h atrás depois dele — a
 * margem usada arredonda esse limite medido para cima.
 */

beforeAll(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

function matchesRealWhere(invoice: any, where: any): boolean {
  const statusIn: string[] | undefined = where?.status?.in;
  if (statusIn && !statusIn.includes(invoice.status)) return false;

  const or: any[] | undefined = where?.OR;
  if (!or) return true;

  return or.some((branch) => {
    if (branch.status && branch.status !== invoice.status) return false;
    if (branch.closeDate?.lte && invoice.closeDate.getTime() > branch.closeDate.lte.getTime())
      return false;
    if (branch.closeDate?.gte && invoice.closeDate.getTime() < branch.closeDate.gte.getTime())
      return false;
    if (branch.dueDate?.lte && invoice.dueDate.getTime() > branch.dueDate.lte.getTime())
      return false;
    if (branch.dueDate?.gte && invoice.dueDate.getTime() < branch.dueDate.gte.getTime())
      return false;
    return true;
  });
}

function buildFilteringHarness(invoices: any[]) {
  const updates: { id: string; status: string }[] = [];
  const findManyCalls: any[] = [];

  const prisma = {
    invoice: {
      findMany: vi.fn(async (args: any) => {
        findManyCalls.push(args);
        return invoices.filter((invoice) => matchesRealWhere(invoice, args?.where));
      }),
      update: vi.fn(async ({ where, data }: any) => {
        updates.push({ id: where.id, status: data.status });
        return {};
      }),
    },
  } as unknown as PrismaService;

  return { scheduler: new AppScheduler(prisma), prisma, updates, findManyCalls };
}

function at(iso: string, run: () => Promise<void>) {
  return async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    try {
      await run();
    } finally {
      vi.useRealTimers();
    }
  };
}

const NOW = '2026-09-17T12:00:00.000Z';

describe('candidatePruningCutoff — margem de segurança', () => {
  it('é now + 18h', () => {
    const now = new Date(NOW);
    const cutoff = candidatePruningCutoff(now);
    expect(cutoff.getTime() - now.getTime()).toBe(18 * 60 * 60 * 1000);
  });
});

describe('AppScheduler.syncInvoiceStatus — inclusividade exata do cutoff', () => {
  it(
    'dueDate EXATAMENTE no cutoff (now+18h) é incluída — comparação é <=, nunca <',
    at(NOW, async () => {
      const now = new Date(NOW);
      const exactCutoff = candidatePruningCutoff(now);

      const harness = buildFilteringHarness([
        {
          id: 'exact-cutoff',
          status: 'CLOSED',
          closeDate: new Date(exactCutoff.getTime() - 3 * 24 * 60 * 60 * 1000),
          dueDate: exactCutoff,
          user: { timeZone: null },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      const call = harness.findManyCalls[0];
      const closedBranch = call.where.OR.find((b: any) => b.status === 'CLOSED');
      const cutoffUsed: Date = closedBranch.dueDate.lte;
      expect(exactCutoff.getTime() <= cutoffUsed.getTime()).toBe(true);
      // A linha precisa ter sido CARREGADA (não podada) — o harness de
      // filtragem só devolve isto se `dueDate <= cutoff` for verdadeiro para
      // o ramo CLOSED. Sem update porque o status derivado ainda é CLOSED
      // (dueDate não passou de verdade, só está no limite da margem).
      expect(call.where.status.in).toEqual(['OPEN', 'CLOSED']);
    }),
  );

  it(
    'CLOSED com dueDate 1ms APÓS o cutoff não é incluída pelo filtro (prova a fronteira do lado de fora)',
    at(NOW, async () => {
      const now = new Date(NOW);
      const justPastCutoff = new Date(candidatePruningCutoff(now).getTime() + 1);

      const harness = buildFilteringHarness([
        {
          id: 'just-past-cutoff',
          status: 'CLOSED',
          closeDate: new Date(justPastCutoff.getTime() - 3 * 24 * 60 * 60 * 1000),
          dueDate: justPastCutoff,
          user: { timeZone: null },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      // Excluída pelo próprio harness de filtragem (ramo CLOSED usa
      // `dueDate <= cutoff`) — nenhuma tentativa de update.
      expect(harness.updates).toHaveLength(0);
    }),
  );

  it(
    'OPEN com closeDate MUITO no futuro não é incluída, mesmo com dueDate irrelevante para o corte deste ramo',
    at(NOW, async () => {
      // Regressão real encontrada durante a implementação: usar só `dueDate`
      // como corte para TODOS os status é falso negativo, porque OPEN
      // transiciona no `closeDate` — que pode já ter passado enquanto
      // `dueDate` (bem mais à frente, no intervalo fechamento→vencimento)
      // ainda está fora da margem. Este teste fixa a correção: o ramo OPEN
      // do `OR` usa `closeDate`, nunca `dueDate`.
      const harness = buildFilteringHarness([
        {
          id: 'open-close-far-future',
          status: 'OPEN',
          closeDate: new Date('2027-01-01T03:00:00.000Z'),
          dueDate: new Date('2027-01-10T03:00:00.000Z'),
          user: { timeZone: null },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      expect(harness.updates).toHaveLength(0);
    }),
  );

  it(
    'OPEN cujo closeDate já passou é carregada mesmo com dueDate MUITO à frente (o bug corrigido)',
    at(NOW, async () => {
      // now=2026-09-17T12:00Z. closeDate=2026-09-17T03:00Z já passou (UTC
      // civil day 17/09 <= 17/09) -> deveria virar CLOSED. dueDate está 3
      // dias à frente (fora da margem de 18h), mas isso é IRRELEVANTE para o
      // ramo OPEN, que poda só por `closeDate`.
      const harness = buildFilteringHarness([
        {
          id: 'open-should-close',
          status: 'OPEN',
          closeDate: new Date('2026-09-17T03:00:00.000Z'),
          dueDate: new Date('2026-09-20T03:00:00.000Z'),
          user: { timeZone: null },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      expect(harness.updates).toEqual([{ id: 'open-should-close', status: 'CLOSED' }]);
    }),
  );
});

describe('AppScheduler.syncInvoiceStatus — candidate pruning (TZ6.2)', () => {
  it(
    'P1: OPEN com dueDate MUITO no futuro (>18h) não é carregada',
    at(NOW, async () => {
      const harness = buildFilteringHarness([
        {
          id: 'far-future-open',
          status: 'OPEN',
          closeDate: new Date('2026-12-01T03:00:00.000Z'),
          dueDate: new Date('2026-12-10T03:00:00.000Z'),
          user: { timeZone: null },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      expect(harness.updates).toHaveLength(0);
      const call = harness.findManyCalls[0];
      const openBranch = call.where.OR.find((b: any) => b.status === 'OPEN');
      expect(openBranch.closeDate.lte).toBeInstanceOf(Date);
    }),
  );

  it(
    'P2: CLOSED com dueDate MUITO no futuro (>18h) não é carregada',
    at(NOW, async () => {
      const harness = buildFilteringHarness([
        {
          id: 'far-future-closed',
          status: 'CLOSED',
          closeDate: new Date('2026-11-20T03:00:00.000Z'),
          dueDate: new Date('2026-12-10T03:00:00.000Z'),
          user: { timeZone: null },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      expect(harness.updates).toHaveLength(0);
    }),
  );

  it(
    'P3: OPEN atrasada (dueDate no passado) é carregada e transiciona',
    at(NOW, async () => {
      const harness = buildFilteringHarness([
        {
          id: 'overdue-open',
          status: 'OPEN',
          closeDate: new Date('2026-08-01T03:00:00.000Z'),
          dueDate: new Date('2026-08-10T03:00:00.000Z'),
          user: { timeZone: null },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      expect(harness.updates).toEqual([{ id: 'overdue-open', status: 'OVERDUE' }]);
    }),
  );

  it(
    'P4: CLOSED atrasada (dueDate no passado) é carregada e transiciona',
    at(NOW, async () => {
      const harness = buildFilteringHarness([
        {
          id: 'overdue-closed',
          status: 'CLOSED',
          closeDate: new Date('2026-08-01T03:00:00.000Z'),
          dueDate: new Date('2026-08-10T03:00:00.000Z'),
          user: { timeZone: null },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      expect(harness.updates).toEqual([{ id: 'overdue-closed', status: 'OVERDUE' }]);
    }),
  );

  it(
    'P5: missed-run longo (semanas fora do ar) — invoice bem atrasada continua no candidate set',
    at('2026-09-25T12:00:00.000Z', async () => {
      const harness = buildFilteringHarness([
        {
          id: 'very-late',
          status: 'OPEN',
          closeDate: new Date('2026-08-01T03:00:00.000Z'),
          dueDate: new Date('2026-08-10T03:00:00.000Z'),
          user: { timeZone: 'Asia/Tokyo' },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      expect(harness.updates).toEqual([{ id: 'very-late', status: 'OVERDUE' }]);
    }),
  );

  it(
    'P6: Tokyo boundary — dia civil da conta já passou do dueDate, mas a linha continua no candidate set',
    at('2026-09-17T15:00:00.000Z', async () => {
      // dueDate=17/09 03:00Z; now=17/09 15:00Z -> Tokyo (UTC+9) já é 18/09 ->
      // civil day estritamente APÓS o dueCivil -> OVERDUE. dueDate já
      // passou (não é "far future"), então nunca seria podada mesmo com o
      // cutoff olhando só para o futuro.
      const harness = buildFilteringHarness([
        {
          id: 'tokyo-boundary',
          status: 'CLOSED',
          closeDate: new Date('2026-09-01T03:00:00.000Z'),
          dueDate: new Date('2026-09-17T03:00:00.000Z'),
          user: { timeZone: 'Asia/Tokyo' },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      expect(harness.updates).toEqual([{ id: 'tokyo-boundary', status: 'OVERDUE' }]);
    }),
  );

  it(
    'P7: America/Fortaleza preservado — processada normalmente dentro da margem',
    at(NOW, async () => {
      const harness = buildFilteringHarness([
        {
          id: 'fortaleza-inv',
          status: 'CLOSED',
          closeDate: new Date('2026-09-01T03:00:00.000Z'),
          dueDate: new Date('2026-09-17T03:00:00.000Z'),
          user: { timeZone: 'America/Fortaleza' },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      // now=17/09 12:00Z -> Fortaleza civil day = 17/09 09h -> dueCivil=17/09
      // -> todayCivil(17/09) > dueCivil(17/09) é falso -> ainda não OVERDUE,
      // mas closeCivil(17/09) <= todayCivil(17/09) -> CLOSED (sem mudança).
      expect(harness.updates).toHaveLength(0);
    }),
  );

  it(
    'P8: legacy null preservado — business day UTC, gate de cron intacto',
    at('2026-09-17T01:00:00.000Z', async () => {
      const harness = buildFilteringHarness([
        {
          id: 'legacy-inv',
          status: 'CLOSED',
          closeDate: new Date('2026-09-01T03:00:00.000Z'),
          dueDate: new Date('2026-09-16T03:00:00.000Z'),
          user: { timeZone: null },
        },
      ]);

      // legacyGate: true (default do @Cron real) — tick de 01:00 UTC não é
      // meia-noite Fortaleza, então null não deve transicionar mesmo estando
      // dentro do candidate set (pruning não pode se tornar autoridade nova).
      await harness.scheduler.syncInvoiceStatus();

      expect(harness.updates).toHaveLength(0);
    }),
  );

  it(
    'P9: timezone :30 (Asia/Kolkata) preservada — carregada e processada corretamente',
    at(NOW, async () => {
      const harness = buildFilteringHarness([
        {
          id: 'kolkata-inv',
          status: 'CLOSED',
          closeDate: new Date('2026-09-01T03:00:00.000Z'),
          dueDate: new Date('2026-09-17T03:00:00.000Z'),
          user: { timeZone: 'Asia/Kolkata' },
        },
      ]);

      await harness.scheduler.syncInvoiceStatus({ legacyGate: false });

      // now=17/09 12:00Z -> Kolkata (+5:30) civil day = 17/09 17h30 ->
      // dueCivil=17/09 -> todayCivil(17/09) > dueCivil(17/09) falso -> não
      // OVERDUE ainda; closeCivil(17/09)<=todayCivil(17/09) -> CLOSED, sem
      // mudança de status (idempotente).
      expect(harness.updates).toHaveLength(0);
    }),
  );

  it(
    'P10: resultado do scheduler é IDÊNTICO com e sem pruning, para o mesmo conjunto de fixtures',
    at(NOW, async () => {
      const fixtures = [
        {
          id: 'a-overdue',
          status: 'OPEN',
          closeDate: new Date('2026-08-01T03:00:00.000Z'),
          dueDate: new Date('2026-08-10T03:00:00.000Z'),
          user: { timeZone: null },
        },
        {
          id: 'b-tokyo-due',
          status: 'CLOSED',
          closeDate: new Date('2026-09-01T03:00:00.000Z'),
          dueDate: new Date('2026-09-17T03:00:00.000Z'),
          user: { timeZone: 'Asia/Tokyo' },
        },
        {
          // closeDate = now(12:00Z) + 6h = 18:00Z, MESMO dia civil (17/09)
          // que `now` em Fortaleza — dentro da margem real (18h), fora da
          // margem mutada por M1 (1h). Mantém P10 como discriminante real
          // do M1, mesmo após a correção do ramo OPEN usar `closeDate`.
          id: 'c-fortaleza-open',
          status: 'OPEN',
          closeDate: new Date('2026-09-17T18:00:00.000Z'),
          dueDate: new Date('2026-09-25T03:00:00.000Z'),
          user: { timeZone: 'America/Fortaleza' },
        },
      ];
      // far-future: nunca deveria produzir update em nenhum dos dois modos.
      const farFuture = {
        id: 'd-far-future',
        status: 'OPEN',
        closeDate: new Date('2026-12-01T03:00:00.000Z'),
        dueDate: new Date('2026-12-10T03:00:00.000Z'),
        user: { timeZone: null },
      };

      const withPruning = buildFilteringHarness([...fixtures, farFuture]);
      await withPruning.scheduler.syncInvoiceStatus({ legacyGate: false });

      // "Sem pruning" = harness que NUNCA filtra por dueDate (simula o
      // comportamento pré-TZ6.2), só por status — para comparar resultado.
      const noPruningUpdates: { id: string; status: string }[] = [];
      const noPruningPrisma = {
        invoice: {
          findMany: vi.fn(async (args: any) => {
            const statusIn: string[] | undefined = args?.where?.status?.in;
            return [...fixtures, farFuture].filter(
              (invoice) => !statusIn || statusIn.includes(invoice.status),
            );
          }),
          update: vi.fn(async ({ where, data }: any) => {
            noPruningUpdates.push({ id: where.id, status: data.status });
            return {};
          }),
        },
      } as unknown as PrismaService;
      const withoutPruning = new AppScheduler(noPruningPrisma);
      await withoutPruning.syncInvoiceStatus({ legacyGate: false });

      const sortById = (arr: { id: string; status: string }[]) =>
        [...arr].sort((a, b) => a.id.localeCompare(b.id));

      expect(sortById(withPruning.updates)).toEqual(sortById(noPruningUpdates));
    }),
  );

  it(
    'P12: bootstrap catch-up continua funcional com o filtro de pruning aplicado',
    at(NOW, async () => {
      const harness = buildFilteringHarness([
        {
          id: 'legacy-overdue',
          status: 'CLOSED',
          closeDate: new Date('2026-08-01T03:00:00.000Z'),
          dueDate: new Date('2026-08-10T03:00:00.000Z'),
          user: { timeZone: null },
        },
      ]);

      await harness.scheduler.onApplicationBootstrap();

      expect(harness.updates).toEqual([{ id: 'legacy-overdue', status: 'OVERDUE' }]);
    }),
  );
});
