import { BadRequestException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import type { Bank, Debt, Receivable } from '@prisma/client';
import { findOrCreateInvoice } from './invoice.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Núcleo de quitação — a mesma regra para item individual e para lote
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `PersonsService.settle` reimplementava ~110 linhas de `DebtsService.update`
 * e `ReceivablesService.update`: criava a Transaction de pagamento, resolvia
 * categoria de sistema, calculava fatura, incrementava `totalAmount` e
 * gravava `paymentTransactionId` — tudo com código próprio.
 *
 * Reimplementação não é só duplicação: as duas cópias JÁ tinham divergido.
 * O lote respeitava `paymentDate` e o individual da dívida usava
 * `new Date()`, então quitar a mesma dívida por dois caminhos gravava datas
 * diferentes. E o lote não chamava nenhuma das guardas da Fase 8A.
 *
 * Este módulo é o menor núcleo que os dois lados precisam compartilhar: o que
 * a Transaction de quitação contém, de onde vem o banco, de onde vem a
 * categoria, e como a fatura é afetada. Quem chama continua responsável por
 * escopo (`ONE`/`NEXT`/`ALL`), guardas de edição e transação de banco.
 */

/** Categoria de sistema resolvida pelo chamador (cada domínio tem a sua). */
export interface SettlementCategory {
  id: string;
}

export interface DebtPaymentInput {
  userId: string;
  debt: Pick<Debt, 'id' | 'title' | 'amount'>;
  /** Data do pagamento — a MESMA gravada em `paidAt` e na Transaction. */
  paidAt: Date;
  /** Banco escolhido pelo usuário; obrigatório para dívida. */
  bank: Pick<Bank, 'id' | 'invoiceDueDate' | 'invoiceDueDaysAfterClose'>;
  paymentType: TransactionType;
  category: SettlementCategory;
}

export interface ReceivablePaymentInput {
  userId: string;
  receivable: Pick<Receivable, 'id' | 'title' | 'amount'>;
  paidAt: Date;
  /**
   * Banco onde a receita entra.
   *
   * Recebimento não exige banco do usuário — quando ele não escolhe, o
   * chamador passa o banco de sistema (`findOrCreateSystemReceivableBank`).
   */
  bank: Pick<Bank, 'id' | 'invoiceDueDate' | 'invoiceDueDaysAfterClose'>;
  /**
   * Forma escolhida no diálogo. Só decide se o lançamento entra numa fatura;
   * o `type` da Transaction é sempre `INCOME` (ver abaixo).
   */
  paymentType: TransactionType | null;
  category: SettlementCategory;
}

/**
 * Valida os dados de pagamento de uma dívida.
 *
 * Fica aqui — e não em cada serviço — porque a mensagem e a regra têm de ser
 * as mesmas nos dois caminhos. `INCOME` é recusado porque pagar uma dívida é
 * saída de dinheiro; aceitá-lo inverteria o sinal do lançamento.
 */
export function assertDebtPaymentDetails(
  paymentBankId: string | undefined,
  paymentType: TransactionType | undefined,
): asserts paymentType is TransactionType {
  if (!paymentBankId || !paymentType) {
    throw new BadRequestException(
      'Informe o banco e a forma de pagamento para quitar a dívida',
    );
  }
  if (paymentType === TransactionType.INCOME) {
    throw new BadRequestException(
      'A forma de pagamento de uma dívida não pode ser receita',
    );
  }
}

/**
 * Cria a Transaction que comprova o pagamento de uma dívida e devolve seu id.
 *
 * Não grava `paymentTransactionId` na dívida: quem chama já está atualizando
 * a dívida por outros motivos (`isPaid`, `paidAt`) e faz isso num só update.
 */
export async function createDebtPaymentTransaction(
  tx: Prisma.TransactionClient,
  input: DebtPaymentInput,
): Promise<string> {
  const { userId, debt, paidAt, bank, paymentType, category } = input;

  /*
    Pagamento no crédito entra na fatura do banco escolhido.

    A competência sai da data do pagamento, não do vencimento da dívida: o
    dinheiro saiu quando a fatura correspondente fechar.
  */
  let invoiceId: string | null = null;
  if (paymentType === TransactionType.CREDIT_CARD) {
    const invoice = await findOrCreateInvoice(
      tx,
      userId,
      bank.id,
      bank.invoiceDueDate,
      bank.invoiceDueDaysAfterClose,
      paidAt,
    );
    invoiceId = invoice.id;
  }

  const paymentTransaction = await tx.transaction.create({
    data: {
      userId,
      bankId: bank.id,
      categoryId: category.id,
      invoiceId,
      title: debt.title,
      type: paymentType,
      amount: debt.amount,
      date: paidAt,
    },
  });

  if (invoiceId) {
    await tx.invoice.update({
      where: { id: invoiceId, userId },
      data: { totalAmount: { increment: debt.amount } },
    });
  }

  return paymentTransaction.id;
}

/**
 * Cria a Transaction que comprova o recebimento de uma cobrança.
 *
 * `type` é sempre `INCOME`, independente do `paymentType` escolhido. Escolher
 * "cartão de crédito" aqui é um caso de borda legítimo — significa apenas que
 * o valor cai na fatura daquele cartão — mas registrar a entrada como despesa
 * distorceria os totais de receita e gasto do mês.
 */
export async function createReceivablePaymentTransaction(
  tx: Prisma.TransactionClient,
  input: ReceivablePaymentInput,
): Promise<string> {
  const { userId, receivable, paidAt, bank, paymentType, category } = input;

  let invoiceId: string | null = null;
  if (paymentType === TransactionType.CREDIT_CARD) {
    const invoice = await findOrCreateInvoice(
      tx,
      userId,
      bank.id,
      bank.invoiceDueDate,
      bank.invoiceDueDaysAfterClose,
      paidAt,
    );
    invoiceId = invoice.id;
  }

  const paymentTransaction = await tx.transaction.create({
    data: {
      userId,
      bankId: bank.id,
      categoryId: category.id,
      invoiceId,
      title: receivable.title,
      type: TransactionType.INCOME,
      amount: receivable.amount,
      date: paidAt,
    },
  });

  if (invoiceId) {
    await tx.invoice.update({
      where: { id: invoiceId, userId },
      data: { totalAmount: { increment: receivable.amount } },
    });
  }

  return paymentTransaction.id;
}

/**
 * Remove a Transaction de quitação ao desfazer um pagamento.
 *
 * Devolve a fatura ao estado anterior e apaga a fatura que ficou vazia — uma
 * fatura de R$ 0,00 na lista do banco é ruído, não histórico.
 *
 * O `paymentTransactionId` do registro é zerado ANTES do delete: o FK é
 * `ON DELETE SET NULL`, e apagar primeiro faria o banco zerar o vínculo por
 * conta própria, deixando o delete explícito sem alvo.
 */
export async function removeSettlementTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  paymentTransactionId: string,
): Promise<void> {
  const paymentTransaction = await tx.transaction.findUnique({
    where: { id: paymentTransactionId, userId },
  });

  if (!paymentTransaction) return;

  await tx.transaction.delete({
    where: { id: paymentTransaction.id, userId },
  });

  if (!paymentTransaction.invoiceId) return;

  const invoice = await tx.invoice.update({
    where: { id: paymentTransaction.invoiceId, userId },
    data: { totalAmount: { decrement: paymentTransaction.amount } },
  });

  if (Number(invoice.totalAmount) === 0) {
    await tx.invoice.delete({ where: { id: invoice.id, userId } });
  }
}
