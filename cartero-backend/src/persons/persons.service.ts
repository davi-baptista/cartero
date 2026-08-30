import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { findOrCreateSystemReceivableBank } from 'src/common/helpers/invoice.helper';
import {
  assertDebtPaymentDetails,
  createDebtPaymentTransaction,
  createReceivablePaymentTransaction,
  resolveSettlementDate,
} from 'src/common/helpers/settlement.core';
import { resolveSourceDeleteBlockReason } from 'src/common/helpers/receivable-source-capability';
import {
  buildPersonSummary,
  HISTORY_ORDER,
  PENDING_ORDER,
  sumAmounts,
} from 'src/common/helpers/person-consolidated';
import {
  belongsToCompetence,
  belongsToHistoryCompetence,
  dueMonthOf,
  referenceMonthOf,
  resolveDefaultCompetence,
  type SettleableItem,
  type SettlementCompetence,
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

  /**
   * ════════════════════════════════════════════════════════════════════════
   * Saldo mensal de TODOS os contatos, em lote
   * ════════════════════════════════════════════════════════════════════════
   *
   * Responde, para a lista de Pessoas: "quanto está em aberto com cada
   * contato nesta competência?".
   *
   * A regra NÃO é reimplementada aqui. `belongsToCompetence` e
   * `buildPersonSummary` são exatamente os mesmos que `getStatement` usa —
   * se as duas superfícies divergissem, o usuário veria um número na lista e
   * outro ao abrir a pessoa, e nenhum dos dois seria obviamente o errado.
   *
   * TRÊS queries no total, independente do número de contatos: uma por
   * tabela, agrupadas em memória. A alternativa óbvia — chamar o extrato por
   * pessoa — seria N+1 numa tela que existe justamente para evitar abrir
   * pessoa por pessoa.
   *
   * O `include` da transação de origem é obrigatório, não conveniência: sem
   * ele `belongsToCompetence` resolveria o recebível automático pelo
   * vencimento em vez da data da compra, e o item cairia no mês errado em
   * silêncio.
   *
   * Contatos sem movimento entram com saldo zero. A página também é lista de
   * contatos: sumir com alguém porque não deve nada neste mês esconderia
   * justamente quem está em dia.
   */
  async monthlySummary(userId: string, competence: SettlementCompetence) {
    const [persons, debts, receivables] = await Promise.all([
      this.prisma.person.findMany({ where: { userId } }),
      this.prisma.debt.findMany({
        where: { userId, isPaid: false, personId: { not: null } },
      }),
      this.prisma.receivable.findMany({
        where: { userId, isPaid: false, personId: { not: null } },
        include: { transaction: { select: { date: true } } },
      }),
    ]);

    /*
      Um balde por pessoa, preenchido numa passada por lista.

      Os tipos vêm das próprias consultas: as linhas satisfazem
      `SettleableItem` (para decidir a competência) E `PendingItem` (para
      somar o valor). Declarar um dos dois perderia o outro.
    */
    const porPessoa = new Map<
      string,
      {
        debts: (typeof debts)[number][];
        receivables: (typeof receivables)[number][];
      }
    >();

    for (const person of persons) {
      porPessoa.set(person.id, { debts: [], receivables: [] });
    }

    for (const debt of debts) {
      if (!belongsToCompetence(debt, competence)) continue;
      /*
        `personId` não-nulo veio do `where`, mas a FK é `ON DELETE SET NULL`:
        um contato excluído deixa o registro vivo e órfão. Ele não pertence a
        nenhuma linha desta tela.
      */
      porPessoa.get(debt.personId!)?.debts.push(debt);
    }

    for (const receivable of receivables) {
      if (!belongsToCompetence(receivable, competence)) continue;
      porPessoa.get(receivable.personId!)?.receivables.push(receivable);
    }

    return persons.map((person) => {
      const bucket = porPessoa.get(person.id)!;
      const summary = buildPersonSummary(bucket.receivables, bucket.debts);

      return {
        id: person.id,
        name: person.name,
        /*
          Positivo: a pessoa te deve. Negativo: você deve a ela.
          Mesmo sinal de `buildPersonSummary` — a lista não inverte nada.
        */
        netBalance: summary.netBalance,
        receivablePending: summary.receivablePending,
        debtPending: summary.debtPending,
      };
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
      /*
        Uma data para o LOTE inteiro: "acertamos tudo nesta data". Itens
        pagos em datas diferentes se corrigem individualmente depois.
      */
      const paidAt = resolveSettlementDate(dto.paymentDate);

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
      Histórico arquivado por `dueMonth` — a mesma competência canônica dos
      itens abertos, não o mês em que o dinheiro se moveu.

      Antes o recorte era `paidAt` em SQL. Uma dívida de julho paga em 15/09
      aparecia no histórico de setembro, então revisar julho não mostrava o
      acerto de julho, e um mesmo combinado se dispersava por vários meses
      conforme cada parte fosse quitada.

      A troca exige filtrar em MEMÓRIA: para o recebível automático a
      referência é a data da Transaction de origem, que está em outra tabela —
      um `where` sobre a própria linha não alcança. O conjunto é pequeno
      (itens resolvidos de UMA pessoa) e as duas consultas continuam em
      paralelo com as de pendências, sem N+1.

      `paidAt` não sumiu: continua na linha, como data real da resolução.
    */
    const historySelected = this.historyCompetence(filters);
    const historyWhere = {
      userId,
      personId: person.id,
      isPaid: true,
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

            O `status` da fatura entra no MESMO select: é o que permite ao
            drawer não oferecer a exclusão de uma compra que a guarda vai
            recusar. Só as PENDÊNCIAS precisam dele — o histórico já está
            resolvido e não tem essa ação.
          */
          include: {
            transaction: {
              select: { date: true, invoice: { select: { status: true } } },
            },
          },
        }),
        this.prisma.debt.findMany({
          where: historyWhere,
          orderBy: HISTORY_ORDER,
        }),
        this.prisma.receivable.findMany({
          where: historyWhere,
          orderBy: HISTORY_ORDER,
          /*
            A relação é obrigatória aqui pelo mesmo motivo das pendências: sem
            ela `referenceMonthOf` cairia no vencimento e arquivaria todo
            recebível automático no mês errado, em silêncio.
          */
          include: { transaction: { select: { date: true } } },
        }),
      ]);

    const summary = buildPersonSummary(pendingReceivables, pendingDebts);

    /*
      Histórico da competência selecionada.

      Cada item resolvido carrega as duas competências, como as pendências já
      faziam — assim o frontend rotula sem reimplementar a regra. Sem
      competência pedida (nenhum filtro), devolve tudo: o consumidor decide.
    */
    const withCompetences = <T extends SettleableItem>(items: readonly T[]) =>
      items.map((item) => ({
        ...item,
        referenceMonth: referenceMonthOf(item),
        dueMonth: dueMonthOf(item),
      }));

    const inHistory = <T extends SettleableItem>(items: readonly T[]) =>
      withCompetences(
        historySelected
          ? items.filter((item) =>
              belongsToHistoryCompetence(item, historySelected),
            )
          : items,
      );

    const settledDebts = inHistory(historyDebts);
    const settledReceivables = inHistory(historyReceivables);

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
      pending: {
        debts: pendingDebts,
        /*
          A capability acompanha cada cobrança: é a partir desta lista que o
          drawer decide se oferece a exclusão pela compra de origem.
        */
        receivables: pendingReceivables.map((receivable) => ({
          ...receivable,
          sourceDeleteBlockReason: resolveSourceDeleteBlockReason(receivable),
        })),
      },

      /**
       * Universo MENSAL do acerto com a pessoa.
       *
       * O drawer é mensal: responde "quanto temos para acertar nesta
       * competência?". Cada item aberto carrega as duas competências
       * (`referenceMonth` e `dueMonth`) para o frontend montar a lista e o
       * resumo sem reimplementar a regra — e para o settle usar exatamente o
       * mesmo universo que a tela mostra.
       *
       * `defaultCompetence` é simplesmente o mês civil corrente — a rota tem
       * prioridade sobre ele quando informa uma competência válida.
       */
      settlement: {
        defaultCompetence: resolveDefaultCompetence(new Date()),
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
        /**
         * Critério: `dueMonth` — a competência canônica, a MESMA dos abertos.
         *
         * Passou por `paidAt` e depois por `referenceMonth`. O nome do campo é
         * a única defesa do consumidor contra ler o universo errado, então ele
         * muda junto com a regra em vez de permanecer genérico.
         */
        scopedBy: 'dueMonth' as const,
        settledDebts: settledDebts,
        settledReceivables: settledReceivables,
        settledDebtTotal: sumAmounts(settledDebts),
        settledReceivableTotal: sumAmounts(settledReceivables),
      },
    };
  }

  /**
   * A competência que o histórico deve exibir, derivada do filtro recebido.
   *
   * O contrato de `GET /persons/:id/statement` continua sendo um intervalo de
   * datas — mudar para `year`/`month` quebraria o consumidor sem necessidade,
   * já que o drawer sempre envia exatamente um mês civil.
   *
   * `startDate` é a origem: ele marca o primeiro dia da competência pedida.
   * Sem filtro, devolve `null` e o histórico não é recortado.
   */
  private historyCompetence(
    filters: GetStatementDto,
  ): SettlementCompetence | null {
    if (!filters.startDate) return null;

    /*
      Lido direto da STRING, não de um `Date`.

      `parseDateFilterStart('2026-05-01')` devolve meia-noite UTC, e
      `competenceOf` desconta 3h de Fortaleza — o instante cai em 30/04 e a
      competência viraria ABRIL. O filtro é uma data civil; convertê-la em
      instante só para reextrair mês e ano introduz um erro de fuso que não
      existia no dado original.
    */
    const [year, month] = filters.startDate.slice(0, 10).split('-').map(Number);
    return { year, month };
  }
}
