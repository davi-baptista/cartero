import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecurringExpenseRule } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { parseDateOnly } from 'src/common/helpers/date-only.helper';
import {
  financialCivilDay,
  financialCivilParts,
} from 'src/common/helpers/financial-timezone.helper';
import { requireAccountTimeZone } from 'src/common/helpers/timezone.helper';
import { acquireTransactionAdvisoryLock } from 'src/common/helpers/advisory-lock.helper';
import {
  isRecurringMonth,
  occurrenceDateForMonth,
  recurringIncomeOccurrenceDates,
} from 'src/recurring-income/recurring-income.helper';
import { CreateRecurringExpenseDto } from './dto/create-recurring-expense.dto';
import { UpdateRecurringExpenseDto } from './dto/update-recurring-expense.dto';
import {
  recurringExpenseLockKey,
  recurringExpenseResumeMonth,
} from './recurring-expense.helper';

const BATCH_SIZE = 100;

@Injectable()
export class RecurringExpenseService {
  private readonly logger = new Logger(RecurringExpenseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: EntityValidationService,
  ) {}

  private serialize(rule: RecurringExpenseRule) {
    return { ...rule, amount: Number(rule.amount) };
  }

  private async accountTimeZone(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });
    return requireAccountTimeZone(
      user.timeZone,
      'recurring expense account timezone',
    );
  }

  async create(userId: string, dto: CreateRecurringExpenseDto) {
    const person = dto.personId
      ? await this.validation.validatePerson(dto.personId, userId)
      : null;
    const timeZone = await this.accountTimeZone(userId);
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.recurringExpenseRule.create({
        data: {
          userId,
          title: dto.title,
          amount: dto.amount,
          frequency: 'MONTHLY',
          dayOfMonth: dto.dayOfMonth,
          firstOccurrence: dto.firstOccurrence,
          creditorName:
            dto.creditorName === null
              ? null
              : (dto.creditorName ?? person?.name),
          personId: dto.personId,
        },
      });
      // The inserted rule is invisible to other transactions until commit.
      await acquireTransactionAdvisoryLock(
        tx,
        recurringExpenseLockKey(userId, rule.id),
      );
      await this.materializeWithTx(tx, rule, new Date(), timeZone);
      return this.serialize(rule);
    });
  }

  async findAll(userId: string) {
    const rules = await this.prisma.recurringExpenseRule.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
    return rules.map((rule) => this.serialize(rule));
  }

  async findOne(id: string, userId: string) {
    const rule = await this.prisma.recurringExpenseRule.findUnique({
      where: { id, userId },
    });
    if (!rule || rule.deletedAt)
      throw new NotFoundException('Despesa recorrente não encontrada');
    return this.serialize(rule);
  }

  async update(id: string, userId: string, dto: UpdateRecurringExpenseDto) {
    const person = dto.personId
      ? await this.validation.validatePerson(dto.personId, userId)
      : null;
    const timeZone = await this.accountTimeZone(userId);
    return this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        recurringExpenseLockKey(userId, id),
      );
      const existing = await tx.recurringExpenseRule.findUnique({
        where: { id, userId },
      });
      if (!existing || existing.deletedAt)
        throw new NotFoundException('Despesa recorrente não encontrada');
      const now = new Date();
      const pausing = dto.isActive === false && existing.isActive;
      const resuming = dto.isActive === true && !existing.isActive;
      const rule = await tx.recurringExpenseRule.update({
        where: { id, userId },
        data: {
          title: dto.title,
          amount: dto.amount,
          dayOfMonth: dto.dayOfMonth,
          creditorName:
            dto.creditorName === null
              ? null
              : (dto.creditorName ?? person?.name),
          personId: dto.personId,
          isActive: dto.isActive,
          activeSince: resuming
            ? recurringExpenseResumeMonth(
                dto.dayOfMonth ?? existing.dayOfMonth,
                now,
                timeZone,
              )
            : undefined,
        },
      });
      if (pausing)
        await this.removeFutureOpenWithTx(tx, rule.id, userId, now, timeZone);
      if (rule.isActive) await this.materializeWithTx(tx, rule, now, timeZone);
      return this.serialize(rule);
    });
  }

  async remove(id: string, userId: string) {
    const timeZone = await this.accountTimeZone(userId);
    return this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        recurringExpenseLockKey(userId, id),
      );
      const existing = await tx.recurringExpenseRule.findUnique({
        where: { id, userId },
      });
      if (!existing || existing.deletedAt)
        throw new NotFoundException('Despesa recorrente não encontrada');
      await this.removeFutureOpenWithTx(tx, id, userId, new Date(), timeZone);
      const rule = await tx.recurringExpenseRule.update({
        where: { id, userId },
        data: { isActive: false, deletedAt: new Date() },
      });
      return this.serialize(rule);
    });
  }

  /** Pause and source deletion remove future obligations, never exclusions. */
  private async removeFutureOpenWithTx(
    tx: Prisma.TransactionClient,
    ruleId: string,
    userId: string,
    now: Date,
    timeZone: string,
  ) {
    await tx.debt.deleteMany({
      where: {
        userId,
        recurringExpenseRuleId: ruleId,
        isPaid: false,
        paymentTransactionId: null,
        dueDate: { gt: parseDateOnly(financialCivilDay(now, timeZone)) },
      },
    });
  }

  async reconcileForUserPeriod(userId: string, month: number, year: number) {
    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      !Number.isInteger(year) ||
      year < 1900 ||
      year > 9999
    ) {
      throw new BadRequestException('Período inválido');
    }
    const timeZone = await this.accountTimeZone(userId);
    const now = new Date();
    const current = financialCivilParts(now, timeZone);
    if ((year - current.year) * 12 + month - current.month > 12) {
      throw new BadRequestException(
        'O período solicitado está além de 12 meses futuros',
      );
    }
    const targetMonth = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    const rules = await this.prisma.recurringExpenseRule.findMany({
      where: { userId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    let created = 0;
    for (const { id } of rules)
      created += await this.materializeRule(
        id,
        userId,
        timeZone,
        now,
        targetMonth,
      );
    return { month: targetMonth, created };
  }

  /** Budget-only projection; no Debt is written by this read. */
  async projectMissingOccurrencesForMonth(
    userId: string,
    month: string,
    tx?: Prisma.TransactionClient,
  ): Promise<
    Array<{
      recurringExpenseRuleId: string;
      amount: Prisma.Decimal;
      dueDate: Date;
      title: string;
      creditorName: string | null;
    }>
  > {
    if (!isRecurringMonth(month))
      throw new BadRequestException('Competência inválida');
    const db = tx ?? this.prisma;
    const rules = await db.recurringExpenseRule.findMany({
      where: {
        userId,
        isActive: true,
        deletedAt: null,
        firstOccurrence: { lte: month },
        OR: [{ activeSince: null }, { activeSince: { lte: month } }],
      },
      select: {
        id: true,
        amount: true,
        dayOfMonth: true,
        title: true,
        creditorName: true,
      },
    });
    if (rules.length === 0) return [];
    const ids = rules.map(({ id }) => id);
    const [debts, exclusions] = await Promise.all([
      db.debt.findMany({
        where: {
          userId,
          recurringExpenseRuleId: { in: ids },
          recurringMonth: month,
        },
        select: { recurringExpenseRuleId: true },
      }),
      db.recurringExpenseOccurrenceExclusion.findMany({
        where: {
          userId,
          recurringExpenseRuleId: { in: ids },
          recurringMonth: month,
        },
        select: { recurringExpenseRuleId: true },
      }),
    ]);
    const represented = new Set(
      [...debts, ...exclusions].map(
        ({ recurringExpenseRuleId }) => recurringExpenseRuleId,
      ),
    );
    return rules
      .filter(({ id }) => !represented.has(id))
      .map((rule) => ({
        recurringExpenseRuleId: rule.id,
        amount: rule.amount,
        dueDate: parseDateOnly(occurrenceDateForMonth(month, rule.dayOfMonth)),
        title: rule.title,
        creditorName: rule.creditorName,
      }));
  }

  /** The rule lock is the same one used by pause, update, and occurrence delete. */
  private async materializeRule(
    ruleId: string,
    userId: string,
    timeZone: string,
    now: Date,
    month?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        recurringExpenseLockKey(userId, ruleId),
      );
      const rule = await tx.recurringExpenseRule.findUnique({
        where: { id: ruleId, userId },
      });
      if (!rule || !rule.isActive || rule.deletedAt) return 0;
      if (month) {
        if (
          month < rule.firstOccurrence ||
          (rule.activeSince && month < rule.activeSince)
        )
          return 0;
        return this.createOccurrencesWithTx(tx, rule, [
          { month, dueDate: occurrenceDateForMonth(month, rule.dayOfMonth) },
        ]);
      }
      return this.materializeWithTx(tx, rule, now, timeZone);
    });
  }

  private async materializeWithTx(
    tx: Prisma.TransactionClient,
    rule: RecurringExpenseRule,
    now: Date,
    timeZone: string,
  ) {
    if (!rule.isActive || rule.deletedAt) return 0;
    const dates = recurringIncomeOccurrenceDates(rule, now, timeZone).filter(
      ({ month }) => !rule.activeSince || month >= rule.activeSince,
    );
    return this.createOccurrencesWithTx(tx, rule, dates);
  }

  private async createOccurrencesWithTx(
    tx: Prisma.TransactionClient,
    rule: RecurringExpenseRule,
    occurrences: Array<{ month: string; dueDate: string }>,
  ) {
    if (occurrences.length === 0) return 0;
    const excluded = await tx.recurringExpenseOccurrenceExclusion.findMany({
      where: {
        userId: rule.userId,
        recurringExpenseRuleId: rule.id,
        recurringMonth: { in: occurrences.map(({ month }) => month) },
      },
      select: { recurringMonth: true },
    });
    const omitted = new Set(
      excluded.map(({ recurringMonth }) => recurringMonth),
    );
    const rows = occurrences
      .filter(({ month }) => !omitted.has(month))
      .map(({ month, dueDate }) => ({
        userId: rule.userId,
        personId: rule.personId,
        title: rule.title,
        creditorName: rule.creditorName ?? rule.title,
        amount: rule.amount,
        occurredAt: parseDateOnly(dueDate),
        dueDate: parseDateOnly(dueDate),
        recurringExpenseRuleId: rule.id,
        recurringMonth: month,
      }));
    if (rows.length === 0) return 0;
    const result = await tx.debt.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return result.count;
  }

  async ensureForUser(
    userId: string,
    now = new Date(),
    knownTimeZone?: string,
  ) {
    const timeZone = knownTimeZone ?? (await this.accountTimeZone(userId));
    const rules = await this.prisma.recurringExpenseRule.findMany({
      where: { userId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    let created = 0;
    for (const { id } of rules)
      created += await this.materializeRule(id, userId, timeZone, now);
    return { rulesReconciled: rules.length, occurrencesCreated: created };
  }

  async ensureAll(now = new Date()) {
    let lastUserId: string | undefined;
    const summary = {
      usersScanned: 0,
      usersFailed: 0,
      rulesReconciled: 0,
      occurrencesCreated: 0,
    };
    while (true) {
      const users = await this.prisma.user.findMany({
        where: {
          ...(lastUserId ? { id: { gt: lastUserId } } : {}),
          recurringExpenseRules: { some: { isActive: true, deletedAt: null } },
        },
        select: { id: true, timeZone: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });
      if (users.length === 0) break;
      for (const user of users) {
        lastUserId = user.id;
        summary.usersScanned += 1;
        try {
          const result = await this.ensureForUser(
            user.id,
            now,
            requireAccountTimeZone(
              user.timeZone,
              'recurring expense account timezone',
            ),
          );
          summary.rulesReconciled += result.rulesReconciled;
          summary.occurrencesCreated += result.occurrencesCreated;
        } catch (error) {
          summary.usersFailed += 1;
          this.logger.error(
            `Falha ao reconciliar despesas recorrentes do usuário ${user.id}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
      if (users.length < BATCH_SIZE) break;
    }
    return summary;
  }
}
