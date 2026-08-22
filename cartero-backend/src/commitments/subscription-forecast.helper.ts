import type { InvoiceStatus, TransactionType } from '@prisma/client';
import {
  addCycles,
  chargeDateForCycle,
  compareCycles,
  currentCycle,
  formatCycle,
  nextChargeDate,
  parseCycle,
  type Cycle,
} from 'src/common/helpers/subscription.helper';
import {
  getInvoicePeriodForDate,
  type InvoiceSchedule,
} from 'src/common/helpers/invoice.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Projeção de assinaturas — função pura, sem escrita
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Responde "quais cobranças desta assinatura realmente aconteceriam dentro do
 * horizonte, e em que mês financeiro cada uma cai".
 *
 * A versão anterior aplicava `subscription.amount` igual nos seis meses do
 * horizonte, ignorando `dayOfMonth`, `startedAt`, `activeSince`,
 * `lastGeneratedFor` e a competência da fatura. O número exibido não
 * correspondia a nada que o sistema fosse gerar.
 *
 * ─── Duas datas, dois papéis ──────────────────────────────────────────────
 *
 * Uma cobrança de cartão tem a DATA em que o serviço cobra e o MÊS em que o
 * usuário paga — a fatura. Uma assinatura que cobra em 28/08 num cartão que
 * fechou em 26/08 cai na fatura de outubro, e é em outubro que aquele valor
 * sai do bolso. Os totais mensais usam a perspectiva financeira; a data da
 * cobrança acompanha como informação.
 *
 * Para PIX, débito e boleto não existe fatura: o mês financeiro é o da própria
 * cobrança.
 */

/** Assinatura com o mínimo que a projeção precisa ler. */
export interface ForecastableSubscription {
  id: string;
  title: string;
  amount: number;
  type: TransactionType;
  dayOfMonth: number;
  startedAt: string;
  activeSince: string | null;
  lastGeneratedFor: string | null;
  isActive: boolean;
  bankId: string;
}

/** Fatura já existente, para a projeção não recalcular datas congeladas. */
export interface KnownInvoice {
  bankId: string;
  year: number;
  month: number;
  status: InvoiceStatus;
  dueDate: Date;
}

/**
 * Por que uma ocorrência projetada não vai virar lançamento.
 *
 * Espelha os motivos que a geração real usa, para o total do forecast
 * concordar com o que o sistema efetivamente fará.
 */
export type ForecastBlockReason = 'invoice-paid' | 'bank-archived';

export interface ForecastOccurrence {
  subscriptionId: string;
  title: string;
  amount: number;
  cycle: string;
  /** Data civil da cobrança, com clamp de mês curto aplicado. */
  chargeDate: Date;
  /** Mês financeiro: a competência da fatura, ou o da cobrança sem fatura. */
  financialPeriod: { year: number; month: number };
  /** Preenchido para CREDIT_CARD quando a fatura de destino já existe. */
  invoiceStatus: InvoiceStatus | null;
  /**
   * Quando presente, a geração real NÃO criará este lançamento — o valor não
   * entra nos totais comprometidos.
   */
  blocked: ForecastBlockReason | null;
}

export interface ForecastInput {
  subscriptions: ForecastableSubscription[];
  /** Calendário por banco, para resolver a competência prospectiva. */
  schedules: Map<string, InvoiceSchedule>;
  /** Faturas existentes, indexadas por `bankId-year-month`. */
  invoices: Map<string, KnownInvoice>;
  /** Bancos arquivados — assinatura ativa neles não gera. */
  archivedBankIds: Set<string>;
  /** Quantos meses à frente projetar, contando o corrente. */
  horizonMonths: number;
  today?: Date;
}

const invoiceKey = (bankId: string, year: number, month: number) =>
  `${bankId}-${year}-${month}`;

/**
 * Primeiro ciclo que a assinatura ainda vai gerar.
 *
 * Derivado de `nextChargeDate` — a mesma função que a listagem de assinaturas
 * usa — para que a primeira ocorrência do forecast coincida com o
 * `nextCharge` mostrado ao usuário. Duas regras concorrentes divergiriam, e a
 * divergência apareceria como "a próxima cobrança é dia 12" ao lado de um
 * forecast que começa em outro mês.
 */
function firstCycle(
  subscription: ForecastableSubscription,
  today: Date,
): Cycle | null {
  const next = nextChargeDate(subscription, today);
  if (!next) return null;
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
}

/**
 * Mês financeiro de uma ocorrência.
 *
 * CREDIT_CARD: a competência da fatura em que a cobrança cai, resolvida pelo
 * MESMO helper que a criação de transação usa. Demais formas: o mês da própria
 * cobrança, porque não há fatura envolvida.
 */
function resolveFinancialPeriod(
  subscription: ForecastableSubscription,
  chargeDate: Date,
  schedules: Map<string, InvoiceSchedule>,
): { year: number; month: number } {
  if (subscription.type !== 'CREDIT_CARD') {
    return {
      year: chargeDate.getUTCFullYear(),
      month: chargeDate.getUTCMonth() + 1,
    };
  }

  const schedule = schedules.get(subscription.bankId);
  if (!schedule) {
    // Sem calendário do banco não há como resolver competência; cair no mês da
    // cobrança é melhor que descartar a ocorrência em silêncio.
    return {
      year: chargeDate.getUTCFullYear(),
      month: chargeDate.getUTCMonth() + 1,
    };
  }

  return getInvoicePeriodForDate(schedule, chargeDate);
}

/**
 * Ocorrências de todas as assinaturas dentro do horizonte.
 *
 * Pausadas produzem zero ocorrências: não são obrigação futura. Assinaturas
 * cujo `startedAt` ainda não chegou também não aparecem antes do tempo — o
 * horizonte não é uma matriz de seis posições a preencher.
 */
export function forecastSubscriptionOccurrences(
  input: ForecastInput,
): ForecastOccurrence[] {
  const today = input.today ?? new Date();
  const firstPeriod = currentCycle(today);
  const lastPeriod = addCycles(firstPeriod, input.horizonMonths - 1);

  const occurrences: ForecastOccurrence[] = [];

  for (const subscription of input.subscriptions) {
    // Pausada não tem cobrança futura. `nextChargeDate` já devolve null, mas
    // a checagem explícita documenta a regra de produto.
    if (!subscription.isActive) continue;

    const start = firstCycle(subscription, today);
    if (!start) continue;

    const archived = input.archivedBankIds.has(subscription.bankId);

    /**
     * O laço avança por CICLO, não por mês do horizonte.
     *
     * A competência financeira de uma cobrança pode cair depois do mês em que
     * ela acontece, então um ciclo dentro do horizonte pode ter mês financeiro
     * fora dele — e vice-versa. Percorrer ciclos e filtrar pelo mês financeiro
     * cobre os dois casos; iterar meses do horizonte perderia ocorrências.
     *
     * O limite é o horizonte mais uma folga de dois ciclos: o intervalo entre
     * cobrança e vencimento de fatura não passa disso em configuração real.
     */
    const maxCycle = addCycles(lastPeriod, 2);

    for (
      let cycle = start;
      compareCycles(cycle, maxCycle) <= 0;
      cycle = addCycles(cycle, 1)
    ) {
      const chargeDate = chargeDateForCycle(cycle, subscription.dayOfMonth);
      const financialPeriod = resolveFinancialPeriod(
        subscription,
        chargeDate,
        input.schedules,
      );

      // Fora do horizonte pela perspectiva financeira — é ela que os totais
      // mensais usam.
      const financialCycle = {
        year: financialPeriod.year,
        month: financialPeriod.month,
      };
      if (compareCycles(financialCycle, firstPeriod) < 0) continue;
      if (compareCycles(financialCycle, lastPeriod) > 0) continue;

      const invoice =
        subscription.type === 'CREDIT_CARD'
          ? input.invoices.get(
              invoiceKey(
                subscription.bankId,
                financialPeriod.year,
                financialPeriod.month,
              ),
            )
          : undefined;

      /**
       * Motivo de bloqueio, na ordem em que a geração real os aplica.
       *
       * Banco arquivado impede qualquer lançamento; fatura paga descarta o
       * ciclo. Nos dois casos o valor NÃO entra no total comprometido, senão o
       * forecast prometeria um gasto que o sistema não vai criar.
       */
      let blocked: ForecastBlockReason | null = null;
      if (archived) blocked = 'bank-archived';
      else if (invoice?.status === 'PAID') blocked = 'invoice-paid';

      occurrences.push({
        subscriptionId: subscription.id,
        title: subscription.title,
        amount: subscription.amount,
        cycle: formatCycle(cycle),
        chargeDate,
        financialPeriod,
        invoiceStatus: invoice?.status ?? null,
        blocked,
      });
    }
  }

  return occurrences.sort(
    (a, b) => a.chargeDate.getTime() - b.chargeDate.getTime(),
  );
}

/**
 * Competências que a projeção precisa consultar no banco.
 *
 * Calculada ANTES de buscar faturas, para que a consulta seja uma só — sem
 * uma query por assinatura ou por ocorrência.
 */
export function forecastInvoiceLookups(
  subscriptions: ForecastableSubscription[],
  schedules: Map<string, InvoiceSchedule>,
  horizonMonths: number,
  today: Date = new Date(),
): Array<{ bankId: string; year: number; month: number }> {
  const seen = new Set<string>();
  const lookups: Array<{ bankId: string; year: number; month: number }> = [];

  const firstPeriod = currentCycle(today);
  // A folga cobre a competência de uma cobrança do fim do horizonte que caia
  // em fatura posterior.
  const lastPeriod = addCycles(firstPeriod, horizonMonths + 1);

  for (const subscription of subscriptions) {
    if (!subscription.isActive) continue;
    if (subscription.type !== 'CREDIT_CARD') continue;

    for (
      let cycle = firstPeriod;
      compareCycles(cycle, lastPeriod) <= 0;
      cycle = addCycles(cycle, 1)
    ) {
      const chargeDate = chargeDateForCycle(cycle, subscription.dayOfMonth);
      const period = resolveFinancialPeriod(
        subscription,
        chargeDate,
        schedules,
      );
      const key = invoiceKey(subscription.bankId, period.year, period.month);
      if (seen.has(key)) continue;
      seen.add(key);
      lookups.push({
        bankId: subscription.bankId,
        year: period.year,
        month: period.month,
      });
    }
  }

  return lookups;
}

/** Chave de indexação das faturas conhecidas. */
export const buildInvoiceKey = invoiceKey;

/** Reexportado para o serviço montar ciclos sem reimplementar parsing. */
export { parseCycle };
