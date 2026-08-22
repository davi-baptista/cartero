import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  parseDateFilterEnd,
  parseDateFilterStart,
} from 'src/common/helpers/date-only.helper';
import { parseDateOnly } from 'src/common/helpers/date-only.helper';
import { findOrCreateSystemReceivableBank } from 'src/common/helpers/invoice.helper';
import {
  assertDebtPaymentDetails,
  createDebtPaymentTransaction,
  createReceivablePaymentTransaction,
} from 'src/common/helpers/settlement.core';
import {
  buildPersonSummary,
  HISTORY_ORDER,
  PENDING_ORDER,
  sumAmounts,
} from 'src/common/helpers/person-consolidated';
import {
  belongsToCompetence,
  dueMonthOf,
  referenceMonthOf,
  resolveDefaultCompetence,
} from 'src/common/helpers/person-settlement-month';
import {
  DEBT_PAID_CATEGORY_COLOR,
  DEBT_PAID_CATEGORY_NAME,
  RECEIVABLE_RECEIVED_CATEGORY_COLOR,
  RECEIVABLE_RECEIVED_CATEGORY_NAME,
  SYSTEM_CATEGORY_ICON,
} from 'src/common/constants/system-categories';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { FindPersonsDto } from './dto/find-persons.dto';
import { GetStatementDto } from './dto/get-statement.dto';
import { SettlePersonDto } from './dto/settle-person.dto';

@Injectable()
export class PersonsService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async create(userId: string, dto: CreatePersonDto) {
    const existing = await this.prisma.person.findFirst({
      where: { userId, name: dto.name },
    });

    if (existing) {
      throw new ConflictException('Pessoa já existe');
    }

    return await this.prisma.person.create({
      data: {
        userId,
        name: dto.name,
        phone: dto.phone?.trim() || null,
      },
    });
  }

  async findOne(id: string, userId: string) {
    return await this.entityValidationService.validatePerson(id, userId);
  }

  async findAll(userId: string, filters: FindPersonsDto = {}) {
    return await this.prisma.person.findMany({
      where: {
        userId,
        name: filters.name
          ? { contains: filters.name, mode: 'insensitive' }
          : undefined,
      },
    });
  }

  async update(id: string, userId: string, dto: UpdatePersonDto) {
    await this.entityValidationService.validatePerson(id, userId);

    // Campos explícitos: `userId` não está no DTO e não pode passar a estar
    // por acidente — espalhar o corpo permitiria mover a pessoa de conta.
    return await this.prisma.person.update({
      where: { id, userId },
      data: {
        name: dto.name,
        phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
      },
    });
  }

  async remove(id: string, userId: string) {
    await this.entityValidationService.validatePerson(id, userId);

    await this.prisma.person.delete({
      where: { id, userId },
    });

    return;
  }

  /**
   * Todas as pendências abertas da pessoa — sem recorte de mês.
   *
   * Usado pelo consolidado e pelo settle, para que os dois vejam exatamente o
   * mesmo conjunto. Quando divergiam, o botão "Quitar pendências" liquidava um
   * subconjunto do que a tela mostrava.
   */
  private pendingWhere(userId: string, personId: string) {
    return { userId, personId, isPaid: false };
  }

  async settle(id: string, userId: string, dto: SettlePersonDto) {
    const person = await this.entityValidationService.validatePerson(
      id,
      userId,
    );

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      /*
        Reconsulta dentro da transação, sem filtro de período.

        Duas razões. A primeira: o comando é "quitar as pendências desta
        pessoa", e uma dívida vencida em junho continua sendo uma pendência
        em agosto — o recorte mensal anterior a deixava aberta em silêncio.

        A segunda: entre abrir o diálogo e confirmar, outro fluxo pode ter
        quitado um item. O `isPaid: false` garante que só o que ainda está
        aberto AGORA é tocado, o que também torna o retry idempotente: na
        segunda chamada o conjunto vem vazio e nada é recriado.
      */
      const where = this.pendingWhere(userId, person.id);
      const [allDebts, allReceivables, user] = await Promise.all([
        tx.debt.findMany({ where, orderBy: PENDING_ORDER }),
        tx.receivable.findMany({
          where,
          orderBy: PENDING_ORDER,
          // A compra de origem decide a competência do recebível automático.
          include: { transaction: { select: { date: true } } },
        }),
        tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: {
            createIncomeOnReceivablePaid: true,
            createExpenseOnDebtPaid: true,
          },
        }),
      ]);

      /*
        Recorte por COMPETÊNCIA, quando informada.

        O cliente diz qual mês está olhando; quem decide a elegibilidade é o
        servidor, aplicando `belongsToCompetence` — a MESMA regra da tela.
        Aceitar uma lista de ids do frontend deixaria o escopo financeiro nas
        mãos do cliente.

        Sem competência, o conjunto é all-time (comportamento anterior).
      */
      const competence =
        dto.year && dto.month ? { year: dto.year, month: dto.month } : null;

      const debts = competence
        ? allDebts.filter((item) => belongsToCompetence(item, competence))
        : allDebts;
      const receivables = competence
        ? allReceivables.filter((item) => belongsToCompetence(item, competence))
        : allReceivables;

      const summary = buildPersonSummary(receivables, debts);
      const paidAt = dto.paymentDate
        ? parseDateOnly(dto.paymentDate)
        : new Date();

      const createsExpense = debts.length > 0 && user.createExpenseOnDebtPaid;
      const createsIncome =
        receivables.length > 0 && user.createIncomeOnReceivablePaid;

      /*
        Validação antes de qualquer escrita.

        A mesma função que o caminho individual usa — a mensagem e a regra não
        podem divergir só porque a operação é em lote.
      */
      if (createsExpense) {
        assertDebtPaymentDetails(dto.paymentBankId, dto.paymentType);
      }

      let settledDebts = 0;
      let settledReceivables = 0;

      if (debts.length > 0) {
        const debtCategory = createsExpense
          ? await this.entityValidationService.findOrCreateSystemCategory(
              tx,
              userId,
              DEBT_PAID_CATEGORY_NAME,
              SYSTEM_CATEGORY_ICON,
              DEBT_PAID_CATEGORY_COLOR,
            )
          : null;
        const paymentBank = createsExpense
          ? await this.entityValidationService.validateBank(
              dto.paymentBankId as string,
              userId,
            )
          : null;

        for (const debt of debts) {
          /*
            `createExpenseOnDebtPaid` desligado: a dívida é quitada SEM
            despesa. Não é registro órfão — é a preferência do usuário, e
            inventar um lançamento aqui poluiria o extrato dele.
          */
          const paymentTransactionId =
            createsExpense && debtCategory && paymentBank
              ? await createDebtPaymentTransaction(tx, {
                  userId,
                  debt,
                  paidAt,
                  bank: paymentBank,
                  paymentType: dto.paymentType as TransactionType,
                  category: debtCategory,
                })
              : null;

          await tx.debt.update({
            where: { id: debt.id, userId },
            data: { isPaid: true, paidAt, paymentTransactionId },
          });
          settledDebts += 1;
        }
      }

      if (receivables.length > 0) {
        const receivableCategory = createsIncome
          ? await this.entityValidationService.findOrCreateSystemCategory(
              tx,
              userId,
              RECEIVABLE_RECEIVED_CATEGORY_NAME,
              SYSTEM_CATEGORY_ICON,
              RECEIVABLE_RECEIVED_CATEGORY_COLOR,
            )
          : null;
        /*
          Recebimento não exige banco do usuário: quando ele não escolhe um, a
          receita entra no banco de sistema. Ele existe para ancorar esses
          lançamentos e nunca aparece nos seletores.
        */
        const receivableBank = createsIncome
          ? await findOrCreateSystemReceivableBank(tx, userId)
          : null;

        for (const receivable of receivables) {
          /*
            Cobrança automática é recebida normalmente. A proteção da Fase 8A
            é contra editar/excluir a compra de origem pela cobrança —
            receber é operação legítima e não toca na compra.
          */
          const paymentTransactionId =
            createsIncome && receivableCategory && receivableBank
              ? await createReceivablePaymentTransaction(tx, {
                  userId,
                  receivable,
                  paidAt,
                  bank: receivableBank,
                  paymentType: null,
                  category: receivableCategory,
                })
              : null;

          await tx.receivable.update({
            where: { id: receivable.id, userId },
            data: { isPaid: true, paidAt, paymentTransactionId },
          });
          settledReceivables += 1;
        }
      }

      return {
        person,
        summary,
        settledDebts,
        settledReceivables,
        /** Quantos lançamentos a operação de fato criou. */
        createdExpenses: createsExpense ? settledDebts : 0,
        createdIncomes: createsIncome ? settledReceivables : 0,
      };
    });
  }

  /**
   * Consolidado da relação com a pessoa.
   *
   * Duas perspectivas distintas, e a distinção é o ponto:
   *
   * - `summary` e `pending` são ALL-TIME. Uma obrigação aberta é uma
   *   obrigação aberta, tenha vencido em junho ou vencer em dezembro.
   * - `history` respeita o período pedido — é ali que o seletor de mês atua.
   *
   * Antes, tudo era filtrado por mês e o resumo era rotulado "no total".
   */
  async getStatement(
    id: string,
    userId: string,
    filters: GetStatementDto = {},
  ) {
    const person = await this.entityValidationService.validatePerson(
      id,
      userId,
    );

    const pendingWhere = this.pendingWhere(userId, person.id);

    /*
      Período aplicado por `paidAt`, não por `dueDate`.

      O histórico responde "o que foi quitado neste mês", e isso é a data do
      pagamento. Filtrar por vencimento traria uma dívida de junho paga em
      agosto para o mês errado.
    */
    const paidAt = {
      gte: filters.startDate
        ? parseDateFilterStart(filters.startDate)
        : undefined,
      lte: filters.endDate ? parseDateFilterEnd(filters.endDate) : undefined,
    };
    const historyWhere = {
      userId,
      personId: person.id,
      isPaid: true,
      paidAt,
    };

    // Quatro queries em paralelo, sem N+1: nada é buscado por item.
    const [pendingDebts, pendingReceivables, historyDebts, historyReceivables] =
      await Promise.all([
        this.prisma.debt.findMany({
          where: pendingWhere,
          orderBy: PENDING_ORDER,
        }),
        this.prisma.receivable.findMany({
          where: pendingWhere,
          orderBy: PENDING_ORDER,
          /*
            A compra de origem define a COMPETÊNCIA do recebível automático:
            um jantar de 16/08 que vence com a fatura em 10/09 pertence ao
            acerto de agosto. Um `include` em lote — nunca um fetch por item.
          */
          include: { transaction: { select: { date: true } } },
        }),
        this.prisma.debt.findMany({
          where: historyWhere,
          orderBy: HISTORY_ORDER,
        }),
        this.prisma.receivable.findMany({
          where: historyWhere,
          orderBy: HISTORY_ORDER,
        }),
      ]);

    const summary = buildPersonSummary(pendingReceivables, pendingDebts);

    /*
      Contrato com os dois universos SEPARADOS por nome.

      Os espelhos `totalDebts` / `totalReceivables` / `netBalance` / `debts` /
      `receivables` foram REMOVIDOS. Eles significavam "do mês" antes da Fase
      8B e "all-time" depois — o mesmo nome, dois universos, e nenhum
      consumidor tinha como saber qual versão estava rodando.

      A auditoria da Fase 8C confirmou que nenhum consumidor os lia: o
      Orçamento consulta `debt`/`receivable` direto no Prisma com filtro de
      mês, e a Visão Geral usa `GET /debts` / `GET /receivables`. O endpoint é
      interno (um único frontend, sem integração externa), então manter alias
      ambíguo não protegeria ninguém.
    */
    return {
      person,

      /** Situação atual: todas as pendências, sem corte temporal. */
      summary,

      /** As pendências que o `summary` soma. Também all-time. */
      pending: { debts: pendingDebts, receivables: pendingReceivables },

      /**
       * Universo MENSAL do acerto com a pessoa.
       *
       * O drawer é mensal: responde "quanto temos para acertar nesta
       * competência?". Cada item aberto carrega as duas competências
       * (`referenceMonth` e `dueMonth`) para o frontend montar a lista e o
       * resumo sem reimplementar a regra — e para o settle usar exatamente o
       * mesmo universo que a tela mostra.
       *
       * `defaultCompetence` é o mês que o drawer deve abrir: o anterior
       * enquanto o acerto dele ainda estiver em andamento (item aberto que não
       * venceu), senão o corrente.
       */
      settlement: {
        defaultCompetence: resolveDefaultCompetence(
          [...pendingReceivables, ...pendingDebts],
          new Date(),
        ),
        receivables: pendingReceivables.map((item) => ({
          ...item,
          referenceMonth: referenceMonthOf(item),
          dueMonth: dueMonthOf(item),
        })),
        debts: pendingDebts.map((item) => ({
          ...item,
          referenceMonth: referenceMonthOf(item),
          dueMonth: dueMonthOf(item),
        })),
      },

      /**
       * Universo temporal — o único lugar onde `startDate`/`endDate` atuam.
       *
       * `appliedRange` devolve o recorte que de fato valeu. Sem isso o
       * consumidor não tem como distinguir "nada foi quitado em agosto" de
       * "nenhum filtro foi aplicado e não há histórico nenhum".
       */
      period: {
        appliedRange: {
          startDate: filters.startDate ?? null,
          endDate: filters.endDate ?? null,
        },
        /** Critério: `paidAt` dentro do intervalo — nunca `dueDate`. */
        scopedBy: 'paidAt' as const,
        settledDebts: historyDebts,
        settledReceivables: historyReceivables,
        settledDebtTotal: sumAmounts(historyDebts),
        settledReceivableTotal: sumAmounts(historyReceivables),
      },
    };
  }
}
