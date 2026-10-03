import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { encodeCursor } from 'src/common/pagination/cursor.helper';
import { financialCivilDay } from 'src/common/helpers/financial-timezone.helper';
import { ObligationsService } from './obligations.service';
import { ObligationDomain, ObligationSection } from './obligations.types';
import type {
  GetObligationsDto,
  GetObligationsSummaryDto,
} from './dto/get-obligations.dto';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PERSON_ID = '22222222-2222-4222-8222-222222222222';
const RECEIVABLE_ID = '33333333-3333-4333-8333-333333333333';
const DEBT_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-10-15T16:00:00.000Z');

function row(
  domain: ObligationDomain.RECEIVABLE | ObligationDomain.DEBT,
  id: string,
  dueDate: string,
  resolvedAt: string | null = null,
) {
  return {
    domain,
    id,
    title: 'Conta',
    amount: '12.30',
    description: null,
    personId: null,
    personName: null,
    counterpartyName: 'Contato',
    dueDate: new Date(`${dueDate}T12:00:00.000Z`),
    isResolved: resolvedAt !== null,
    resolvedAt: resolvedAt ? new Date(`${resolvedAt}T12:00:00.000Z`) : null,
    paymentTransactionId: null,
  };
}

function setup(rawPages: unknown[][] = []) {
  const raw = vi.fn(async () => rawPages.shift() ?? []);
  const personFindFirst = vi.fn(async () => ({ id: PERSON_ID }));
  const service = new ObligationsService({
    $queryRaw: raw,
    person: { findFirst: personFindFirst },
  } as never);
  return { service, raw, personFindFirst };
}

function dto(overrides: Partial<GetObligationsDto> = {}): GetObligationsDto {
  return {
    section: ObligationSection.OPEN,
    domain: ObligationDomain.ALL,
    month: 10,
    year: 2026,
    limit: 20,
    ...overrides,
  } as GetObligationsDto;
}

function sqlOf(call: unknown[]) {
  return call[0] as Prisma.Sql;
}

function hasDate(query: Prisma.Sql, iso: string) {
  const time = new Date(iso).getTime();
  return query.values.some(
    (value) => value instanceof Date && value.getTime() === time,
  );
}

describe('ObligationsService unified read model', () => {
  it('uses a DB-bounded UNION ALL and user scoping in both branches', async () => {
    const { service, raw } = setup();
    await service.findAll(USER_ID, 'America/Sao_Paulo', dto(), NOW);
    const query = sqlOf(raw.mock.calls[0] as unknown[]);
    expect(query.sql).toContain('UNION ALL');
    expect(query.sql.match(/[rd]."userId" = \?/g)).toHaveLength(2);
    expect(query.sql).toContain('LIMIT ?');
    expect(query.values.filter((value) => value === USER_ID)).toHaveLength(2);
  });

  it('classifies overdue globally and uses the strict civil-day boundary', async () => {
    const { service, raw } = setup();
    await service.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({
        section: ObligationSection.OVERDUE,
        month: undefined,
        year: undefined,
      }),
      NOW,
    );
    const query = sqlOf(raw.mock.calls[0] as unknown[]);
    expect(query.sql).toContain('r."isPaid" = FALSE AND r."dueDate" < ?');
    expect(query.sql).toContain('d."isPaid" = FALSE AND d."dueDate" < ?');
    expect(hasDate(query, '2026-10-15T00:00:00.000Z')).toBe(true);
    expect(query.sql).not.toContain('"dueDate" >= ?');
  });

  it('bounds OPEN to month plus today, including a due date of today', async () => {
    const { service, raw } = setup();
    await service.findAll(USER_ID, 'America/Sao_Paulo', dto(), NOW);
    const query = sqlOf(raw.mock.calls[0] as unknown[]);
    expect(query.sql).toContain('r."dueDate" >= ?');
    expect(query.sql).toContain('r."dueDate" < ?');
    expect(query.sql).toContain('d."dueDate" >= ?');
    expect(hasDate(query, '2026-10-15T00:00:00.000Z')).toBe(true);
    expect(hasDate(query, '2026-10-01T00:00:00.000Z')).toBe(true);
    expect(hasDate(query, '2026-11-01T00:00:00.000Z')).toBe(true);
  });

  it('uses paidAt then linked payment transaction date for HISTORY', async () => {
    const { service, raw } = setup();
    await service.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({ section: ObligationSection.HISTORY }),
      NOW,
    );
    const query = sqlOf(raw.mock.calls[0] as unknown[]);
    expect(
      query.sql.match(/COALESCE\(r\."paidAt", pt\."date"\)/g),
    ).toHaveLength(1);
    expect(query.sql).toContain('COALESCE(d."paidAt", pt."date")');
    expect(query.sql).toContain('WHEN r."paidAt" IS NOT NULL THEN r."paidAt"');
    expect(query.sql).toContain('WHEN d."paidAt" IS NOT NULL THEN d."paidAt"');
    expect(query.sql).toContain(
      'pt."date" AT TIME ZONE \'UTC\' AT TIME ZONE ?',
    );
    expect(
      query.values.filter((value) => value === 'America/Sao_Paulo'),
    ).toHaveLength(4);
    expect(query.sql).toContain('"resolvedAt" DESC');
    expect(query.sql).not.toContain('"createdAt"');
    expect(query.sql).not.toContain('"updatedAt"');
  });

  it('filters each domain in SQL and uses a deterministic explicit domain rank', async () => {
    const { service, raw } = setup();
    await service.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({ domain: ObligationDomain.RECEIVABLE }),
      NOW,
    );
    const query = sqlOf(raw.mock.calls[0] as unknown[]);
    expect(query.sql).toContain('AND TRUE');
    expect(query.sql).toContain('AND FALSE');
    expect(query.sql).toContain("WHEN 'RECEIVABLE' THEN");
    expect(query.sql).toContain("WHEN 'DEBT' THEN");
    expect(query.sql).toContain('ORDER BY "dueDate" ASC');
  });

  it('searches both domains with bound parameters before pagination', async () => {
    const { service, raw } = setup();
    const search = "%_' OR TRUE --";
    await service.findAll(USER_ID, 'America/Sao_Paulo', dto({ search }), NOW);
    const query = sqlOf(raw.mock.calls[0] as unknown[]);
    expect(query.sql).toContain("ILIKE ? ESCAPE E'\\\\'");
    expect(query.sql).not.toContain(search);
    expect(query.values).toContain(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    expect(query.sql).toContain('rp."name"');
    expect(query.sql).toContain('r."debtorName"');
    expect(query.sql).toContain('dp."name"');
    expect(query.sql).toContain('d."creditorName"');
  });

  it('applies person filters to both domains and validates user ownership', async () => {
    const { service, raw, personFindFirst } = setup();
    await service.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({ personId: PERSON_ID }),
      NOW,
    );
    expect(personFindFirst).toHaveBeenCalledWith({
      where: { id: PERSON_ID, userId: USER_ID },
      select: { id: true },
    });
    const query = sqlOf(raw.mock.calls[0] as unknown[]);
    expect(query.sql).toContain('r."personId" = ?');
    expect(query.sql).toContain('d."personId" = ?');
    expect(query.values.filter((value) => value === PERSON_ID)).toHaveLength(2);

    personFindFirst.mockResolvedValueOnce(null as never);
    await expect(
      service.findAll(
        USER_ID,
        'America/Sao_Paulo',
        dto({ personId: PERSON_ID }),
        NOW,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('uses three independent section cursors with stable mixed-domain ties', async () => {
    const overdueRows = [
      row(ObligationDomain.RECEIVABLE, RECEIVABLE_ID, '2026-08-01'),
      row(ObligationDomain.DEBT, DEBT_ID, '2026-08-01'),
      row(
        ObligationDomain.DEBT,
        '55555555-5555-4555-8555-555555555555',
        '2026-08-01',
      ),
      row(
        ObligationDomain.DEBT,
        '66666666-6666-4666-8666-666666666666',
        '2026-08-02',
      ),
    ];
    const { service } = setup([overdueRows]);
    const first = await service.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({ section: ObligationSection.OVERDUE, limit: 2 }),
      NOW,
    );
    expect(first.items.map(({ domain }) => domain)).toEqual([
      ObligationDomain.RECEIVABLE,
      ObligationDomain.DEBT,
    ]);
    expect(first.pageInfo.hasMore).toBe(true);
    const cursor = first.pageInfo.nextCursor!;
    const { service: secondService, raw: secondRaw } = setup([
      [overdueRows[2], overdueRows[3]],
    ]);
    const second = await secondService.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({ section: ObligationSection.OVERDUE, limit: 2, cursor }),
      NOW,
    );
    expect(second.items.map(({ id }) => id)).toEqual([
      overdueRows[2].id,
      overdueRows[3].id,
    ]);
    expect(second.pageInfo).toEqual({ hasMore: false, nextCursor: null });
    expect(sqlOf(secondRaw.mock.calls[0] as unknown[]).sql).toContain(
      '"dueDate" > ?',
    );
  });

  it('uses resolvedAt DESC with domain/id tie-breaks for history cursors', async () => {
    const historyRows = [
      row(
        ObligationDomain.RECEIVABLE,
        RECEIVABLE_ID,
        '2026-08-01',
        '2026-10-14',
      ),
      row(ObligationDomain.DEBT, DEBT_ID, '2026-08-02', '2026-10-14'),
      row(
        ObligationDomain.DEBT,
        '55555555-5555-4555-8555-555555555555',
        '2026-08-03',
        '2026-10-13',
      ),
    ];
    const { service } = setup([historyRows]);
    const first = await service.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({ section: ObligationSection.HISTORY, limit: 2 }),
      NOW,
    );
    expect(first.items.map(({ domain }) => domain)).toEqual([
      ObligationDomain.RECEIVABLE,
      ObligationDomain.DEBT,
    ]);
    const { service: nextService, raw } = setup([[historyRows[2]]]);
    const next = await nextService.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({
        section: ObligationSection.HISTORY,
        limit: 2,
        cursor: first.pageInfo.nextCursor!,
      }),
      NOW,
    );
    expect(next.items.map(({ id }) => id)).toEqual([historyRows[2].id]);
    expect(sqlOf(raw.mock.calls[0] as unknown[]).sql).toContain(
      '"resolvedAt" < ?',
    );
  });

  it('pages OPEN independently across same-date Receivable and Debt rows', async () => {
    const openRows = [
      row(ObligationDomain.RECEIVABLE, RECEIVABLE_ID, '2026-10-15'),
      row(ObligationDomain.DEBT, DEBT_ID, '2026-10-15'),
      row(
        ObligationDomain.DEBT,
        '55555555-5555-4555-8555-555555555555',
        '2026-10-15',
      ),
    ];
    const { service } = setup([openRows]);
    const first = await service.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({ section: ObligationSection.OPEN, limit: 2 }),
      NOW,
    );
    expect(first.items.map(({ domain }) => domain)).toEqual([
      ObligationDomain.RECEIVABLE,
      ObligationDomain.DEBT,
    ]);
    const { service: nextService, raw } = setup([[openRows[2]]]);
    const next = await nextService.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({
        section: ObligationSection.OPEN,
        limit: 2,
        cursor: first.pageInfo.nextCursor!,
      }),
      NOW,
    );
    expect(next.items.map(({ id }) => id)).toEqual([openRows[2].id]);
    expect(sqlOf(raw.mock.calls[0] as unknown[]).sql).toContain(
      '"dueDate" > ?',
    );
  });

  it('rejects malformed and cross-section cursors with HTTP 400', async () => {
    const { service, raw } = setup();
    await expect(
      service.findAll(
        USER_ID,
        'America/Sao_Paulo',
        dto({ cursor: 'not-a-cursor' }),
        NOW,
      ),
    ).rejects.toThrow(BadRequestException);
    const overdueCursor = encodeCursor({
      version: 1,
      section: ObligationSection.OVERDUE,
      date: '2026-08-01T12:00:00.000Z',
      domain: ObligationDomain.RECEIVABLE,
      id: RECEIVABLE_ID,
    });
    await expect(
      service.findAll(
        USER_ID,
        'America/Sao_Paulo',
        dto({ cursor: overdueCursor, section: ObligationSection.OPEN }),
        NOW,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(raw).not.toHaveBeenCalled();
  });

  it('does not infer HISTORY for paid legacy rows without either resolution date', async () => {
    const { service, raw } = setup();
    await service.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({ section: ObligationSection.HISTORY }),
      NOW,
    );
    const query = sqlOf(raw.mock.calls[0] as unknown[]);
    expect(query.sql).toContain('WHEN r."paidAt" IS NOT NULL THEN r."paidAt"');
    expect(query.sql).toContain('WHEN d."paidAt" IS NOT NULL THEN d."paidAt"');
    expect(query.sql).toContain(
      'pt."date" AT TIME ZONE \'UTC\' AT TIME ZONE ?',
    );
    expect(query.sql).toContain('pt."userId" = r."userId"');
    expect(query.sql).toContain('pt."userId" = d."userId"');
  });

  it('classifies legacy HISTORY transaction instants by account civil month with a bound timezone', async () => {
    const lateOctober = new Date('2026-11-01T02:30:00.000Z');
    const earlyNovember = new Date('2026-11-01T03:30:00.000Z');
    expect(financialCivilDay(lateOctober, 'America/Fortaleza')).toBe(
      '2026-10-31',
    );
    expect(financialCivilDay(earlyNovember, 'America/Fortaleza')).toBe(
      '2026-11-01',
    );

    for (const timeZone of ['America/Fortaleza', 'America/Sao_Paulo']) {
      const { service, raw } = setup();
      await service.findAll(
        USER_ID,
        timeZone,
        dto({ section: ObligationSection.HISTORY, month: 10, year: 2026 }),
        NOW,
      );
      const query = sqlOf(raw.mock.calls[0] as unknown[]);
      expect(query.sql).toContain("AT TIME ZONE 'UTC' AT TIME ZONE ?");
      expect(query.values).toContain(timeZone);
      expect(query.sql).not.toContain(timeZone);
    }
  });

  it('returns empty sections as an empty page', async () => {
    const { service } = setup([[]]);
    await expect(
      service.findAll(
        USER_ID,
        'America/Sao_Paulo',
        dto({ section: ObligationSection.OVERDUE }),
        NOW,
      ),
    ).resolves.toEqual({
      items: [],
      pageInfo: { hasMore: false, nextCursor: null },
    });
  });

  it('computes monthly summary with domain/person filters but never search', async () => {
    const result = [
      {
        overdueReceivableAmount: '90.00',
        overdueDebtAmount: '20.00',
        overdueNetAmount: '70.00',
        openReceivableAmount: '90.00',
        openDebtAmount: '0.00',
        openNetAmount: '90.00',
      },
    ];
    const { service, raw } = setup([result]);
    const summaryDto = {
      month: 10,
      year: 2026,
      domain: ObligationDomain.RECEIVABLE,
      personId: PERSON_ID,
    } as GetObligationsSummaryDto;
    await expect(
      service.getSummary(USER_ID, 'America/Sao_Paulo', summaryDto, NOW),
    ).resolves.toEqual({
      overdue: { receivable: '90.00', debt: '20.00', net: '70.00' },
      open: { receivable: '90.00', debt: '0.00', net: '90.00' },
    });
    const query = sqlOf(raw.mock.calls[0] as unknown[]);
    expect(query.sql).toContain('r."personId" =');
    expect(query.sql).toContain('d."personId" =');
    expect(query.sql).toContain('r."dueDate" <');
    expect(query.sql).toContain('d."dueDate" <');
    expect(query.sql).toContain('r."dueDate" >=');
    expect(query.sql).toContain('d."dueDate" >=');
    expect(query.sql).toContain('r."isPaid" = FALSE');
    expect(query.sql).toContain('d."isPaid" = FALSE');
    expect(query.sql).not.toContain('ILIKE');
    expect(query.values).not.toContain('%search%');
    expect(query.values).toContain(ObligationDomain.RECEIVABLE);
    expect(query.values.filter((value) => value === PERSON_ID)).toHaveLength(4);
    expect(query.sql).toContain('"overdueNetAmount"');
    expect(query.sql).toContain('"openNetAmount"');
    expect(query.sql).toContain("section = 'OVERDUE'");
    expect(query.sql).toContain("section = 'OPEN'");
    expect(query.sql).toContain(
      "COALESCE(SUM(amount) FILTER (WHERE section = 'OVERDUE' AND domain = 'RECEIVABLE'), 0)",
    );
    expect(query.sql).toContain(
      "COALESCE(SUM(amount) FILTER (WHERE section = 'OVERDUE' AND domain = 'DEBT'), 0))::text AS \"overdueNetAmount\"",
    );
    expect(
      query.values.filter((value) => value === ObligationDomain.RECEIVABLE),
    ).toHaveLength(4);
    const overdueReceivableBranch = query.sql.slice(
      query.sql.indexOf('CASE WHEN r."dueDate"'),
      query.sql.indexOf(
        'UNION ALL',
        query.sql.indexOf('CASE WHEN r."dueDate"'),
      ),
    );
    expect(overdueReceivableBranch).toContain('CASE WHEN r."dueDate" <');
    expect(overdueReceivableBranch).toContain("THEN 'OVERDUE' ELSE 'OPEN'");
    expect(overdueReceivableBranch).toContain('r."dueDate" >=');
    expect(overdueReceivableBranch).toContain('r."dueDate" <');
    expect(overdueReceivableBranch).not.toContain('monthStart');
    expect(query.sql).not.toContain('LIMIT');
  });

  it('requires month/year for OPEN and HISTORY but not OVERDUE', async () => {
    const { service, raw } = setup([[]]);
    await expect(
      service.findAll(
        USER_ID,
        'America/Sao_Paulo',
        dto({ month: undefined, year: undefined }),
        NOW,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.findAll(
        USER_ID,
        'America/Sao_Paulo',
        dto({
          section: ObligationSection.OVERDUE,
          month: undefined,
          year: undefined,
        }),
        NOW,
      ),
    ).resolves.toMatchObject({ items: [] });
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('keeps obligations reads pure without materializing recurring income', async () => {
    const { service, raw } = setup([[], []]);
    await service.findAll(USER_ID, 'America/Sao_Paulo', dto(), NOW);
    expect(raw).toHaveBeenCalledOnce();
    await service.getSummary(
      USER_ID,
      'America/Sao_Paulo',
      {
        month: 10,
        year: 2026,
        domain: ObligationDomain.ALL,
      },
      NOW,
    );
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it('keeps credit card debt inside the debt domain without invoice rows', async () => {
    const { service, raw } = setup();
    await service.findAll(
      USER_ID,
      'America/Sao_Paulo',
      dto({ domain: ObligationDomain.DEBT }),
      NOW,
    );
    const query = sqlOf(raw.mock.calls[0] as unknown[]);
    expect(query.sql).toContain('FROM "Debt" d');
    expect(query.sql).toContain('AND FALSE');
    expect(query.sql).not.toContain('"Invoice"');
  });
});
