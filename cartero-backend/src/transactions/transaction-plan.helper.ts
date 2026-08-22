import { TransactionType } from '@prisma/client';
import {
  getInvoiceCloseDateForPeriod,
  getInvoiceDueDateForPeriod,
  getInvoicePeriodForDate,
  offsetInvoicePeriod,
  type InvoiceSchedule,
} from 'src/common/helpers/invoice.helper';
import { splitInstallmentAmount } from 'src/common/helpers/installment.helper';

/**
 * O plano de uma transação antes de ela existir.
 *
 * É a fonte única entre a criação real e a prévia: as duas derivam daqui a
 * quantidade de lançamentos, o valor de cada parcela, a competência da fatura
 * e o vencimento. Sem isso, a prévia diria "fatura de setembro" e a criação
 * poderia gravar outubro — foi por esse risco que este módulo existe.
 *
 * Tudo aqui é função pura: nenhuma consulta, nenhuma escrita. Quem persiste
 * usa o plano; quem só exibe usa o mesmo plano.
 */

/** Uma parcela planejada — ainda sem id, sem fatura criada. */
export interface PlannedInstallment {
  /** 1-based, como aparece no título ("Notebook 3/10"). */
  number: number;
  /** Valor real desta parcela, já rateado. */
  amount: number;
  /** Competência da fatura que vai receber esta parcela. */
  period: { year: number; month: number } | null;
  /** Vencimento da fatura, quando a parcela cai em uma. */
  dueDate: Date | null;
  /** Fechamento da fatura — útil para explicar por que caiu neste mês. */
  closeDate: Date | null;
  /** Título com o sufixo de parcela, quando a compra é parcelada. */
  title: string;
}

export interface TransactionPlan {
  type: TransactionType;
  /** Total informado pelo usuário. A soma das parcelas fecha com ele. */
  totalAmount: number;
  installmentCount: number;
  isRefund: boolean;
  /** `true` quando o lançamento entra em fatura de cartão. */
  affectsInvoice: boolean;
  installments: PlannedInstallment[];
}

export interface PlanTransactionInput {
  type: TransactionType;
  title: string;
  /** VALOR TOTAL da compra — o rateio acontece aqui dentro. */
  amount: number;
  date: Date;
  installments?: number;
  isRefund?: boolean;
  schedule: InvoiceSchedule;
}

/**
 * Quantas parcelas a operação vai gerar de fato.
 *
 * Só cartão de crédito parcela, e estorno nunca — o service ignora
 * `installments` nesse caso, então o plano precisa refletir a mesma regra.
 */
export function resolveInstallmentCount(input: {
  type: TransactionType;
  isRefund?: boolean;
  installments?: number;
}): number {
  const parcels =
    input.type === TransactionType.CREDIT_CARD && !input.isRefund
      ? (input.installments ?? 1)
      : 1;

  return Math.max(1, parcels);
}

/**
 * Monta o plano completo da transação.
 *
 * A primeira parcela define a competência pela data da compra; as seguintes
 * avançam um mês por parcela — a mesma sequência que a criação usa.
 */
export function planTransaction(input: PlanTransactionInput): TransactionPlan {
  const installmentCount = resolveInstallmentCount(input);
  const amounts = splitInstallmentAmount(input.amount, installmentCount);
  const affectsInvoice = input.type === TransactionType.CREDIT_CARD;

  const firstPeriod = affectsInvoice
    ? getInvoicePeriodForDate(input.schedule, input.date)
    : null;

  const installments: PlannedInstallment[] = amounts.map((amount, index) => {
    const period =
      firstPeriod === null
        ? null
        : index === 0
          ? firstPeriod
          : offsetInvoicePeriod(firstPeriod.year, firstPeriod.month, index);

    return {
      number: index + 1,
      amount,
      period,
      dueDate: period
        ? getInvoiceDueDateForPeriod(input.schedule, period.year, period.month)
        : null,
      closeDate: period
        ? getInvoiceCloseDateForPeriod(
            input.schedule,
            period.year,
            period.month,
          )
        : null,
      title:
        installmentCount > 1
          ? `${input.title} ${index + 1}/${installmentCount}`
          : input.title,
    };
  });

  return {
    type: input.type,
    totalAmount: input.amount,
    installmentCount,
    isRefund: input.isRefund ?? false,
    affectsInvoice,
    installments,
  };
}
