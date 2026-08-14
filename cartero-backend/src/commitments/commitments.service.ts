import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/** Uma compra parcelada ainda em aberto. */
export interface ActiveInstallment {
  /** Id da parcela raiz — identifica a compra. */
  id: string;
  title: string;
  /** Valor de cada parcela. */
  installmentAmount: number;
  paidCount: number;
  totalCount: number;
  /** Soma das parcelas que ainda vão vencer. */
  remaining: number;
  /** Fatura da última parcela — quando a compra termina. */
  endsAt: { month: number; year: number } | null;
  bankName: string | null;
  categoryName: string | null;
}

const INSTALLMENT_SUFFIX = /\s(\d+)\/(\d+)$/;

@Injectable()
export class CommitmentsService {
  constructor(private prisma: PrismaService) {}

  async getCommitments(userId: string) {
    const [installments, subscriptions] = await Promise.all([
      this.getActiveInstallments(userId),
      this.prisma.subscription.findMany({
        where: { userId, isActive: true },
        include: { bank: true, category: true },
        orderBy: { dayOfMonth: 'asc' },
      }),
    ]);

    const monthlySubscriptions = subscriptions.reduce(
      (sum, s) => sum + Number(s.amount),
      0,
    );

    return {
      installments,
      subscriptions,
      totals: {
        installmentsRemaining: installments.reduce(
          (sum, i) => sum + i.remaining,
          0,
        ),
        monthlySubscriptions,
      },
      /** Custo fixo projetado para os próximos meses. */
      forecast: await this.getForecast(userId, monthlySubscriptions),
    };
  }

  /**
   * Compras parceladas com ao menos uma parcela ainda por vencer.
   *
   * O agrupamento usa `parentId ?? id` porque a primeira parcela é a raiz da
   * série e tem `parentId` nulo — filtrar só por `parentId` perderia a compra
   * inteira quando apenas a raiz sobrasse.
   */
  private async getActiveInstallments(
    userId: string,
  ): Promise<ActiveInstallment[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: 'CREDIT_CARD',
        isRefund: false,
        title: { contains: '/' },
        invoiceId: { not: null },
      },
      include: {
        invoice: { select: { month: true, year: true, status: true } },
        bank: { select: { name: true } },
        category: { select: { name: true } },
      },
    });

    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;

    const groups = new Map<string, ActiveInstallment & { seen: number }>();

    for (const tx of rows) {
      const match = INSTALLMENT_SUFFIX.exec(tx.title);
      if (!match || !tx.invoice) continue;

      const key = tx.parentId ?? tx.id;
      const totalCount = Number(match[2]);
      const amount = Number(tx.amount);

      // "Futura" é pela fatura, não pela data: todas as parcelas compartilham
      // a data da compra, então só a fatura distingue o que já venceu.
      const isFuture =
        tx.invoice.year > currentYear ||
        (tx.invoice.year === currentYear && tx.invoice.month > currentMonth);

      const entry = groups.get(key) ?? {
        id: key,
        title: tx.title.replace(INSTALLMENT_SUFFIX, ''),
        installmentAmount: amount,
        paidCount: 0,
        totalCount,
        remaining: 0,
        endsAt: null,
        bankName: tx.bank?.name ?? null,
        categoryName: tx.category?.name ?? null,
        seen: 0,
      };

      entry.seen += 1;
      if (isFuture) entry.remaining += amount;
      else entry.paidCount += 1;

      const isLater =
        !entry.endsAt ||
        tx.invoice.year > entry.endsAt.year ||
        (tx.invoice.year === entry.endsAt.year &&
          tx.invoice.month > entry.endsAt.month);
      if (isLater) {
        entry.endsAt = { month: tx.invoice.month, year: tx.invoice.year };
      }

      groups.set(key, entry);
    }

    return [...groups.values()]
      .filter((entry) => entry.remaining > 0)
      .map(({ seen: _seen, ...entry }) => entry)
      .sort((a, b) => b.remaining - a.remaining);
  }

  /**
   * Custo fixo dos próximos 6 meses: parcelas já contratadas mais o valor
   * recorrente das assinaturas.
   */
  private async getForecast(userId: string, monthlySubscriptions: number) {
    const now = new Date();
    const months: Array<{
      month: number;
      year: number;
      installments: number;
      subscriptions: number;
      total: number;
    }> = [];

    for (let i = 0; i < 6; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      months.push({
        month: d.getUTCMonth() + 1,
        year: d.getUTCFullYear(),
        installments: 0,
        subscriptions: monthlySubscriptions,
        total: monthlySubscriptions,
      });
    }

    const first = months[0];
    const last = months[months.length - 1];

    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: 'CREDIT_CARD',
        isRefund: false,
        title: { contains: '/' },
        // Janela do primeiro ao último mês da projeção.
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
        title: true,
        invoice: { select: { month: true, year: true } },
      },
    });

    for (const tx of rows) {
      if (!INSTALLMENT_SUFFIX.test(tx.title) || !tx.invoice) continue;
      const slot = months.find(
        (m) => m.month === tx.invoice!.month && m.year === tx.invoice!.year,
      );
      if (!slot) continue;
      slot.installments += Number(tx.amount);
      slot.total += Number(tx.amount);
    }

    return months;
  }
}
