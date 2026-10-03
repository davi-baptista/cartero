import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  buildCursorPage,
  decodeCursor,
  type CursorPayload,
} from 'src/common/pagination/cursor.helper';
import { deriveBudgetV2MonthBounds } from 'src/common/helpers/financial-period.helper';
import { financialCivilDay } from 'src/common/helpers/financial-timezone.helper';
import {
  GetObligationsDto,
  GetObligationsSummaryDto,
} from './dto/get-obligations.dto';
import {
  ObligationDomain,
  ObligationSection,
  type ObligationPage,
  type ObligationRow,
  type ObligationSummary,
} from './obligations.types';

const DOMAIN_RECEIVABLE = 0;
const DOMAIN_DEBT = 1;

interface ObligationCursor extends CursorPayload {
  version: 1;
  section: ObligationSection;
  date: string;
  domain: Exclude<ObligationDomain, ObligationDomain.ALL>;
  id: string;
}

type ObligationDbRow = ObligationRow;

interface SummaryDbRow {
  overdueReceivableAmount: string;
  overdueDebtAmount: string;
  overdueNetAmount: string;
  openReceivableAmount: string;
  openDebtAmount: string;
  openNetAmount: string;
}

function isObligationCursor(value: unknown): value is ObligationCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).sort().join(',') !== 'date,domain,id,section,version'
  ) {
    return false;
  }
  if (
    payload.version !== 1 ||
    !Object.values(ObligationSection).includes(
      payload.section as ObligationSection,
    ) ||
    ![ObligationDomain.RECEIVABLE, ObligationDomain.DEBT].includes(
      payload.domain as ObligationDomain.RECEIVABLE | ObligationDomain.DEBT,
    ) ||
    typeof payload.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.id,
    ) ||
    typeof payload.date !== 'string'
  ) {
    return false;
  }
  const date = new Date(payload.date);
  return Number.isFinite(date.getTime()) && date.toISOString() === payload.date;
}

function domainRank(domain: ObligationCursor['domain']): number {
  return domain === ObligationDomain.RECEIVABLE
    ? DOMAIN_RECEIVABLE
    : DOMAIN_DEBT;
}

function domainCondition(
  domain: ObligationDomain,
  branch: ObligationCursor['domain'],
) {
  return domain === ObligationDomain.ALL || domain === branch
    ? Prisma.sql`TRUE`
    : Prisma.sql`FALSE`;
}

function personCondition(personId: string | undefined, alias: 'r' | 'd') {
  return personId
    ? Prisma.sql`${Prisma.raw(`${alias}."personId"`)} = ${personId}`
    : Prisma.sql`TRUE`;
}

function searchCondition(
  search: string | undefined,
  alias: 'r' | 'd',
  personAlias: 'rp' | 'dp',
  counterpartyColumn: 'debtorName' | 'creditorName',
) {
  if (!search) return Prisma.sql`TRUE`;
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  return Prisma.sql`(
    ${Prisma.raw(`${alias}."title"`)} ILIKE ${pattern} ESCAPE E'\\\\'
    OR ${Prisma.raw(`${alias}."description"`)} ILIKE ${pattern} ESCAPE E'\\\\'
    OR ${Prisma.raw(`${personAlias}."name"`)} ILIKE ${pattern} ESCAPE E'\\\\'
    OR (
      ${Prisma.raw(`${personAlias}."id"`)} IS NULL
      AND ${Prisma.raw(`${alias}."${counterpartyColumn}"`)} ILIKE ${pattern} ESCAPE E'\\\\'
    )
  )`;
}

function obligationBranch(
  userId: string,
  requestedDomain: ObligationDomain,
  branchDomain: Exclude<ObligationDomain, ObligationDomain.ALL>,
  section: ObligationSection,
  accountTodayStart: Date,
  monthStart: Date | null,
  monthEnd: Date | null,
  timeZone: string,
  personId?: string,
  search?: string,
) {
  const isReceivable = branchDomain === ObligationDomain.RECEIVABLE;
  const entityAlias = isReceivable ? 'r' : 'd';
  const personAlias = isReceivable ? 'rp' : 'dp';
  const entity = isReceivable
    ? Prisma.raw('"Receivable"')
    : Prisma.raw('"Debt"');
  const personColumn = Prisma.raw(`${entityAlias}."personId"`);
  const personTable = Prisma.raw('"Person"');
  const counterpartyColumn = isReceivable ? 'debtorName' : 'creditorName';
  const paymentJoin = isReceivable
    ? Prisma.sql`LEFT JOIN "Transaction" pt
        ON pt."id" = r."paymentTransactionId" AND pt."userId" = r."userId"`
    : Prisma.sql`LEFT JOIN "Transaction" pt
        ON pt."id" = d."paymentTransactionId" AND pt."userId" = d."userId"`;
  const id = Prisma.raw(`${entityAlias}."id"`);
  const entityUserId = Prisma.raw(`${entityAlias}."userId"`);
  const title = Prisma.raw(`${entityAlias}."title"`);
  const amount = Prisma.raw(`${entityAlias}."amount"`);
  const description = Prisma.raw(`${entityAlias}."description"`);
  const dueDate = Prisma.raw(`${entityAlias}."dueDate"`);
  const paidAt = Prisma.raw(`${entityAlias}."paidAt"`);
  const isPaid = Prisma.raw(`${entityAlias}."isPaid"`);
  const paymentTransactionId = Prisma.raw(
    `${entityAlias}."paymentTransactionId"`,
  );
  const counterparty = Prisma.raw(`${entityAlias}."${counterpartyColumn}"`);
  const resolution = Prisma.sql`COALESCE(${paidAt}, pt."date")`;
  const historyCivilResolution = Prisma.sql`CASE
    WHEN ${paidAt} IS NOT NULL THEN ${paidAt}
    ELSE (pt."date" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})
  END`;
  let sectionCondition: Prisma.Sql;

  if (section === ObligationSection.OVERDUE) {
    sectionCondition = Prisma.sql`${isPaid} = FALSE AND ${dueDate} < ${accountTodayStart}`;
  } else if (section === ObligationSection.OPEN) {
    sectionCondition = Prisma.sql`${isPaid} = FALSE
      AND ${dueDate} >= ${accountTodayStart}
      AND ${dueDate} >= ${monthStart!}
      AND ${dueDate} < ${monthEnd!}`;
  } else {
    sectionCondition = Prisma.sql`${isPaid} = TRUE
      AND ${historyCivilResolution} >= ${monthStart!}
      AND ${historyCivilResolution} < ${monthEnd!}`;
  }

  return Prisma.sql`
    SELECT
      ${isReceivable ? Prisma.sql`'RECEIVABLE'` : Prisma.sql`'DEBT'`}::text AS "domain",
      ${id}::text AS "id",
      ${title}::text AS "title",
      ${amount}::text AS "amount",
      ${description}::text AS "description",
      ${personColumn}::text AS "personId",
      ${Prisma.raw(`${personAlias}."name"`)}::text AS "personName",
      COALESCE(${Prisma.raw(`${personAlias}."name"`)}, ${counterparty})::text AS "counterpartyName",
      ${dueDate} AS "dueDate",
      ${isPaid} AS "isResolved",
      ${resolution} AS "resolvedAt",
      ${paymentTransactionId}::text AS "paymentTransactionId"
    FROM ${entity} ${Prisma.raw(entityAlias)}
    LEFT JOIN ${personTable} ${Prisma.raw(personAlias)}
      ON ${Prisma.raw(`${personAlias}."id"`)} = ${personColumn}
      AND ${Prisma.raw(`${personAlias}."userId"`)} = ${entityUserId}
    ${paymentJoin}
    WHERE ${entityUserId} = ${userId}
      AND ${domainCondition(requestedDomain, branchDomain)}
      AND ${personCondition(personId, entityAlias)}
      AND ${searchCondition(search, entityAlias, personAlias, counterpartyColumn)}
      AND ${sectionCondition}
  `;
}

@Injectable()
export class ObligationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    userId: string,
    timeZone: string,
    dto: GetObligationsDto,
    now = new Date(),
  ): Promise<ObligationPage> {
    this.validateMonth(dto.section, dto.month, dto.year);
    await this.validatePerson(dto.personId, userId);

    const today = financialCivilDay(now, timeZone);
    const todayStart = new Date(`${today}T00:00:00.000Z`);
    const bounds =
      dto.month !== undefined && dto.year !== undefined
        ? deriveBudgetV2MonthBounds(dto.month, dto.year, timeZone)
        : null;
    const monthStart = bounds?.period.startDate
      ? new Date(`${bounds.period.startDate}T00:00:00.000Z`)
      : null;
    const monthEnd = bounds
      ? new Date(`${bounds.period.endDate}T00:00:00.000Z`)
      : null;
    const cursor = dto.cursor
      ? decodeCursor(
          dto.cursor,
          isObligationCursor,
          'Invalid obligations cursor',
        )
      : null;
    if (cursor && cursor.section !== dto.section) {
      throw new BadRequestException('Obligations cursor section mismatch');
    }

    const receivables = obligationBranch(
      userId,
      dto.domain,
      ObligationDomain.RECEIVABLE,
      dto.section,
      todayStart,
      monthStart,
      monthEnd,
      timeZone,
      dto.personId,
      dto.search,
    );
    const debts = obligationBranch(
      userId,
      dto.domain,
      ObligationDomain.DEBT,
      dto.section,
      todayStart,
      monthStart,
      monthEnd,
      timeZone,
      dto.personId,
      dto.search,
    );
    const sortDate =
      dto.section === ObligationSection.HISTORY
        ? Prisma.raw('"resolvedAt"')
        : Prisma.raw('"dueDate"');
    const domainSort = Prisma.sql`CASE "domain"
      WHEN 'RECEIVABLE' THEN ${DOMAIN_RECEIVABLE}
      WHEN 'DEBT' THEN ${DOMAIN_DEBT}
    END`;
    const cursorWhere = cursor
      ? dto.section === ObligationSection.HISTORY
        ? Prisma.sql`WHERE (
            ${sortDate} < ${new Date(cursor.date)}
            OR (${sortDate} = ${new Date(cursor.date)} AND (
              ${domainSort} > ${domainRank(cursor.domain)}
              OR (${domainSort} = ${domainRank(cursor.domain)} AND "id" > ${cursor.id})
            ))
          )`
        : Prisma.sql`WHERE (
            ${sortDate} > ${new Date(cursor.date)}
            OR (${sortDate} = ${new Date(cursor.date)} AND (
              ${domainSort} > ${domainRank(cursor.domain)}
              OR (${domainSort} = ${domainRank(cursor.domain)} AND "id" > ${cursor.id})
            ))
          )`
      : Prisma.empty;
    const orderBy =
      dto.section === ObligationSection.HISTORY
        ? Prisma.sql`ORDER BY "resolvedAt" DESC`
        : Prisma.sql`ORDER BY "dueDate" ASC`;
    const rows = await this.prisma.$queryRaw<ObligationDbRow[]>(Prisma.sql`
      WITH obligations AS (
        ${receivables}
        UNION ALL
        ${debts}
      )
      SELECT * FROM obligations
      ${cursorWhere}
      ${orderBy}, ${domainSort} ASC, "id" ASC
      LIMIT ${dto.limit + 1}
    `);

    const page = buildCursorPage(rows, dto.limit, (last) => ({
      version: 1,
      section: dto.section,
      date: (dto.section === ObligationSection.HISTORY
        ? last.resolvedAt!
        : last.dueDate
      ).toISOString(),
      domain: last.domain,
      id: last.id,
    }));
    return page;
  }

  async getSummary(
    userId: string,
    timeZone: string,
    dto: GetObligationsSummaryDto,
    now = new Date(),
  ): Promise<ObligationSummary> {
    await this.validatePerson(dto.personId, userId);
    const today = financialCivilDay(now, timeZone);
    const todayStart = new Date(`${today}T00:00:00.000Z`);
    const bounds = deriveBudgetV2MonthBounds(dto.month, dto.year, timeZone);
    const monthStart = new Date(`${bounds.period.startDate}T00:00:00.000Z`);
    const monthEnd = new Date(`${bounds.period.endDate}T00:00:00.000Z`);
    const summaryRows = await this.prisma.$queryRaw<SummaryDbRow[]>(Prisma.sql`
      WITH section_rows AS (
        SELECT
          CASE WHEN r."dueDate" < ${todayStart} THEN 'OVERDUE' ELSE 'OPEN' END::text AS section,
          'RECEIVABLE'::text AS domain,
          r."amount" AS amount
        FROM "Receivable" r
        WHERE r."userId" = ${userId}
          AND (${dto.domain} = 'ALL' OR ${dto.domain} = 'RECEIVABLE')
          AND (${dto.personId ?? null}::text IS NULL OR r."personId" = ${dto.personId ?? null})
          AND r."isPaid" = FALSE
          AND (
            r."dueDate" < ${todayStart}
            OR (r."dueDate" >= ${todayStart} AND r."dueDate" >= ${monthStart} AND r."dueDate" < ${monthEnd})
          )
        UNION ALL
        SELECT
          CASE WHEN d."dueDate" < ${todayStart} THEN 'OVERDUE' ELSE 'OPEN' END::text AS section,
          'DEBT'::text AS domain,
          d."amount" AS amount
        FROM "Debt" d
        WHERE d."userId" = ${userId}
          AND (${dto.domain} = 'ALL' OR ${dto.domain} = 'DEBT')
          AND (${dto.personId ?? null}::text IS NULL OR d."personId" = ${dto.personId ?? null})
          AND d."isPaid" = FALSE
          AND (
            d."dueDate" < ${todayStart}
            OR (d."dueDate" >= ${todayStart} AND d."dueDate" >= ${monthStart} AND d."dueDate" < ${monthEnd})
          )
      )
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE section = 'OVERDUE' AND domain = 'RECEIVABLE'), 0)::text AS "overdueReceivableAmount",
        COALESCE(SUM(amount) FILTER (WHERE section = 'OVERDUE' AND domain = 'DEBT'), 0)::text AS "overdueDebtAmount",
        (COALESCE(SUM(amount) FILTER (WHERE section = 'OVERDUE' AND domain = 'RECEIVABLE'), 0)
          - COALESCE(SUM(amount) FILTER (WHERE section = 'OVERDUE' AND domain = 'DEBT'), 0))::text AS "overdueNetAmount",
        COALESCE(SUM(amount) FILTER (WHERE section = 'OPEN' AND domain = 'RECEIVABLE'), 0)::text AS "openReceivableAmount",
        COALESCE(SUM(amount) FILTER (WHERE section = 'OPEN' AND domain = 'DEBT'), 0)::text AS "openDebtAmount",
        (COALESCE(SUM(amount) FILTER (WHERE section = 'OPEN' AND domain = 'RECEIVABLE'), 0)
          - COALESCE(SUM(amount) FILTER (WHERE section = 'OPEN' AND domain = 'DEBT'), 0))::text AS "openNetAmount"
      FROM section_rows
    `);
    const row = summaryRows[0] ?? {
      overdueReceivableAmount: '0',
      overdueDebtAmount: '0',
      overdueNetAmount: '0',
      openReceivableAmount: '0',
      openDebtAmount: '0',
      openNetAmount: '0',
    };
    return {
      overdue: {
        receivable: row.overdueReceivableAmount,
        debt: row.overdueDebtAmount,
        net: row.overdueNetAmount,
      },
      open: {
        receivable: row.openReceivableAmount,
        debt: row.openDebtAmount,
        net: row.openNetAmount,
      },
    };
  }

  private validateMonth(
    section: ObligationSection,
    month?: number,
    year?: number,
  ) {
    if (
      section !== ObligationSection.OVERDUE &&
      (month === undefined || year === undefined)
    ) {
      throw new BadRequestException(
        'month and year are required for this section',
      );
    }
  }

  private async validatePerson(personId: string | undefined, userId: string) {
    if (!personId) return;
    const person = await this.prisma.person.findFirst({
      where: { id: personId, userId },
      select: { id: true },
    });
    if (!person) throw new NotFoundException('Pessoa não encontrada');
  }
}
