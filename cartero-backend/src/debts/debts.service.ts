import { BadRequestException, Injectable } from '@nestjs/common';
import { deleteInvoiceIfEmpty } from 'src/common/helpers/invoice.helper';
import { Prisma, Debt, TransactionType } from '@prisma/client';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { getInstallmentDate } from 'src/common/helpers/get-installment-date.helper';
import {
  createDebtPaymentTransaction,
  removeSettlementTransaction,
  resolveSettlementDate,
  correctSettlementDate,
} from 'src/common/helpers/settlement.core';
import { parseDateFilterEnd, parseDateFilterStart, parseDateOnly } from 'src/common/helpers/date-only.helper';
import {
  DEBT_PAID_CATEGORY_NAME,
  DEBT_PAID_CATEGORY_COLOR,
  SYSTEM_CATEGORY_ICON,
} from 'src/common/constants/system-categories';
import { PrismaService } from 'src/prisma/prisma.service';
import { assertDebtNotPaid } from 'src/common/helpers/settlement.guard';
import { CreateDebtDto } from 'src/debts/dto/create-debt.dto';
import { UpdateDebtDto } from 'src/debts/dto/update-debt.dto';
import { FindDebtsDto } from './dto/find-debts.dto';

type DebtScope = 'ONE' | 'NEXT' | 'ALL';

@Injectable()
export class DebtsService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async create(userId: string, dto: CreateDebtDto) {
    let creditorName: string;

    if (dto.personId) {
      const person = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
      creditorName = person.name;
    } else if (dto.creditorName) {
      creditorName = dto.creditorName;
    } else {
      throw new BadRequestException('Informe creditorName ou personId');
    }

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const installments = dto.installments ? dto.installments : 1;
        const debts: Debt[] = [];

        let parentId: string | null = null;

        for (let i = 0; i < installments; i++) {
            const installmentDate = getInstallmentDate(parseDateOnly(dto.dueDate), i);

          const debt: Debt = await tx.debt.create({
            data: {
              userId,
              parentId,
              title:
                installments > 1
                  ? `${dto.title} ${i + 1}/${installments}`
                  : dto.title,
              creditorName,
              personId: dto.personId,
              amount: dto.amount,
              description: dto.description,
              occurredAt: parseDateOnly(dto.occurredAt),
              dueDate: installmentDate,
              isAlertEnabled: dto.isAlertEnabled,
            },
          });

          if (i === 0 && installments > 1) {
            parentId = debt.id;

            await tx.debt.update({
              where: { id: debt.id, userId },
              data: { parentId },
            });

            debt.parentId = parentId;
          }
          debts.push(debt);
        }
        return debts;
      },
    );
  }

  async findOne(id: string, userId: string) {
    return await this.entityValidationService.validateDebt(id, userId);
  }

  async findAll(userId: string, filters: FindDebtsDto = {}) {
    return await this.prisma.debt.findMany({
      where: {
        userId,
        creditorName: filters.creditorName,
        personId: filters.personId,
        dueDate: {
          gte: filters.startDate ? parseDateFilterStart(filters.startDate) : undefined,
          lte: filters.endDate ? parseDateFilterEnd(filters.endDate) : undefined,
        },
      },
      include: { person: true },
    });
  }

  async update(id: string, userId: string, dto: UpdateDebtDto, scope?: string) {
    const existing = await this.entityValidationService.validateDebt(
      id,
      userId,
    );
    const normalizedScope = this.normalizeScope(scope);

    /**
     * Dívida paga é fato concluído.
     *
     * Alterar o valor de uma dívida paga deixava o comprovante apontando para
     * outro número — a dívida dizia R$ 100, a transação dizia R$ 500. A saída
     * é desfazer o pagamento, corrigir e marcar de novo.
     *
     * Só fatos financeiros são barrados; título e descrição continuam livres.
     */
    assertDebtNotPaid(existing, dto, existing);

    let creditorName = dto.creditorName;
    if (dto.personId) {
      const person = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
      creditorName = person.name;
    }

    const markingAsPaid = dto.isPaid === true;
    const userPreferences = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { createExpenseOnDebtPaid: true },
    });
    const shouldCreatePaymentTransaction =
      markingAsPaid && userPreferences.createExpenseOnDebtPaid;

    if (shouldCreatePaymentTransaction) {
      if (!dto.paymentBankId || !dto.paymentType) {
        throw new BadRequestException(
          'Informe paymentBankId e paymentType para marcar a dívida como paga',
        );
      }
      if (dto.paymentType === TransactionType.INCOME) {
        throw new BadRequestException(
          'paymentType inválido para pagamento de dívida',
        );
      }
    }

    const paymentBank = shouldCreatePaymentTransaction
      ? await this.entityValidationService.validateBank(
          dto.paymentBankId as string,
          userId,
        )
      : null;

    /*
      Instruções de pagamento não são colunas da dívida.

      `paymentBankId`, `paymentDate` e `paymentType` dizem COMO registrar o
      pagamento; deixá-los no objeto de update faria o Prisma tentar gravá-los
      como campos de Debt. O banco resolvido vive em `paymentBank` e a data em
      `paidAt`.
    */
    const { paymentType } = dto;
    const debtDto = { ...dto };
    delete debtDto.paymentBankId;
    delete debtDto.paymentDate;
    delete debtDto.paymentType;
    const {
      title: _title,
      dueDate: _dueDate,
      occurredAt: _occurredAt,
      ...installmentSafeDto
    } = debtDto;

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const debtsToUpdate = await this.getDebtsByScope(
          tx,
          existing,
          userId,
          normalizedScope,
        );

        // occurredAt representa a mesma ocorrência parcelada — propaga para toda a
        // cadeia (o pai e todas as parcelas filhas) independente do scope escolhido
        // para os demais campos, mas só quando o valor de fato mudou.
        const occurredAtChanged =
          dto.occurredAt &&
          parseDateOnly(dto.occurredAt).getTime() !== existing.occurredAt.getTime();
        if (existing.parentId && occurredAtChanged) {
          await tx.debt.updateMany({
            where: {
              userId,
              OR: [{ id: existing.parentId }, { parentId: existing.parentId }],
            },
            data: { occurredAt: parseDateOnly(dto.occurredAt as string) },
          });
        }

        const updatedDebts: Debt[] = [];

        for (const debt of debtsToUpdate) {
          /*
            A data escolhida no diálogo vale para os dois lados.

            Antes era `new Date()` fixo: a dívida registrava hoje e o
            comprovante também, ignorando o campo que o usuário preencheu.
            O caminho de Recebíveis já respeitava `paymentDate`, então a mesma
            ação tinha duas datas dependendo do domínio.
          */
          const paidAt =
            dto.isPaid === true && !debt.isPaid
              ? resolveSettlementDate(dto.paymentDate)
              : dto.isPaid === false && debt.isPaid
                ? null
                : undefined;

          let paymentTransactionId = debt.paymentTransactionId;

          if (
            shouldCreatePaymentTransaction &&
            paidAt !== undefined &&
            paidAt !== null &&
            !debt.paymentTransactionId
          ) {
            const category =
              await this.entityValidationService.findOrCreateSystemCategory(
                tx,
                userId,
                DEBT_PAID_CATEGORY_NAME,
                SYSTEM_CATEGORY_ICON,
                DEBT_PAID_CATEGORY_COLOR,
              );

            // Mesmo núcleo que o settle de Pessoa usa: o lote não pode ter
            // regra financeira diferente só por ser em lote.
            paymentTransactionId = await createDebtPaymentTransaction(tx, {
              userId,
              debt,
              paidAt,
              bank: paymentBank!,
              paymentType: paymentType as TransactionType,
              category,
            });
          } else if (paidAt === null && debt.paymentTransactionId) {
            // Zera o vínculo ANTES do delete: o FK é `ON DELETE SET NULL`, e
            // apagar primeiro faria o banco limpar a referência sozinho.
            await tx.debt.update({
              where: { id: debt.id, userId },
              data: { paymentTransactionId: null },
            });

            await removeSettlementTransaction(
              tx,
              userId,
              debt.paymentTransactionId,
            );

            paymentTransactionId = null;
          }

            const updatedDebt = await tx.debt.update({
            where: { id: debt.id, userId },
            data: {
              ...(existing.parentId ? installmentSafeDto : debtDto),
              creditorName,
              occurredAt: dto.occurredAt
                ? parseDateOnly(dto.occurredAt)
                : debt.occurredAt,
              dueDate: existing.parentId
                ? debt.dueDate
                : dto.dueDate
                  ? parseDateOnly(dto.dueDate)
                  : debt.dueDate,
              paidAt,
              paymentTransactionId,
            },
          });

          updatedDebts.push(updatedDebt);
        }

        return normalizedScope === 'ONE' ? updatedDebts[0] : updatedDebts;
      },
    );
  }

  async remove(
    id: string,
    userId: string,
    scope?: string,
    preserveTransaction = false,
  ) {
    const existing = await this.entityValidationService.validateDebt(
      id,
      userId,
    );
    const normalizedScope = this.normalizeScope(scope);

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const debtsToDelete = await this.getDebtsByScope(
          tx,
          existing,
          userId,
          normalizedScope,
        );

        for (const debt of debtsToDelete) {
          await tx.debt.delete({
            where: { id: debt.id, userId },
          });

          if (debt.paymentTransactionId && !preserveTransaction) {
            const transaction = await tx.transaction.findUnique({
              where: { id: debt.paymentTransactionId, userId },
            });

            if (transaction) {
              await tx.transaction.delete({
                where: { id: transaction.id, userId },
              });

              if (transaction.invoiceId) {
                const invoice = await tx.invoice.update({
                  where: { id: transaction.invoiceId, userId },
                  data: { totalAmount: { decrement: transaction.amount } },
                });

                await deleteInvoiceIfEmpty(tx, userId, invoice);
              }
            }
          }
        }

        return;
      },
    );
  }

  private normalizeScope(scope?: string): DebtScope {
    if (scope === 'NEXT' || scope === 'ALL') {
      return scope;
    }

    return 'ONE';
  }

  private async getDebtsByScope(
    tx: Prisma.TransactionClient,
    debt: Debt,
    userId: string,
    scope: DebtScope,
  ) {
    if (!debt.parentId || scope === 'ONE') {
      return [debt];
    }

    if (scope === 'NEXT') {
      return await tx.debt.findMany({
        where: {
          userId,
          parentId: debt.parentId,
          dueDate: {
            gte: debt.dueDate,
          },
        },
        orderBy: {
          dueDate: 'asc',
        },
      });
    }

    return await tx.debt.findMany({
      where: {
        userId,
        parentId: debt.parentId,
      },
      orderBy: {
        dueDate: 'asc',
      },
    });
  }

  /**
   * Corrige a data real do pagamento de uma dívida já paga.
   *
   * `paidAt` significa "quando o dinheiro se moveu", não "quando registrei no
   * Cartero". Regularizar um lançamento antigo gravava a data de hoje, e o
   * Budget — que reconstrói o histórico por `paidAt` — passava a mostrar a
   * obrigação como pendência anterior em todos os meses intermediários.
   *
   * Atômico: `paidAt` e a data da Transaction-espelho descrevem o mesmo fato
   * e não podem divergir nem por um instante.
   */
  async updateSettlementDate(id: string, userId: string, paidAt: string) {
    const data = resolveSettlementDate(paidAt);

    await this.prisma.$transaction(async (tx) => {
      await correctSettlementDate(tx, {
        kind: 'debt',
        id,
        userId,
        paidAt: data,
      });
    });

    return this.findOne(id, userId);
  }
}
