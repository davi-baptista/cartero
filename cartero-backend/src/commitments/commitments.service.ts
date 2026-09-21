import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { currentCycle } from 'src/common/helpers/subscription.helper';
import { getInstallmentMetadata } from 'src/common/helpers/installment.helper';

export interface InstallmentCompetence {
  month: number;
  year: number;
  amount: number;
  index: number;
}

/** A series with at least one existing future installment row. */
export interface ActiveInstallment {
  id: string;
  title: string;
  totalCount: number;
  futureCount: number;
  remaining: number;
  endsAt: { month: number; year: number } | null;
  nextInstallment: InstallmentCompetence | null;
  bankName: string | null;
  categoryName: string | null;
  personId: string | null;
  personName: string | null;
}

export interface ForecastMonth {
  month: number;
  year: number;
  installments: number;
}

function titleWithoutGeneratedSuffix(
  title: string,
  index: number,
  count: number,
) {
  const suffix = ` ${index}/${count}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

@Injectable()
export class CommitmentsService {
  constructor(private prisma: PrismaService) {}

  async getCommitments(userId: string, timeZone: string | null = null) {
    const installments = await this.getActiveInstallments(userId, timeZone);
    const own = installments.filter((item) => !item.personId);
    const others = installments.filter((item) => item.personId);

    return {
      installments: own,
      othersInstallments: others,
      totals: {
        installmentsRemaining: own.reduce(
          (sum, item) => sum + item.remaining,
          0,
        ),
        othersRemaining: others.reduce((sum, item) => sum + item.remaining, 0),
      },
      forecast: await this.getForecast(userId, 6, timeZone),
    };
  }

  private async getActiveInstallments(userId: string, timeZone: string | null) {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: 'CREDIT_CARD',
        isRefund: false,
        invoiceId: { not: null },
        installmentIndex: { not: null },
        installmentCount: { not: null },
      },
      include: {
        invoice: { select: { month: true, year: true } },
        bank: { select: { name: true } },
        category: { select: { name: true } },
        person: { select: { id: true, name: true } },
      },
    });

    const { year: currentYear, month: currentMonth } = currentCycle(
      new Date(),
      timeZone,
    );
    const groups = new Map<string, ActiveInstallment & { nextKey: number }>();

    for (const tx of rows) {
      const metadata = getInstallmentMetadata(tx);
      if (!metadata || !tx.invoice) continue;
      const year = tx.invoice.year;
      const month = tx.invoice.month;
      const isFuture =
        year > currentYear || (year === currentYear && month > currentMonth);
      const key = tx.parentId ?? tx.id;
      const amount = Number(tx.amount);
      const competenceKey = year * 100 + month;
      const entry = groups.get(key) ?? {
        id: key,
        title: titleWithoutGeneratedSuffix(
          tx.title,
          metadata.index,
          metadata.count,
        ),
        totalCount: metadata.count,
        futureCount: 0,
        remaining: 0,
        endsAt: null,
        nextInstallment: null,
        bankName: tx.bank?.name ?? null,
        categoryName: tx.category?.name ?? null,
        personId: tx.person?.id ?? null,
        personName: tx.person?.name ?? null,
        nextKey: Number.MAX_SAFE_INTEGER,
      };

      if (isFuture) {
        entry.futureCount += 1;
        entry.remaining += amount;
        if (competenceKey < entry.nextKey) {
          entry.nextKey = competenceKey;
          entry.nextInstallment = {
            month,
            year,
            amount,
            index: metadata.index,
          };
        }
      }
      if (metadata.index === metadata.count) entry.endsAt = { month, year };
      groups.set(key, entry);
    }

    return [...groups.values()]
      .filter((entry) => entry.futureCount > 0)
      .sort((a, b) => a.nextKey - b.nextKey || a.id.localeCompare(b.id))
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        totalCount: entry.totalCount,
        futureCount: entry.futureCount,
        remaining: entry.remaining,
        endsAt: entry.endsAt,
        nextInstallment: entry.nextInstallment,
        bankName: entry.bankName,
        categoryName: entry.categoryName,
        personId: entry.personId,
        personName: entry.personName,
      }));
  }

  private async getForecast(
    userId: string,
    horizonMonths: number,
    timeZone: string | null,
  ) {
    const first = currentCycle(new Date(), timeZone);
    const months: ForecastMonth[] = [];
    for (let i = 0; i < horizonMonths; i += 1) {
      const date = new Date(Date.UTC(first.year, first.month - 1 + i, 1));
      months.push({
        month: date.getUTCMonth() + 1,
        year: date.getUTCFullYear(),
        installments: 0,
      });
    }
    const last = months[months.length - 1];
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: 'CREDIT_CARD',
        isRefund: false,
        personId: null,
        installmentIndex: { not: null },
        installmentCount: { not: null },
        invoice: {
          AND: [
            {
              OR: [
                { year: { gt: first.year } },
                { year: first.year, month: { gte: first.month } },
              ],
            },
            {
              OR: [
                { year: { lt: last.year } },
                { year: last.year, month: { lte: last.month } },
              ],
            },
          ],
        },
      },
      select: {
        amount: true,
        personId: true,
        installmentIndex: true,
        installmentCount: true,
        invoice: { select: { month: true, year: true } },
      },
    });
    for (const tx of rows) {
      if (tx.personId || !getInstallmentMetadata(tx) || !tx.invoice) continue;
      const month = months.find(
        (item) =>
          item.month === tx.invoice!.month && item.year === tx.invoice!.year,
      );
      if (month) month.installments += Number(tx.amount);
    }
    return months;
  }
}
