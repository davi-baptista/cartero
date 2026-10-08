import {
  ConflictException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecurringIncomeRule } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { parseDateOnly } from 'src/common/helpers/date-only.helper';
import {
  financialCivilDay,
  financialCivilParts,
} from 'src/common/helpers/financial-timezone.helper';
import { requireAccountTimeZone } from 'src/common/helpers/timezone.helper';
import { acquireTransactionAdvisoryLock } from 'src/common/helpers/advisory-lock.helper';
import { assertNotActivePersonSettlementMember } from 'src/common/helpers/person-settlement.guard';
import { removeSettlementTransaction } from 'src/common/helpers/settlement.core';
import { CreateRecurringIncomeDto } from './dto/create-recurring-income.dto';
import { UpdateRecurringIncomeDto } from './dto/update-recurring-income.dto';
import { PreviewRecurringIncomeDto } from './dto/preview-recurring-income.dto';
import {
  previewRecurringIncome,
  isRecurringMonth,
  occurrenceDateForMonth,
  incomeOccurrenceDates,
  resumeRecurringMonth,
} from './recurring-income.helper';

export const RECURRING_INCOME_USER_BATCH_SIZE = 100;

export type RecurringIncomeReconciliationSummary = {
  usersScanned: number;
  usersSucceeded: number;
  usersFailed: number;
  rulesReconciled: number;
  occurrencesAttempted: number;
  occurrencesCreated: number;
  occurrencesSkipped: number;
  batchesProcessed: number;
};

type UserReconciliationResult = Pick<
  RecurringIncomeReconciliationSummary,
  | 'rulesReconciled'
  | 'occurrencesAttempted'
  | 'occurrencesCreated'
  | 'occurrencesSkipped'
>;

function safeErrorSummary(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `Prisma:${error.code}`;
  }
  return error instanceof Error ? error.name : 'UnknownError';
}

@Injectable()
export class RecurringIncomeService {
  private readonly logger = new Logger(RecurringIncomeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateRecurringIncomeDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });
    const timeZone = requireAccountTimeZone(
      user.timeZone,
      'recurring income account timezone',
    );
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.recurringIncomeRule.create({
        data: {
          userId,
          title: dto.title,
          amount: dto.amount,
          frequency: 'MONTHLY',
          dayOfMonth: dto.dayOfMonth,
          firstOccurrence: dto.firstOccurrence,
          counterpartyName: dto.counterpartyName,
        },
      });
      // A new rule has no lockable ID until INSERT. It is invisible to other
      // transactions before commit, so acquire the canonical lock immediately
      // after INSERT and keep creation plus initial occurrences in this tx.
      await acquireTransactionAdvisoryLock(
        tx,
        this.occurrenceLockKey(userId, rule.id),
      );
      const created = await this.materializeRuleWithTx(
        tx,
        rule,
        new Date(),
        timeZone,
      );
      return this.serializeRule(created.rule);
    });
  }

  async findAll(userId: string) {
    const rules = await this.prisma.recurringIncomeRule.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
    return rules.map((rule) => this.serializeRule(rule));
  }

  async preview(userId: string, dto: PreviewRecurringIncomeDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });
    return previewRecurringIncome(
      dto,
      new Date(),
      requireAccountTimeZone(
        user.timeZone,
        'recurring income account timezone',
      ),
    );
  }

  async findOne(id: string, userId: string) {
    const rule = await this.prisma.recurringIncomeRule.findUnique({
      where: { id, userId },
    });
    if (!rule || rule.deletedAt) {
      throw new NotFoundException('Regra de renda não encontrada');
    }
    return this.serializeRule(rule);
  }

  /** Reconcile one civil month on an explicit, authenticated command. */
  async reconcileForUserPeriod(
    userId: string,
    month: number,
    year: number,
    now = new Date(),
  ): Promise<{ month: string; created: number }> {
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

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });
    const timeZone = requireAccountTimeZone(
      user.timeZone,
      'recurring income account timezone',
    );
    const targetMonth = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    const current = financialCivilParts(now, timeZone);
    const monthsAhead = (year - current.year) * 12 + (month - current.month);
    if (monthsAhead > 12) {
      throw new BadRequestException(
        'O período solicitado está além do limite de 12 meses futuros',
      );
    }

    const rules = await this.prisma.recurringIncomeRule.findMany({
      where: { userId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    let created = 0;
    for (const { id } of rules) {
      created += await this.materializeRuleForMonth(
        id,
        userId,
        targetMonth,
        now,
        timeZone,
      );
    }
    return { month: targetMonth, created };
  }

  /** Read-only Budget projection for an unmaterialized month snapshot. */
  async projectMissingOccurrencesForMonth(
    userId: string,
    month: string,
    tx?: Prisma.TransactionClient,
  ): Promise<
    Array<{
      recurringIncomeRuleId: string;
      amount: Prisma.Decimal;
      dueDate: Date;
      title: string;
      counterpartyName: string | null;
    }>
  > {
    if (!isRecurringMonth(month)) {
      throw new BadRequestException('Competência inválida');
    }
    const db = tx ?? this.prisma;
    const rules = await db.recurringIncomeRule.findMany({
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
        counterpartyName: true,
      },
    });
    if (rules.length === 0) return [];

    const ruleIds = rules.map(({ id }) => id);
    const [existing, exclusions] = await Promise.all([
      db.receivable.findMany({
        where: {
          userId,
          recurringIncomeRuleId: { in: ruleIds },
          recurringMonth: month,
        },
        select: { recurringIncomeRuleId: true },
      }),
      db.recurringIncomeOccurrenceExclusion.findMany({
        where: {
          userId,
          recurringIncomeRuleId: { in: ruleIds },
          recurringMonth: month,
        },
        select: { recurringIncomeRuleId: true },
      }),
    ]);
    const represented = new Set([
      ...existing.map(({ recurringIncomeRuleId }) => recurringIncomeRuleId),
      ...exclusions.map(({ recurringIncomeRuleId }) => recurringIncomeRuleId),
    ]);
    return rules
      .filter(({ id }) => !represented.has(id))
      .map(({ id, amount, dayOfMonth, title, counterpartyName }) => ({
        recurringIncomeRuleId: id,
        amount,
        dueDate: parseDateOnly(occurrenceDateForMonth(month, dayOfMonth)),
        title,
        counterpartyName,
      }));
  }

  async update(id: string, userId: string, dto: UpdateRecurringIncomeDto) {
    return this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        this.occurrenceLockKey(userId, id),
      );
      const existing = await tx.recurringIncomeRule.findUnique({
        where: { id, userId },
      });
      if (!existing || existing.deletedAt) {
        throw new NotFoundException('Regra de renda não encontrada');
      }
      const now = new Date();
      const pausing = dto.isActive === false && existing.isActive;
      const resuming = dto.isActive === true && !existing.isActive;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timeZone: true },
      });
      const timeZone = requireAccountTimeZone(
        user.timeZone,
        'recurring income account timezone',
      );
      const rule = await tx.recurringIncomeRule.update({
        where: { id, userId },
        data: {
          title: dto.title,
          amount: dto.amount,
          dayOfMonth: dto.dayOfMonth,
          counterpartyName: dto.counterpartyName,
          isActive: dto.isActive,
          activeSince: resuming
            ? resumeRecurringMonth(
                dto.dayOfMonth ?? existing.dayOfMonth,
                now,
                timeZone,
              )
            : undefined,
        },
      });

      if (pausing) {
        await tx.receivable.deleteMany({
          where: {
            userId,
            recurringIncomeRuleId: id,
            isPaid: false,
            paymentTransactionId: null,
            dueDate: { gt: parseDateOnly(financialCivilDay(now, timeZone)) },
          },
        });
      }

      if (rule.isActive) {
        await this.materializeRuleWithTx(tx, rule, now, timeZone);
      }

      // firstOccurrence remains immutable in V1. Existing Receivables are
      // snapshots; materialization only inserts missing unique occurrences.
      return this.serializeRule(rule);
    });
  }

  async deactivate(id: string, userId: string) {
    return this.update(id, userId, { isActive: false });
  }

  async remove(id: string, userId: string) {
    // Preserve the early ownership rejection; the authoritative row is still
    // re-read below after acquiring the rule lock.
    await this.findOwnedRule(id, userId);
    return this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        this.occurrenceLockKey(userId, id),
      );
      const existing = await tx.recurringIncomeRule.findUnique({
        where: { id, userId },
      });
      if (!existing || existing.deletedAt) {
        throw new NotFoundException('Regra de renda não encontrada');
      }

      await tx.receivable.deleteMany({
        where: {
          userId,
          recurringIncomeRuleId: id,
          isPaid: false,
          paymentTransactionId: null,
        },
      });

      const rule = await tx.recurringIncomeRule.update({
        where: { id, userId },
        data: { isActive: false, deletedAt: new Date() },
      });

      return this.serializeRule(rule);
    });
  }

  /** Persist user intent for a competence; materialization skips this month. */
  async suppressOccurrence(
    userId: string,
    recurringIncomeRuleId: string,
    recurringMonth: string,
  ): Promise<void> {
    const rule = await this.findOwnedRule(recurringIncomeRuleId, userId);
    this.validateOccurrenceMonth(recurringMonth, rule.firstOccurrence);

    await this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        this.occurrenceLockKey(userId, recurringIncomeRuleId),
      );
      await tx.recurringIncomeOccurrenceExclusion.createMany({
        data: [{ userId, recurringIncomeRuleId, recurringMonth }],
        skipDuplicates: true,
      });
    });
  }

  /** Remove only the exclusion marker; does not materialize a Receivable. */
  async restoreOccurrence(
    userId: string,
    recurringIncomeRuleId: string,
    recurringMonth: string,
  ): Promise<void> {
    const rule = await this.findOwnedRule(recurringIncomeRuleId, userId);
    this.validateOccurrenceMonth(recurringMonth, rule.firstOccurrence);

    await this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        this.occurrenceLockKey(userId, recurringIncomeRuleId),
      );
      await tx.recurringIncomeOccurrenceExclusion.deleteMany({
        where: { userId, recurringIncomeRuleId, recurringMonth },
      });
    });
  }

  /** Atomically remember a pending occurrence deletion and remove only its row. */
  async deletePendingOccurrence(
    userId: string,
    receivableId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const initial = await tx.receivable.findUnique({
        where: { id: receivableId, userId },
      });
      if (!initial) throw new NotFoundException('Recebimento não encontrado');
      if (!initial.recurringIncomeRuleId || !initial.recurringMonth) {
        throw new BadRequestException(
          'Este recebimento não é uma ocorrência recorrente válida',
        );
      }

      await acquireTransactionAdvisoryLock(
        tx,
        this.occurrenceLockKey(userId, initial.recurringIncomeRuleId),
      );

      // Re-read after waiting for the materializer/suppression lock.
      const occurrence = await tx.receivable.findUnique({
        where: { id: receivableId, userId },
      });
      const recurringMonth = occurrence?.recurringMonth;
      if (!occurrence)
        throw new NotFoundException('Recebimento não encontrado');
      if (
        occurrence.recurringIncomeRuleId !== initial.recurringIncomeRuleId ||
        !recurringMonth
      ) {
        throw new BadRequestException(
          'Este recebimento não é uma ocorrência recorrente válida',
        );
      }
      if (occurrence.isPaid) {
        throw new ConflictException({
          message: 'Desmarque o recebimento antes de excluí-lo.',
          code: 'RECURRING_INCOME_RECEIVABLE_DELETE_BLOCKED',
        });
      }
      if (occurrence.transactionId || occurrence.paymentTransactionId) {
        throw new ConflictException({
          message:
            'Este recebimento está vinculado a uma movimentação protegida.',
          code: 'RECURRING_INCOME_RECEIVABLE_DELETE_BLOCKED',
        });
      }

      const rule = await tx.recurringIncomeRule.findUnique({
        where: { id: occurrence.recurringIncomeRuleId, userId },
      });
      if (!rule) throw new NotFoundException('Regra de renda não encontrada');
      this.validateOccurrenceMonth(recurringMonth, rule.firstOccurrence);
      await assertNotActivePersonSettlementMember(
        tx,
        'receivable',
        occurrence.id,
        userId,
      );

      await this.suppressAndDeleteOccurrence(
        tx,
        { id: occurrence.id, recurringMonth },
        rule.id,
        userId,
      );
    });
  }

  /** Undo settlement, suppress the competence, and remove a received occurrence atomically. */
  async undoAndDeleteReceivedOccurrence(
    userId: string,
    receivableId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const initial = await tx.receivable.findUnique({
        where: { id: receivableId, userId },
      });
      if (!initial) throw new NotFoundException('Recebimento não encontrado');
      if (!initial.recurringIncomeRuleId || !initial.recurringMonth) {
        throw new BadRequestException(
          'Este recebimento não é uma ocorrência recorrente válida',
        );
      }

      await acquireTransactionAdvisoryLock(
        tx,
        this.occurrenceLockKey(userId, initial.recurringIncomeRuleId),
      );

      const occurrence = await tx.receivable.findUnique({
        where: { id: receivableId, userId },
      });
      const recurringMonth = occurrence?.recurringMonth;
      if (
        !occurrence ||
        occurrence.recurringIncomeRuleId !== initial.recurringIncomeRuleId ||
        !recurringMonth
      ) {
        throw new NotFoundException('Recebimento recorrente não encontrado');
      }
      if (!occurrence.isPaid) {
        throw new ConflictException({
          message: 'Este recebimento já está pendente.',
          code: 'RECURRING_INCOME_RECEIVABLE_NOT_RECEIVED',
        });
      }
      if (occurrence.transactionId) {
        throw new ConflictException({
          message: 'Este recebimento está vinculado a uma compra protegida.',
          code: 'RECURRING_INCOME_RECEIVABLE_DELETE_BLOCKED',
        });
      }

      const rule = await tx.recurringIncomeRule.findUnique({
        where: { id: occurrence.recurringIncomeRuleId, userId },
      });
      if (!rule) throw new NotFoundException('Regra de renda não encontrada');
      this.validateOccurrenceMonth(recurringMonth, rule.firstOccurrence);
      await assertNotActivePersonSettlementMember(
        tx,
        'receivable',
        occurrence.id,
        userId,
      );

      const paymentTransactionId = occurrence.paymentTransactionId;
      if (paymentTransactionId) {
        // Clear the FK first, following the existing receivable unmark authority.
        await tx.receivable.update({
          where: { id: occurrence.id, userId },
          data: { paymentTransactionId: null, isPaid: false, paidAt: null },
        });
        await removeSettlementTransaction(tx, userId, paymentTransactionId);
      }

      await this.suppressAndDeleteOccurrence(
        tx,
        { id: occurrence.id, recurringMonth },
        rule.id,
        userId,
      );
    });
  }

  private async suppressAndDeleteOccurrence(
    tx: Prisma.TransactionClient,
    occurrence: { id: string; recurringMonth: string },
    ruleId: string,
    userId: string,
  ): Promise<void> {
    await tx.recurringIncomeOccurrenceExclusion.createMany({
      data: [
        {
          userId,
          recurringIncomeRuleId: ruleId,
          recurringMonth: occurrence.recurringMonth,
        },
      ],
      skipDuplicates: true,
    });
    await tx.receivable.delete({ where: { id: occurrence.id, userId } });
  }

  private occurrenceLockKey(userId: string, recurringIncomeRuleId: string) {
    return `recurring-income-occurrences:${userId}:${recurringIncomeRuleId}`;
  }

  private validateOccurrenceMonth(
    recurringMonth: string,
    firstOccurrence: string,
  ) {
    if (!isRecurringMonth(recurringMonth) || recurringMonth < firstOccurrence) {
      throw new BadRequestException(
        'Competência inválida para esta regra de renda recorrente',
      );
    }
  }

  /** Idempotent reconciliation for one account. */
  async ensureForUser(
    userId: string,
    now = new Date(),
    knownTimeZone?: string,
    onRuleReconciled?: (result: UserReconciliationResult) => void,
  ): Promise<UserReconciliationResult> {
    const [user, rules] = await Promise.all([
      knownTimeZone === undefined
        ? this.prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { timeZone: true },
          })
        : Promise.resolve({ timeZone: knownTimeZone }),
      this.prisma.recurringIncomeRule.findMany({
        where: { userId, isActive: true, deletedAt: null },
        select: { id: true },
      }),
    ]);
    const timeZone = requireAccountTimeZone(
      user.timeZone,
      'recurring income account timezone',
    );

    const result: UserReconciliationResult = {
      rulesReconciled: 0,
      occurrencesAttempted: 0,
      occurrencesCreated: 0,
      occurrencesSkipped: 0,
    };
    for (const { id } of rules) {
      const materialized = await this.materializeRule(
        id,
        userId,
        now,
        timeZone,
      );
      result.rulesReconciled += 1;
      result.occurrencesAttempted += materialized.attempted;
      result.occurrencesCreated += materialized.created;
      result.occurrencesSkipped +=
        materialized.attempted - materialized.created;
      onRuleReconciled?.({
        rulesReconciled: 1,
        occurrencesAttempted: materialized.attempted,
        occurrencesCreated: materialized.created,
        occurrencesSkipped: materialized.attempted - materialized.created,
      });
    }
    return result;
  }

  /** Keyset scan; a failed account does not stop later accounts. */
  async ensureAll(
    now = new Date(),
    batchSize = RECURRING_INCOME_USER_BATCH_SIZE,
    assertLockHeld?: () => Promise<void>,
    reportProgress?: (summary: RecurringIncomeReconciliationSummary) => void,
  ): Promise<RecurringIncomeReconciliationSummary> {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new Error('Recurring income batch size must be positive');
    }
    const summary: RecurringIncomeReconciliationSummary = {
      usersScanned: 0,
      usersSucceeded: 0,
      usersFailed: 0,
      rulesReconciled: 0,
      occurrencesAttempted: 0,
      occurrencesCreated: 0,
      occurrencesSkipped: 0,
      batchesProcessed: 0,
    };
    reportProgress?.({ ...summary });
    let lastUserId: string | undefined;

    while (true) {
      await assertLockHeld?.();
      const users = await this.prisma.user.findMany({
        where: {
          ...(lastUserId ? { id: { gt: lastUserId } } : {}),
          recurringIncomeRules: {
            some: { isActive: true, deletedAt: null },
          },
        },
        select: { id: true, timeZone: true },
        orderBy: { id: 'asc' },
        take: batchSize,
      });
      if (users.length === 0) break;
      summary.batchesProcessed += 1;

      for (const user of users) {
        lastUserId = user.id;
        summary.usersScanned += 1;
        const startedAt = Date.now();
        try {
          await this.ensureForUser(user.id, now, user.timeZone, (result) => {
            summary.rulesReconciled += result.rulesReconciled;
            summary.occurrencesAttempted += result.occurrencesAttempted;
            summary.occurrencesCreated += result.occurrencesCreated;
            summary.occurrencesSkipped += result.occurrencesSkipped;
          });
          summary.usersSucceeded += 1;
        } catch (error) {
          summary.usersFailed += 1;
          this.logger.error(
            JSON.stringify({
              event: 'recurring-income-user-failed',
              userId: user.id,
              durationMs: Date.now() - startedAt,
              error: safeErrorSummary(error),
            }),
          );
        }
      }
      reportProgress?.({ ...summary });
      if (users.length < batchSize) break;
    }
    return summary;
  }

  private async materializeRule(
    ruleId: string,
    userId: string,
    now: Date,
    timeZone: string,
  ): Promise<{ attempted: number; created: number }> {
    return this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        this.occurrenceLockKey(userId, ruleId),
      );
      const rule = await tx.recurringIncomeRule.findUnique({
        where: { id: ruleId, userId },
      });
      if (!rule || !rule.isActive || rule.deletedAt) {
        return { attempted: 0, created: 0 };
      }
      return this.materializeRuleWithTx(tx, rule, now, timeZone);
    });
  }

  private async materializeRuleForMonth(
    ruleId: string,
    userId: string,
    month: string,
    now: Date,
    timeZone: string,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        this.occurrenceLockKey(userId, ruleId),
      );
      const rule = await tx.recurringIncomeRule.findUnique({
        where: { id: ruleId, userId },
      });
      if (
        !rule ||
        !rule.isActive ||
        rule.deletedAt ||
        month < rule.firstOccurrence ||
        (rule.activeSince && month < rule.activeSince)
      ) {
        return 0;
      }
      const occurrence = incomeOccurrenceDates(rule, now, timeZone).find(
        (candidate) => candidate.month === month,
      );
      return occurrence
        ? this.materializeOccurrencesWithTx(tx, rule, [occurrence])
        : 0;
    });
  }

  private async materializeRuleWithTx(
    tx: Prisma.TransactionClient,
    rule: RecurringIncomeRule,
    now: Date,
    timeZone: string,
  ): Promise<{
    rule: RecurringIncomeRule;
    attempted: number;
    created: number;
  }> {
    if (!rule.isActive || rule.deletedAt) {
      return { rule, attempted: 0, created: 0 };
    }
    const occurrences = incomeOccurrenceDates(
      {
        firstOccurrence: rule.firstOccurrence,
        dayOfMonth: rule.dayOfMonth,
      },
      now,
      timeZone,
    ).filter(({ month }) => !rule.activeSince || month >= rule.activeSince);
    if (occurrences.length === 0) return { rule, attempted: 0, created: 0 };

    return {
      rule,
      attempted: occurrences.length,
      created: await this.materializeOccurrencesWithTx(tx, rule, occurrences),
    };
  }

  private async materializeOccurrencesWithTx(
    tx: Prisma.TransactionClient,
    rule: RecurringIncomeRule,
    occurrences: Array<{ month: string; dueDate: string }>,
  ): Promise<number> {
    // Callers own the canonical per-rule lock before loading the rule state.
    const exclusions = await tx.recurringIncomeOccurrenceExclusion.findMany({
      where: {
        userId: rule.userId,
        recurringIncomeRuleId: rule.id,
        recurringMonth: { in: occurrences.map(({ month }) => month) },
      },
      select: { recurringMonth: true },
    });
    const excludedMonths = new Set(
      exclusions.map(({ recurringMonth }) => recurringMonth),
    );
    const rows = occurrences
      .filter(({ month }) => !excludedMonths.has(month))
      .map(({ month, dueDate }) => ({
        userId: rule.userId,
        title: rule.title,
        debtorName: rule.counterpartyName ?? rule.title,
        amount: rule.amount,
        description: null,
        occurredAt: parseDateOnly(dueDate),
        dueDate: parseDateOnly(dueDate),
        isPaid: false,
        incomeClassification: 'INCOME' as const,
        recurringIncomeRuleId: rule.id,
        recurringMonth: month,
      }));

    if (rows.length === 0) return 0;
    const result = await tx.receivable.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return result.count;
  }

  private async findOwnedRule(id: string, userId: string) {
    const rule = await this.prisma.recurringIncomeRule.findUnique({
      where: { id, userId },
    });
    if (!rule || rule.deletedAt) {
      throw new NotFoundException('Regra de renda não encontrada');
    }
    return rule;
  }

  private serializeRule(rule: {
    id: string;
    userId: string;
    title: string;
    amount: Prisma.Decimal;
    frequency: string;
    dayOfMonth: number;
    firstOccurrence: string;
    counterpartyName: string | null;
    isActive: boolean;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...rule,
      amount: Number(rule.amount),
    };
  }
}
