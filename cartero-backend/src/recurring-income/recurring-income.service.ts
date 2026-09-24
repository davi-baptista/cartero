import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecurringIncomeRule } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { parseDateOnly } from 'src/common/helpers/date-only.helper';
import { requireAccountTimeZone } from 'src/common/helpers/timezone.helper';
import { CreateRecurringIncomeDto } from './dto/create-recurring-income.dto';
import { UpdateRecurringIncomeDto } from './dto/update-recurring-income.dto';
import {
  addRecurringMonths,
  compareRecurringMonths,
  defaultFirstOccurrence,
  materializationHorizon,
  occurrenceDateForMonth,
} from './recurring-income.helper';

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class RecurringIncomeService {
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
    const firstOccurrence =
      dto.firstOccurrence ??
      defaultFirstOccurrence(new Date(), dto.dayOfMonth, timeZone);

    const rule = await this.prisma.recurringIncomeRule.create({
      data: {
        userId,
        title: dto.title,
        amount: dto.amount,
        frequency: 'MONTHLY',
        dayOfMonth: dto.dayOfMonth,
        firstOccurrence,
        counterpartyName: dto.counterpartyName,
      },
    });

    await this.materializeRule(rule, new Date(), timeZone);
    return this.serializeRule(rule);
  }

  async findAll(userId: string) {
    await this.ensureForUser(userId);
    const rules = await this.prisma.recurringIncomeRule.findMany({
      where: { userId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
    return rules.map((rule) => this.serializeRule(rule));
  }

  async findOne(id: string, userId: string) {
    await this.ensureForUser(userId);
    const rule = await this.prisma.recurringIncomeRule.findUnique({
      where: { id, userId },
    });
    if (!rule) throw new NotFoundException('Regra de renda não encontrada');
    return this.serializeRule(rule);
  }

  async update(id: string, userId: string, dto: UpdateRecurringIncomeDto) {
    const existing = await this.findOwnedRule(id, userId);
    const rule = await this.prisma.recurringIncomeRule.update({
      where: { id },
      data: {
        title: dto.title,
        amount: dto.amount,
        dayOfMonth: dto.dayOfMonth,
        counterpartyName: dto.counterpartyName,
        isActive: dto.isActive,
      },
    });

    if (rule.isActive) {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timeZone: true },
      });
      await this.materializeRule(
        rule,
        new Date(),
        requireAccountTimeZone(
          user.timeZone,
          'recurring income account timezone',
        ),
      );
    }

    // `existing` proves ownership before update; this assignment documents that
    // firstOccurrence is deliberately immutable in V1.
    void existing;
    return this.serializeRule(rule);
  }

  async deactivate(id: string, userId: string) {
    await this.findOwnedRule(id, userId);
    const rule = await this.prisma.recurringIncomeRule.update({
      where: { id },
      data: { isActive: false },
    });
    return this.serializeRule(rule);
  }

  /** Idempotent lazy/cron entry point. */
  async ensureForUser(userId: string, now = new Date()): Promise<void> {
    const [user, rules] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timeZone: true },
      }),
      this.prisma.recurringIncomeRule.findMany({
        where: { userId, isActive: true },
      }),
    ]);
    const timeZone = requireAccountTimeZone(
      user.timeZone,
      'recurring income account timezone',
    );

    for (const rule of rules) {
      await this.materializeRule(rule, now, timeZone);
    }
  }

  async ensureAll(now = new Date()) {
    const users = await this.prisma.user.findMany({
      where: { recurringIncomeRules: { some: { isActive: true } } },
      select: { id: true, timeZone: true },
    });
    for (const user of users) {
      await this.ensureForUser(user.id, now);
    }
  }

  private async materializeRule(
    rule: RecurringIncomeRule,
    now: Date,
    timeZone: string,
  ) {
    if (!rule.isActive) return;
    const horizon = materializationHorizon(now, timeZone);
    let month = rule.firstOccurrence;
    const horizonMonth = horizon.slice(0, 7);

    while (compareRecurringMonths(month, horizonMonth) <= 0) {
      const dueDate = occurrenceDateForMonth(month, rule.dayOfMonth);
      if (dueDate <= horizon) {
        try {
          await this.prisma.receivable.create({
            data: {
              userId: rule.userId,
              title: rule.title,
              debtorName: rule.counterpartyName ?? rule.title,
              amount: rule.amount,
              description: null,
              occurredAt: parseDateOnly(dueDate),
              dueDate: parseDateOnly(dueDate),
              isPaid: false,
              incomeClassification: 'INCOME',
              recurringIncomeRuleId: rule.id,
              recurringMonth: month,
            },
          });
        } catch (error) {
          if (!isUniqueConflict(error)) throw error;
        }
      }
      month = addRecurringMonths(month, 1);
    }
  }

  private async findOwnedRule(id: string, userId: string) {
    const rule = await this.prisma.recurringIncomeRule.findUnique({
      where: { id, userId },
    });
    if (!rule) throw new NotFoundException('Regra de renda não encontrada');
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
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...rule,
      amount: Number(rule.amount),
    };
  }
}
