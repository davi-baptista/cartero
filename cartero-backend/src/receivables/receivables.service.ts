import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { Prisma, Receivable } from '@prisma/client';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { getInstallmentDate } from 'src/common/helpers/get-installment-date.helper';
import {
  SOURCE_INVOICE_SELECT,
  resolveSourceDeleteBlockReason,
} from 'src/common/helpers/receivable-source-capability';
import {
  deleteInvoiceIfEmpty,
  findOrCreateSystemReceivableBank,
} from 'src/common/helpers/invoice.helper';
import {
  createReceivablePaymentTransaction,
  removeSettlementTransaction,
  resolveSettlementDate,
  correctSettlementDate,
} from 'src/common/helpers/settlement.core';
import { parseDateFilterEnd, parseDateFilterStart, parseDateOnly } from 'src/common/helpers/date-only.helper';
import {
  INCOME_RECEIVED_CATEGORY_COLOR,
  INCOME_RECEIVED_CATEGORY_NAME,
  RECEIVABLE_RECEIVED_CATEGORY_NAME,
  RECEIVABLE_RECEIVED_CATEGORY_COLOR,
  SYSTEM_CATEGORY_ICON,
} from 'src/common/constants/system-categories';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  assertAutomaticReceivableNotDeleted,
  assertRecurringIncomeClassification,
  assertRecurringIncomeReceivableNotDeleted,
  assertNotAutomaticReceivable,
  assertReceivableNotReceived,
} from 'src/common/helpers/settlement.guard';
import { assertNotActivePersonSettlementMember } from 'src/common/helpers/person-settlement.guard';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { FindReceivablesDto } from './dto/find-receivables.dto';
import { RecurringIncomeService } from 'src/recurring-income/recurring-income.service';

type ReceivableScope = 'ONE' | 'NEXT' | 'ALL';

@Injectable()
export class ReceivablesService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
    @Optional() private recurringIncomeService?: RecurringIncomeService,
  ) {}

  async create(userId: string, dto: CreateReceivableDto) {
    let debtorName: string;

    if (dto.personId) {
      const person = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
      debtorName = person.name;
    } else if (dto.debtorName) {
      debtorName = dto.debtorName;
    } else {
      throw new BadRequestException('Informe debtorName ou personId');
    }

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const installments = dto.installments ? dto.installments : 1;
        const receivables: Receivable[] = [];

        let parentId: string | null = null;

        for (let i = 0; i < installments; i++) {
            const installmentDate = getInstallmentDate(parseDateOnly(dto.dueDate), i);

          const receivable: Receivable = await tx.receivable.create({
            data: {
              userId,
              parentId,
              title:
                installments > 1
                  ? `${dto.title} ${i + 1}/${installments}`
                  : dto.title,
              debtorName,
              personId: dto.personId,
              amount: dto.amount,
              description: dto.description,
              incomeClassification: dto.incomeClassification ?? 'OTHER',
              occurredAt: parseDateOnly(dto.occurredAt),
              dueDate: installmentDate,
            },
          });

          if (i === 0 && installments > 1) {
            parentId = receivable.id;

            await tx.receivable.update({
              where: { id: receivable.id, userId },
              data: { parentId },
            });

            receivable.parentId = parentId;
          }
          receivables.push(receivable);
        }
        return receivables;
      },
    );
  }

  async findOne(id: string, userId: string) {
    await this.recurringIncomeService?.ensureForUser(userId);
    return await this.entityValidationService.validateReceivable(id, userId);
  }

  async findAll(userId: string, filters: FindReceivablesDto = {}) {
    await this.recurringIncomeService?.ensureForUser(userId);
    const receivables = await this.prisma.receivable.findMany({
      where: {
        userId,
        debtorName: filters.debtorName,
        personId: filters.personId,
        dueDate: {
          gte: filters.startDate ? parseDateFilterStart(filters.startDate) : undefined,
          lte: filters.endDate ? parseDateFilterEnd(filters.endDate) : undefined,
        },
      },
      /*
        A fatura da compra de origem entra no MESMO `findMany`.

        Sem ela o frontend oferecia "Excluir compra e cobrança" para uma
        compra de fatura paga, e a recusa só aparecia depois de confirmar.
        Buscar a transação por linha seria N+1 — a relação já existe, então é
        um join, e cem cobranças continuam sendo uma consulta.
      */
      include: { person: true, transaction: SOURCE_INVOICE_SELECT },
    });

    return receivables.map(({ transaction, ...receivable }) => ({
      ...receivable,
      /*
        Só a capability sai; a transação carregada fica no servidor. O
        frontend não precisa da compra para saber que não pode excluí-la.
      */
      sourceDeleteBlockReason: resolveSourceDeleteBlockReason({
        ...receivable,
        transaction,
      }),
    }));
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateReceivableDto,
    scope?: string,
  ) {
    const existing = await this.entityValidationService.validateReceivable(
      id,
      userId,
    );
    const normalizedScope = this.normalizeScope(scope);

    /**
     * Duas guardas antes de qualquer escrita.
     *
     * A auditoria encontrou este método sem nenhuma: um `PATCH { amount }`
     * passava tanto numa cobrança já recebida (divergindo da transação de
     * recebimento) quanto numa cobrança automática (divergindo da compra, e
     * sendo depois sobrescrito por `syncLinkedReceivable` sem aviso).
     *
     * As duas só disparam quando um fato FINANCEIRO muda — descrição continua
     * editável nos dois casos.
     */
    assertReceivableNotReceived(existing, dto, existing);
    assertNotAutomaticReceivable(existing, dto, existing);
    assertRecurringIncomeClassification(existing, dto.incomeClassification);

    let debtorName = dto.debtorName;
    if (dto.personId) {
      const person = await this.entityValidationService.validatePerson(
        dto.personId,
        userId,
      );
      debtorName = person.name;
    }

    const markingAsReceived = dto.isPaid === true;
    /*
      TZ2: `timeZone` vem de graça desta mesma consulta — sem query
      adicional (mesmo padrão de `DebtsService.update`).
    */
    const userPreferences = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });

    const selectedPaymentBank = markingAsReceived && dto.paymentBankId
      ? await this.entityValidationService.validateBank(
          dto.paymentBankId,
          userId,
        )
      : null;

    const { paymentBankId, paymentType, paymentDate, ...receivableDto } = dto;
    const {
      title: _title,
      dueDate: _dueDate,
      occurredAt: _occurredAt,
      ...installmentSafeDto
    } = receivableDto;

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const receivablesToUpdate = await this.getReceivablesByScope(
          tx,
          existing,
          userId,
          normalizedScope,
        );

        if (dto.isPaid === false && existing.isPaid) {
          for (const receivable of receivablesToUpdate) {
            await assertNotActivePersonSettlementMember(tx, 'receivable', receivable.id, userId);
          }
        }

        // occurredAt representa a mesma ocorrência parcelada — propaga para toda a
        // cadeia (o pai e todas as parcelas filhas) independente do scope escolhido
        // para os demais campos, mas só quando o valor de fato mudou.
        const occurredAtChanged =
          dto.occurredAt &&
          parseDateOnly(dto.occurredAt).getTime() !== existing.occurredAt.getTime();
        if (existing.parentId && occurredAtChanged) {
          await tx.receivable.updateMany({
            where: {
              userId,
              OR: [{ id: existing.parentId }, { parentId: existing.parentId }],
            },
            data: { occurredAt: parseDateOnly(dto.occurredAt as string) },
          });
        }

        const updatedReceivables: Receivable[] = [];
        const receivableBank = markingAsReceived
          ? selectedPaymentBank ?? (await findOrCreateSystemReceivableBank(tx, userId))
          : null;

        for (const receivable of receivablesToUpdate) {
          const paidAt =
            dto.isPaid === true && !receivable.isPaid
              ? resolveSettlementDate(
                  paymentDate,
                  new Date(),
                  userPreferences.timeZone,
                )
              : dto.isPaid === false && receivable.isPaid
                ? null
                : undefined;

          let paymentTransactionId = receivable.paymentTransactionId;

          if (
            markingAsReceived &&
            paidAt !== undefined &&
            paidAt !== null &&
            !receivable.paymentTransactionId
          ) {
            /*
              A leitura de `existing` acontece antes da transação e pode ficar
              velha quando dois requests tentam receber a mesma cobrança.

              A reivindicação condicional é a autoridade da corrida: só um
              request consegue transformar o registro ainda aberto. Ela ocorre
              antes da Transaction de recebimento e vive no mesmo `$transaction`,
              então uma falha posterior desfaz também esta marcação.
            */
            const claimed = await tx.receivable.updateMany({
              where: {
                id: receivable.id,
                userId,
                isPaid: false,
                paymentTransactionId: null,
              },
              data: { isPaid: true, paidAt },
            });

            if (claimed.count === 0) {
              /*
                Outro request venceu a corrida. Releia dentro da mesma
                transação para devolver o settlement já existente sem criar
                uma segunda Transaction.

                `isPaid: true` sem comprovante é legado: preservar o estado
                histórico é mais seguro que inventar uma receita agora.
              */
              const settled = await tx.receivable.findUnique({
                where: { id: receivable.id, userId },
              });

              if (!settled) {
                throw new BadRequestException('Recebível não encontrado');
              }

              updatedReceivables.push(settled);
              continue;
            }

            const categoryName =
              receivable.incomeClassification === 'INCOME'
                ? INCOME_RECEIVED_CATEGORY_NAME
                : RECEIVABLE_RECEIVED_CATEGORY_NAME;
            const categoryColor =
              receivable.incomeClassification === 'INCOME'
                ? INCOME_RECEIVED_CATEGORY_COLOR
                : RECEIVABLE_RECEIVED_CATEGORY_COLOR;
            const category =
              await this.entityValidationService.findOrCreateSystemCategory(
                tx,
                userId,
                categoryName,
                SYSTEM_CATEGORY_ICON,
                categoryColor,
              );

            /*
              Mesmo núcleo que o settle de Pessoa usa. O `type` da transação é
              sempre INCOME lá dentro — `paymentType` só decide se o valor
              entra numa fatura.

              A fatura só é considerada quando o usuário escolheu um banco
              próprio; no banco de sistema não existe fatura a alimentar.
            */
            paymentTransactionId = await createReceivablePaymentTransaction(
              tx,
              {
                userId,
                receivable,
                paidAt,
                bank: receivableBank!,
                paymentType: selectedPaymentBank ? (paymentType ?? null) : null,
                category,
                timeZone: userPreferences.timeZone,
              },
            );
          } else if (paidAt === null && receivable.paymentTransactionId) {
            // Zera o vínculo antes do delete — o FK é `ON DELETE SET NULL`.
            await tx.receivable.update({
              where: { id: receivable.id, userId },
              data: { paymentTransactionId: null },
            });

            await removeSettlementTransaction(
              tx,
              userId,
              receivable.paymentTransactionId,
            );

            paymentTransactionId = null;
          }

          const updatedReceivable = await tx.receivable.update({
            where: { id: receivable.id, userId },
            data: {
              ...(existing.parentId ? installmentSafeDto : receivableDto),
              debtorName,
              incomeClassification:
                dto.incomeClassification ?? receivable.incomeClassification,
              occurredAt: dto.occurredAt
                ? parseDateOnly(dto.occurredAt)
                : receivable.occurredAt,
              dueDate: existing.parentId
                ? receivable.dueDate
                : dto.dueDate
                  ? parseDateOnly(dto.dueDate)
                  : receivable.dueDate,
              paidAt: paidAt === undefined ? receivable.paidAt : paidAt,
              paymentTransactionId,
            },
          });

          updatedReceivables.push(updatedReceivable);
        }

        return normalizedScope === 'ONE'
          ? updatedReceivables[0]
          : updatedReceivables;
      },
    );
  }

  async remove(
    id: string,
    userId: string,
    scope?: string,
    preserveTransaction = false,
  ) {
    const existing = await this.entityValidationService.validateReceivable(
      id,
      userId,
    );

    /**
     * Cobrança automática não é excluída por aqui.
     *
     * O código apagava a Transaction DE ORIGEM junto (cascata invertida: o
     * filho removendo o pai), e o caminho oposto — excluir a transação com a
     * cobrança recebida — era bloqueado. A mesma inconsistência era alcançável
     * pelo lado desprotegido.
     */
    assertAutomaticReceivableNotDeleted(existing);
    assertRecurringIncomeReceivableNotDeleted(existing);

    const normalizedScope = this.normalizeScope(scope);

    return await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const receivablesToDelete = await this.getReceivablesByScope(
          tx,
          existing,
          userId,
          normalizedScope,
        );

        for (const receivable of receivablesToDelete) {
          if (receivable.isPaid) await assertNotActivePersonSettlementMember(tx, 'receivable', receivable.id, userId);
        }

        for (const receivable of receivablesToDelete) {
          await tx.receivable.delete({
            where: { id: receivable.id, userId },
          });

          if (receivable.transactionId && !preserveTransaction) {
            const transaction = await tx.transaction.findUnique({
              where: { id: receivable.transactionId, userId },
            });

            if (transaction) {
              await tx.transaction.delete({
                where: { id: transaction.id, userId },
              });

              if (transaction.invoiceId) {
                const invoice = await tx.invoice.update({
                  where: { id: transaction.invoiceId, userId },
                  data: {
                    totalAmount: { decrement: transaction.amount },
                  },
                });

                await deleteInvoiceIfEmpty(tx, userId, invoice);
              }
            }
          }

          if (receivable.paymentTransactionId && !preserveTransaction) {
            const paymentTransaction = await tx.transaction.findUnique({
              where: { id: receivable.paymentTransactionId, userId },
            });

            if (paymentTransaction) {
              await tx.transaction.delete({
                where: { id: paymentTransaction.id, userId },
              });

              if (paymentTransaction.invoiceId) {
                const invoice = await tx.invoice.update({
                  where: { id: paymentTransaction.invoiceId, userId },
                  data: {
                    totalAmount: { decrement: paymentTransaction.amount },
                  },
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

  private normalizeScope(scope?: string): ReceivableScope {
    if (scope === 'NEXT' || scope === 'ALL') {
      return scope;
    }

    return 'ONE';
  }

  private async getReceivablesByScope(
    tx: Prisma.TransactionClient,
    receivable: Receivable,
    userId: string,
    scope: ReceivableScope,
  ) {
    if (!receivable.parentId || scope === 'ONE') {
      return [receivable];
    }

    if (scope === 'NEXT') {
      return await tx.receivable.findMany({
        where: {
          userId,
          parentId: receivable.parentId,
          dueDate: {
            gte: receivable.dueDate,
          },
        },
        orderBy: {
          dueDate: 'asc',
        },
      });
    }

    return await tx.receivable.findMany({
      where: {
        userId,
        parentId: receivable.parentId,
      },
      orderBy: {
        dueDate: 'asc',
      },
    });
  }

  /**
   * Corrige a data real do recebimento de uma cobrança já recebida.
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
    /*
      TZ2: única leitura pontual — este método não tinha nenhuma consulta de
      `User` para reaproveitar (ao contrário de `update`, acima).
    */
    const { timeZone } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });
    const data = resolveSettlementDate(paidAt, new Date(), timeZone);

    await this.prisma.$transaction(async (tx) => {
      await correctSettlementDate(tx, {
        kind: 'receivable',
        id,
        userId,
        paidAt: data,
      });
    });

    return this.findOne(id, userId);
  }
}
