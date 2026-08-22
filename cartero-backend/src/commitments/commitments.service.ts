import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  buildInvoiceKey,
  forecastInvoiceLookups,
  forecastSubscriptionOccurrences,
  type ForecastableSubscription,
  type ForecastOccurrence,
  type KnownInvoice,
} from './subscription-forecast.helper';

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
  /** Preenchido quando a compra foi feita em nome de outra pessoa. */
  personName: string | null;
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

    /**
     * Custo recorrente mensal.
     *
     * Continua sendo a soma das ativas — é a leitura de "quanto por mês", não
     * uma projeção. A projeção real, mês a mês, está em `forecast`.
     */
    const monthlySubscriptions = subscriptions.reduce(
      (sum, s) => sum + Number(s.amount),
      0,
    );

    // Uma compra em nome de outra pessoa passa pelo cartão mas não é custo
    // seu — o valor volta como recebível. Separar evita que a projeção
    // apresente como compromisso algo que você não vai desembolsar.
    const own = installments.filter((item) => !item.personName);
    const others = installments.filter((item) => item.personName);

    const { months, nextOccurrences } = await this.getForecast(userId);

    return {
      installments: own,
      othersInstallments: others,
      subscriptions,
      /**
       * Próxima cobrança de cada assinatura, com a data REAL da ocorrência.
       *
       * A tela mostrava só a regra ("todo dia 12"), então uma assinatura no dia
       * 31 exibia um dia que fevereiro não tem. Vem do backend porque a regra
       * é a mesma da geração — replicá-la no cliente criaria divergência.
       */
      subscriptionOccurrences: nextOccurrences.map((occurrence) => ({
        subscriptionId: occurrence.subscriptionId,
        amount: occurrence.amount,
        chargeDate: occurrence.chargeDate,
        financialPeriod: occurrence.financialPeriod,
        invoiceStatus: occurrence.invoiceStatus,
        blocked: occurrence.blocked,
      })),
      totals: {
        installmentsRemaining: own.reduce((sum, i) => sum + i.remaining, 0),
        othersRemaining: others.reduce((sum, i) => sum + i.remaining, 0),
        monthlySubscriptions,
      },
      /** Custo fixo projetado para os próximos meses. */
      forecast: months,
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
        person: { select: { name: true } },
      },
    });

    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;

    const groups = new Map<string, ActiveInstallment>();

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
        personName: tx.person?.name ?? null,
      };

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
      .sort((a, b) => b.remaining - a.remaining);
  }

  /**
   * Custo fixo dos próximos meses — parcelas já contratadas e assinaturas.
   *
   * ─── O que mudou ─────────────────────────────────────────────────────────
   *
   * A versão anterior aplicava a soma das assinaturas ativas IGUAL nos seis
   * meses, ignorando `dayOfMonth`, `startedAt`, `activeSince`,
   * `lastGeneratedFor` e a competência da fatura. O número não correspondia a
   * nada que o sistema fosse gerar: uma assinatura criada ontem já aparecia
   * cobrando em todos os meses, uma pausada continuava somando, e uma cobrança
   * de cartão feita depois do fechamento inflava o mês errado.
   *
   * Agora a projeção vem de `forecastSubscriptionOccurrences`, que usa as
   * mesmas regras da geração real — a primeira ocorrência coincide com o
   * `nextCharge` que a tela de assinaturas mostra.
   *
   * ─── Consultas ───────────────────────────────────────────────────────────
   *
   * Três, independente de quantas assinaturas existam: bancos, faturas do
   * período (uma consulta agregada por todas as competências alcançadas) e
   * parcelas da janela. Sem N+1.
   */
  private async getForecast(userId: string, horizonMonths = 6) {
    const now = new Date();

    const months: Array<{
      month: number;
      year: number;
      installments: number;
      subscriptions: number;
      total: number;
      /** Ocorrências suprimidas — não somam, mas explicam a ausência. */
      blocked: number;
    }> = [];

    for (let i = 0; i < horizonMonths; i++) {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1),
      );
      months.push({
        month: d.getUTCMonth() + 1,
        year: d.getUTCFullYear(),
        installments: 0,
        subscriptions: 0,
        total: 0,
        blocked: 0,
      });
    }

    const first = months[0];
    const last = months[months.length - 1];

    const [banks, activeSubscriptions] = await Promise.all([
      this.prisma.bank.findMany({
        where: { userId },
        select: {
          id: true,
          isArchived: true,
          invoiceDueDate: true,
          invoiceDueDaysAfterClose: true,
        },
      }),
      this.prisma.subscription.findMany({
        where: { userId, isActive: true },
        orderBy: { dayOfMonth: 'asc' },
      }),
    ]);

    const schedules = new Map(
      banks.map((bank) => [
        bank.id,
        {
          invoiceDueDate: bank.invoiceDueDate,
          invoiceDueDaysAfterClose: bank.invoiceDueDaysAfterClose,
        },
      ]),
    );
    const archivedBankIds = new Set(
      banks.filter((bank) => bank.isArchived).map((bank) => bank.id),
    );

    const forecastable: ForecastableSubscription[] = activeSubscriptions.map(
      (subscription) => ({
        id: subscription.id,
        title: subscription.title,
        amount: Number(subscription.amount),
        type: subscription.type,
        dayOfMonth: subscription.dayOfMonth,
        startedAt: subscription.startedAt,
        activeSince: subscription.activeSince,
        lastGeneratedFor: subscription.lastGeneratedFor,
        isActive: subscription.isActive,
        bankId: subscription.bankId,
      }),
    );

    /**
     * Faturas existentes das competências que a projeção vai tocar.
     *
     * As competências são calculadas ANTES da consulta, para buscar todas de
     * uma vez. Sem isso seria uma query por ocorrência — e uma assinatura de
     * cartão gera seis por horizonte.
     */
    const lookups = forecastInvoiceLookups(
      forecastable,
      schedules,
      horizonMonths,
      now,
    );

    const knownInvoices = new Map<string, KnownInvoice>();
    if (lookups.length > 0) {
      const rows = await this.prisma.invoice.findMany({
        where: {
          userId,
          OR: lookups.map(({ bankId, year, month }) => ({
            bankId,
            year,
            month,
          })),
        },
        select: {
          bankId: true,
          year: true,
          month: true,
          status: true,
          dueDate: true,
        },
      });

      for (const row of rows) {
        knownInvoices.set(
          buildInvoiceKey(row.bankId, row.year, row.month),
          row,
        );
      }
    }

    const occurrences = forecastSubscriptionOccurrences({
      subscriptions: forecastable,
      schedules,
      invoices: knownInvoices,
      archivedBankIds,
      horizonMonths,
      today: now,
    });

    for (const occurrence of occurrences) {
      const slot = months.find(
        (m) =>
          m.month === occurrence.financialPeriod.month &&
          m.year === occurrence.financialPeriod.year,
      );
      if (!slot) continue;

      // Bloqueada não soma: a geração real não vai criar esse lançamento, e
      // contabilizá-lo prometeria um gasto que não acontece.
      if (occurrence.blocked) {
        slot.blocked += 1;
        continue;
      }

      slot.subscriptions += occurrence.amount;
      slot.total += occurrence.amount;
    }

    /**
     * Parcelas futuras — Transactions que já existem.
     *
     * Nada é reprojetado: usa o `amount` persistido de cada parcela e a fatura
     * real. Terceiros ficam de fora (`personId: null`) porque o valor volta
     * como recebível e não é custo pessoal.
     */
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: 'CREDIT_CARD',
        isRefund: false,
        title: { contains: '/' },
        personId: null,
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

    return {
      months,
      /** Próxima cobrança de cada assinatura, com data real. */
      nextOccurrences: this.buildSubscriptionOccurrences(occurrences),
    };
  }

  /**
   * Próximas cobranças de assinatura, para a lista da tela.
   *
   * Devolve a OCORRÊNCIA concreta — data real com clamp aplicado — e não a
   * regra ("todo dia 12"). A tela mostrava só a regra, então uma assinatura no
   * dia 31 exibia um dia que fevereiro não tem.
   */
  private buildSubscriptionOccurrences(
    occurrences: ForecastOccurrence[],
  ): ForecastOccurrence[] {
    // Uma por assinatura: a próxima. O resto do horizonte já está nos totais
    // mensais, e repetir seis linhas por assinatura afogaria a lista.
    const seen = new Set<string>();
    const next: ForecastOccurrence[] = [];

    for (const occurrence of occurrences) {
      if (seen.has(occurrence.subscriptionId)) continue;
      seen.add(occurrence.subscriptionId);
      next.push(occurrence);
    }

    return next;
  }
}
