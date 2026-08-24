import { Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { SalaryService } from 'src/salary/salary.service';

/**
 * Formas de pagamento que saem do bolso na própria data da transação —
 * ao contrário do crédito, que só sai no vencimento da fatura.
 */
const DIRECT_PAYMENT_TYPES: TransactionType[] = [
  TransactionType.DEBIT_CARD,
  TransactionType.PIX,
  TransactionType.BOLETO,
];

/** Campos que as consultas de pendência anterior precisam. */
const PRIOR_DEBT_SELECT = {
  amount: true,
  isPaid: true,
  paidAt: true,
  title: true,
  dueDate: true,
  personId: true,
  person: { select: { id: true, name: true } },
} as const;

/**
 * A competência pedida é o mês civil CORRENTE?
 *
 * Decide se pendências anteriores ainda abertas entram. O fuso é explícito
 * porque o servidor roda em UTC: em 31/08 às 22h de Fortaleza já é 01/09 em
 * UTC, e `getUTCMonth()` diria setembro — o carry sumiria da tela um dia antes
 * da hora.
 */
function isCurrentCompetence(
  year: number,
  month: number,
  now: Date = new Date(),
): boolean {
  const fortaleza = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return (
    fortaleza.getUTCFullYear() === year && fortaleza.getUTCMonth() + 1 === month
  );
}

/** Dívida não tem status próprio: sai de `isPaid` + `dueDate`. */
type DebtStatus = 'PAID' | 'OVERDUE' | 'PENDING';

@Injectable()
export class BudgetService {
  constructor(
    private prisma: PrismaService,
    private salaryService: SalaryService,
  ) {}

  async getBudget(userId: string, month: number, year: number) {
    // O mês/ano da fatura já representa o mês de vencimento, então o recorte
    // por competência de pagamento é o próprio período da invoice. Para os
    // demais lançamentos, o recorte é a data em que o dinheiro saiu.
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));

    /*
      Pendência anterior aberta acompanha o PRESENTE, não cada snapshot.
      Fora do mês corrente a consulta nem é feita.
    */
    const isCurrentMonth = isCurrentCompetence(year, month);

    const [
      salary,
      invoices,
      directPayments,
      debts,
      monthReceivables,
      currentOpenPrior,
      priorPaidInMonth,
      openReceivablesInMonth,
      openDebtsInMonth,
      openPriorReceivables,
      openPriorDebts,
    ] = await Promise.all([
      /*
          A renda vem do histórico, não de `User.salary`.

          `User.salary` é o valor de HOJE: usá-lo para um mês passado fazia a
          sobra e o percentual comprometido de janeiro mudarem quando o usuário
          registrava um aumento em agosto.
        */
      this.salaryService.resolve(userId, { year, month }),
      this.prisma.invoice.findMany({
        where: { userId, month, year },
        include: { bank: true },
      }),
      this.prisma.transaction.findMany({
        where: {
          userId,
          type: { in: DIRECT_PAYMENT_TYPES },
          isRefund: false,
          date: { gte: monthStart, lt: monthEnd },
          // Transação-espelho de "Dívida paga" já é contada via totalDebts —
          // incluí-la aqui também duplicaria o valor no total do mês.
          paymentDebt: null,
        },
        select: { amount: true },
      }),
      this.prisma.debt.findMany({
        where: {
          userId,
          dueDate: { gte: monthStart, lt: monthEnd },
        },
        select: {
          amount: true,
          isPaid: true,
          title: true,
          dueDate: true,
          personId: true,
          person: { select: { id: true, name: true } },
        },
      }),
      /*
          Recebíveis são INFORMATIVOS — não reduzem obrigação nenhuma.

          Antes eles compensavam as dívidas da mesma pessoa
          (`debt - min(receivable, debt)`), o que reduzia artificialmente o
          valor a pagar: com R$ 500 dos dois lados o orçamento mostrava R$ 0
          de dívida, como se o Cartero tivesse feito um encontro de contas.
          Ele não faz: quitar liquida cada item pelo próprio valor.

          Sem filtro `personId`: um recebível sem pessoa vinculada também é
          dinheiro que o usuário espera receber no mês.
        */
      this.prisma.receivable.findMany({
        where: {
          userId,
          isPaid: false,
          dueDate: { gte: monthStart, lt: monthEnd },
        },
        select: {
          amount: true,
          personId: true,
          person: { select: { id: true, name: true } },
          /*
            `transactionId` distingue o recebível AUTOMÁTICO (nascido de uma
            compra no cartão) do manual. Serve só para a microcopy
            "X vêm de compras no seu cartão" — o valor entra na consolidação
            do mesmo jeito nos dois casos.
          */
          transactionId: true,
        },
      }),

      /*
        ══════════════════════════════════════════════════════════════════
        Pendências anteriores — DOIS eventos, não um snapshot mensal
        ══════════════════════════════════════════════════════════════════

        A regra anterior perguntava "isto ainda estava aberto quando o mês
        começou?" e repetia a MESMA obrigação em toda competência entre o
        vencimento e o pagamento. Uma dívida de 08/12 paga em 24/08 aparecia
        em dezembro, janeiro, fevereiro… até agosto: defensável como
        fotografia histórica, mas na tela parecia estar sendo cobrada de novo
        a cada mês.

        Agora o orçamento reconhece dois EVENTOS distintos:

          A. `currentOpenPrior` — dívida antiga ainda aberta, exibida SÓ no
             mês civil corrente. É obrigação real que precisa ser resolvida
             agora, e por isso acompanha o presente, não cada snapshot
             passado.

          B. `priorPaidInMonth` — dívida antiga cujo pagamento ACONTECEU nesta
             competência. É desembolso real do mês, e some dos meses
             intermediários onde nada aconteceu.

        A consulta (A) é condicional: fora do mês corrente ela não seria usada,
        e buscá-la seria uma ida ao banco desperdiçada.
      */
      isCurrentMonth
        ? this.prisma.debt.findMany({
            where: {
              userId,
              isPaid: false,
              dueDate: { lt: monthStart },
            },
            select: PRIOR_DEBT_SELECT,
          })
        : Promise.resolve([]),

      /*
        Dívidas anteriores PAGAS nesta competência.

        Filtro no banco pelas três condições — venceu antes, foi paga dentro
        da janela do mês. Carregar histórico para decidir em memória traria
        anos de dívidas resolvidas a cada consulta.

        `paidAt: null` (legado pago sem data) não casa com o range e fica de
        fora: sem saber QUANDO foi pago, nenhum mês pode reivindicar o
        desembolso — e inventar um seria pior que omitir.
      */
      this.prisma.debt.findMany({
        where: {
          userId,
          dueDate: { lt: monthStart },
          paidAt: { gte: monthStart, lt: monthEnd },
        },
        select: PRIOR_DEBT_SELECT,
      }),

      /*
        ══════════════════════════════════════════════════════════════════
        Camada EM ABERTO — universo separado do histórico acima
        ══════════════════════════════════════════════════════════════════

        As consultas anteriores respondem "o que pertenceu ao orçamento desta
        competência?" e por isso usam `paidAt`: reconstruir agosto com o estado
        de hoje diria que uma dívida paga em setembro já estava resolvida em
        agosto. Essa pergunta continua valendo e nada nela muda.

        As quatro a seguir respondem outra coisa: "quanto ainda falta acertar
        AGORA?". A única condição possível é o estado atual, `isPaid: false`.

        Misturar as duas produzia os dois bugs relatados:

          · um recebível de R$ 300 já RECEBIDO aparecia como "R$ 300 a receber
            de períodos anteriores", porque `paidAt >= monthStart` casa com
            quem foi recebido durante o mês E depois dele, e o legado
            `paidAt: null` casa com `isPaid: true` sem data — três portas de
            entrada, nenhuma olhando `isPaid`;

          · uma dívida de R$ 200 já paga seguia exibida como "A pagar R$ 200",
            porque a consulta do mês não filtra `isPaid` — correto para
            `totalToPay`, errado como pendência.

        Quatro `findMany` no MESMO `Promise.all`, filtrando no banco. Nenhuma
        consulta por pessoa: a agregação é em memória sobre os arrays.
      */
      this.prisma.receivable.findMany({
        where: {
          userId,
          personId: { not: null },
          isPaid: false,
          dueDate: { gte: monthStart, lt: monthEnd },
        },
        select: {
          amount: true,
          personId: true,
          person: { select: { id: true, name: true } },
          transactionId: true,
        },
      }),
      this.prisma.debt.findMany({
        where: {
          userId,
          personId: { not: null },
          isPaid: false,
          dueDate: { gte: monthStart, lt: monthEnd },
        },
        select: {
          amount: true,
          personId: true,
          person: { select: { id: true, name: true } },
        },
      }),

      /*
        Anteriores ainda em aberto: `dueDate < monthStart` com o estado ATUAL.

        Sem `paidAt` de propósito — se já foi recebido ou pago, não falta
        acertar, independentemente de ter estado aberto numa competência
        passada. É exatamente aqui que nasciam os R$ 300 fantasmas.
      */
      this.prisma.receivable.findMany({
        where: {
          userId,
          personId: { not: null },
          isPaid: false,
          dueDate: { lt: monthStart },
        },
        select: {
          amount: true,
          personId: true,
          person: { select: { id: true, name: true } },
          transactionId: true,
        },
      }),
      this.prisma.debt.findMany({
        where: {
          userId,
          personId: { not: null },
          isPaid: false,
          dueDate: { lt: monthStart },
        },
        select: {
          amount: true,
          personId: true,
          person: { select: { id: true, name: true } },
        },
      }),
    ]);

    const totalInvoices = invoices.reduce(
      (sum, inv) => sum + Number(inv.totalAmount),
      0,
    );

    const invoiceIds = invoices.map((inv) => inv.id);

    // Agrupado por fatura em vez de um total único: a mesma soma, com o
    // detalhe que a tela precisa para dizer, linha a linha, quanto de cada
    // fatura é do usuário. Sem isso o frontend teria de buscar as transações
    // de cada fatura separadamente (N+1) para exibir a mesma informação.
    const reimbursableByInvoice =
      invoiceIds.length > 0
        ? await this.prisma.transaction.groupBy({
            by: ['invoiceId'],
            where: {
              userId,
              invoiceId: { in: invoiceIds },
              personId: { not: null },
              type: 'CREDIT_CARD',
            },
            _sum: { amount: true },
          })
        : [];

    const reimbursablePerInvoice = new Map<string, number>();
    for (const row of reimbursableByInvoice) {
      if (!row.invoiceId) continue;
      reimbursablePerInvoice.set(row.invoiceId, Number(row._sum.amount ?? 0));
    }

    const totalReimbursable = [...reimbursablePerInvoice.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    const netAmount = totalInvoices - totalReimbursable;

    // `totalAmount` continua bruto — é o que o banco cobra. `reimbursable` e
    // `ownAmount` são leituras derivadas, não substituem a obrigação.
    const invoicesWithBreakdown = invoices.map((invoice) => {
      const reimbursable = reimbursablePerInvoice.get(invoice.id) ?? 0;
      return {
        ...invoice,
        reimbursable,
        ownAmount: Number(invoice.totalAmount) - reimbursable,
      };
    });

    const totalDirectPayments = directPayments.reduce(
      (sum, tx) => sum + Number(tx.amount),
      0,
    );
    const debtBreakdown = this.buildDebtBreakdown(debts);

    /** Dívidas com vencimento DENTRO do mês. */
    const dueInMonth = debts.reduce(
      (sum, debt) => sum + Number(debt.amount),
      0,
    );

    const sumAmount = (rows: readonly { amount: unknown }[]) =>
      rows.reduce((sum, row) => sum + Number(row.amount), 0);

    /**
     * Pendências anteriores AINDA ABERTAS — só no mês corrente.
     *
     * Obrigação real que precisa ser resolvida agora. Nos meses históricos a
     * consulta nem roda: reconstruir "isto também estava aberto naquele
     * momento" era o que repetia a mesma dívida em toda competência.
     */
    const currentOpenPriorTotal = sumAmount(currentOpenPrior);

    /**
     * Pendências anteriores PAGAS nesta competência.
     *
     * O desembolso aconteceu aqui, então o mês o reconhece — mesmo que a
     * obrigação tenha nascido meses antes.
     */
    const priorPaidInMonthTotal = sumAmount(priorPaidInMonth);

    /*
      Os dois conjuntos são disjuntos por construção: `currentOpenPrior` exige
      `isPaid: false` e `priorPaidInMonth` exige `paidAt` dentro do mês. A
      mesma dívida nunca entra nos dois — é o que impede o total de dobrar no
      instante em que ela é quitada.
    */
    const priorTotal = currentOpenPriorTotal + priorPaidInMonthTotal;

    /*
      Tipo explícito: sem ele o spread das duas listas alarga para `any` e o
      `.map` seguinte perde a checagem de cada campo.
    */
    type PriorRow = (typeof currentOpenPrior)[number];
    const priorBreakdown = [
      ...currentOpenPrior.map((debt: PriorRow) => ({ debt, settled: false })),
      ...priorPaidInMonth.map((debt: PriorRow) => ({ debt, settled: true })),
    ].map(({ debt, settled }: { debt: PriorRow; settled: boolean }) => ({
      title: debt.title,
      amount: Number(debt.amount),
      /** Vencimento ORIGINAL — não reescrito como se fosse deste mês. */
      dueDate: debt.dueDate,
      personId: debt.personId,
      personName: debt.person?.name ?? null,
      /** `true` quando o pagamento aconteceu NESTA competência. */
      paidInMonth: settled,
    }));

    /*
      Total de dívidas = do mês + os dois eventos de pendência anterior.

      Nenhum recebível entra como redução.
    */
    const totalDebts = dueInMonth + priorTotal;

    // Faturas e dívidas já quitadas continuam somando: o número representa o
    // custo real do mês, não só o que ainda falta desembolsar.
    const totalToPay = netAmount + totalDirectPayments + totalDebts;

    /*
      A Receber do mês — informativo puro.

      Fica FORA de `totalToPay` por definição: recebível é dinheiro esperado,
      não pagamento já feito de uma dívida.
    */
    const totalReceivableInMonth = monthReceivables.reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );

    /*
      ── Acertos com pessoas ──

      Camada INFORMATIVA: consolida, por pessoa, o que ela deve e o que se deve
      a ela DENTRO desta competência. Não altera `totalToPay`, `remaining` nem
      `committedPct` — nenhuma compensação financeira acontece aqui.

      A fonte é exclusivamente Debt e Receivable com `personId`. A parcela de
      terceiros da FATURA fica de fora de propósito: uma compra de R$ 240 para a
      Mariana já gerou um Receivable de R$ 240, e somar os dois cobraria a mesma
      coisa duas vezes (R$ 480 onde só existem R$ 240). A fatura usa aquele
      valor apenas para separar bruto de sua parte.
    */
    interface SettlementAccumulator {
      personId: string;
      personName: string;
      /*
        ── Universo A: contexto do ORÇAMENTO ──

        Temporal, reconstruído por `paidAt`. Inclui item já quitado, porque ele
        continuou sendo obrigação daquela competência. Serve para reconciliar
        `debts.total`, `priorCarry` e `totalToPay` com o que a tela mostra.
      */
      budgetReceivableDueInMonth: number;
      budgetDebtDueInMonth: number;
      /** Anteriores ainda abertas (só no mês corrente). */
      budgetCurrentOpenPrior: number;
      /** Anteriores pagas nesta competência. */
      budgetPriorPaidInMonth: number;
      /** Parcela do "a receber" do orçamento que veio de compra no cartão. */
      budgetAutomaticReceivable: number;
      /*
        ── Universo B: EM ABERTO agora ──

        Estado atual, `isPaid: false`. Responde "quanto ainda falta acertar?".
        Some quando o item é quitado — é a informação operacional.
      */
      openReceivableInMonth: number;
      openDebtInMonth: number;
      openPriorReceivable: number;
      openPriorDebt: number;
      openItemCount: number;
      /** Parcela do que está EM ABERTO originada de compra no cartão. */
      openAutomaticReceivable: number;
    }

    const settlementByPerson = new Map<string, SettlementAccumulator>();

    function settlementEntry(
      personId: string,
      personName: string,
    ): SettlementAccumulator {
      const existing = settlementByPerson.get(personId);
      if (existing) return existing;
      const fresh: SettlementAccumulator = {
        personId,
        personName,
        budgetReceivableDueInMonth: 0,
        budgetDebtDueInMonth: 0,
        budgetCurrentOpenPrior: 0,
        budgetPriorPaidInMonth: 0,
        budgetAutomaticReceivable: 0,
        openReceivableInMonth: 0,
        openDebtInMonth: 0,
        openPriorReceivable: 0,
        openPriorDebt: 0,
        openItemCount: 0,
        openAutomaticReceivable: 0,
      };
      settlementByPerson.set(personId, fresh);
      return fresh;
    }

    /* ── Universo A: contexto do orçamento (temporal, por `paidAt`) ── */

    for (const receivable of monthReceivables) {
      if (!receivable.personId) continue;
      const entry = settlementEntry(
        receivable.personId,
        receivable.person?.name ?? 'Pessoa',
      );
      const amount = Number(receivable.amount);
      entry.budgetReceivableDueInMonth += amount;
      // Automático = nasceu de uma Transaction, nunca derivado da Invoice.
      if (receivable.transactionId) entry.budgetAutomaticReceivable += amount;
    }

    for (const debt of debts) {
      if (!debt.personId) continue;
      settlementEntry(
        debt.personId,
        debt.person?.name ?? 'Pessoa',
      ).budgetDebtDueInMonth += Number(debt.amount);
    }

    /*
      Pendência anterior da pessoa, separada por evento — a microcopy precisa
      distinguir "ainda em aberto" de "paga neste mês". Somar as duas num
      campo só faria a linha dizer "R$ 300 já quitados" para uma dívida que
      continua devendo.
    */
    for (const debt of currentOpenPrior) {
      if (!debt.personId) continue;
      settlementEntry(
        debt.personId,
        debt.person?.name ?? 'Pessoa',
      ).budgetCurrentOpenPrior += Number(debt.amount);
    }

    for (const debt of priorPaidInMonth) {
      if (!debt.personId) continue;
      settlementEntry(
        debt.personId,
        debt.person?.name ?? 'Pessoa',
      ).budgetPriorPaidInMonth += Number(debt.amount);
    }

    /*
      Não existe carry HISTÓRICO do lado do recebível.

      Existia: uma consulta por `paidAt`, espelhando a das dívidas. Era ela que
      produzia os R$ 300 fantasmas — um recebível já recebido aparecia como
      "a receber de períodos anteriores", porque `paidAt >= monthStart` casa
      com quem foi recebido durante o mês e depois dele, e `paidAt: null` casa
      com o legado pago sem data.

      Foi removida em vez de mantida sem consumidor: recebível não compõe
      `totalToPay`, então não há reconstrução histórica que dependa dela. O
      lado da DÍVIDA mantém a sua (`priorDebts`), porque ali o carry realmente
      alimenta `priorCarry` e o total do mês.

      O carry anterior do recebível vem agora só de `openPriorReceivables`,
      que olha `isPaid`.
    */

    /* ── Universo B: em aberto agora (estado atual, `isPaid: false`) ── */

    for (const receivable of openReceivablesInMonth) {
      if (!receivable.personId) continue;
      const entry = settlementEntry(
        receivable.personId,
        receivable.person?.name ?? 'Pessoa',
      );
      const amount = Number(receivable.amount);
      entry.openReceivableInMonth += amount;
      entry.openItemCount += 1;
      if (receivable.transactionId) entry.openAutomaticReceivable += amount;
    }

    for (const debt of openDebtsInMonth) {
      if (!debt.personId) continue;
      const entry = settlementEntry(
        debt.personId,
        debt.person?.name ?? 'Pessoa',
      );
      entry.openDebtInMonth += Number(debt.amount);
      entry.openItemCount += 1;
    }

    for (const receivable of openPriorReceivables) {
      if (!receivable.personId) continue;
      const entry = settlementEntry(
        receivable.personId,
        receivable.person?.name ?? 'Pessoa',
      );
      const amount = Number(receivable.amount);
      entry.openPriorReceivable += amount;
      entry.openItemCount += 1;
      if (receivable.transactionId) entry.openAutomaticReceivable += amount;
    }

    for (const debt of openPriorDebts) {
      if (!debt.personId) continue;
      const entry = settlementEntry(
        debt.personId,
        debt.person?.name ?? 'Pessoa',
      );
      entry.openPriorDebt += Number(debt.amount);
      entry.openItemCount += 1;
    }

    /*
      Volume de MOVIMENTAÇÃO — a base da ordenação, somando os dois universos.

      Ordenar pelo saldo líquido jogaria para o fim uma relação com R$ 500 de
      cada lado: saldo zero, e das mais relevantes da tela.
    */
    const movement = (entry: SettlementAccumulator) =>
      entry.budgetReceivableDueInMonth +
      entry.budgetDebtDueInMonth +
      entry.budgetCurrentOpenPrior +
      entry.budgetPriorPaidInMonth +
      entry.openReceivableInMonth +
      entry.openDebtInMonth +
      entry.openPriorReceivable +
      entry.openPriorDebt;

    const peopleSettlements = [...settlementByPerson.values()]
      /*
        Item 13: sem nada em aberto E sem obrigação no orçamento, a pessoa não
        é renderizada. Item 10: com uma dívida que ainda compõe `totalToPay`,
        ela permanece — senão o total do orçamento deixa de fechar com as
        linhas visíveis.
      */
      .filter((entry) => movement(entry) > 0)
      // Ordena ANTES do map: `movement` lê o acumulador, não a saída.
      .sort((a, b) => movement(b) - movement(a))
      .map((entry) => {
        const openReceivableTotal =
          entry.openReceivableInMonth + entry.openPriorReceivable;
        const openDebtTotal = entry.openDebtInMonth + entry.openPriorDebt;

        return {
          personId: entry.personId,
          personName: entry.personName,

          /*
            ── budget: contexto da COMPETÊNCIA ──

            Reconstrução temporal por `paidAt`. Inclui item já quitado, porque
            ele continuou sendo obrigação daquele mês — é o que permite a tela
            fechar com `debts.total` e `totalToPay`. Nunca leia daqui a
            resposta de "ainda falta acertar".
          */
          budget: {
            receivableDueInMonth: entry.budgetReceivableDueInMonth,
            debtDueInMonth: entry.budgetDebtDueInMonth,
            currentOpenPrior: entry.budgetCurrentOpenPrior,
            priorPaidInMonth: entry.budgetPriorPaidInMonth,
            /** `debtDueInMonth + priorDebtCarry` — o que compõe o orçamento. */
            debtTotal:
              entry.budgetDebtDueInMonth +
              entry.budgetCurrentOpenPrior +
              entry.budgetPriorPaidInMonth,
            automaticReceivable: entry.budgetAutomaticReceivable,
          },

          /*
            ── open: EM ABERTO agora ──

            Estado atual (`isPaid: false`), não reconstrução histórica. Zera no
            instante em que o item é quitado.

            `net` é INFORMATIVO: quitar liquida cada item pelo próprio valor, e
            nada aqui toca `totalToPay`, `remaining` ou `committedPct`.

            `itemCount` existe porque saldo zero não é quitação: R$ 200 de cada
            lado dá `net: 0` com dois itens abertos.
          */
          open: {
            receivableInMonth: entry.openReceivableInMonth,
            debtInMonth: entry.openDebtInMonth,
            priorReceivable: entry.openPriorReceivable,
            priorDebt: entry.openPriorDebt,
            receivableTotal: openReceivableTotal,
            debtTotal: openDebtTotal,
            net: openReceivableTotal - openDebtTotal,
            /** `priorReceivable - priorDebt`. Zero = nada trazido. */
            priorNet: entry.openPriorReceivable - entry.openPriorDebt,
            itemCount: entry.openItemCount,
            automaticReceivable: entry.openAutomaticReceivable,
          },
        };
      });

    const paidInvoices = invoices
      .filter((inv) => inv.status === 'PAID')
      .reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
    // Valor íntegro: sem compensação, o pago não pode mais superar o total.
    const paidDebts = debts
      .filter((debt) => debt.isPaid)
      .reduce((sum, debt) => sum + Number(debt.amount), 0);
    const paidDebtsCount = debts.filter((debt) => debt.isPaid).length;

    // Pagamentos diretos já aconteceram por definição — a transação só existe
    // porque o dinheiro saiu.
    const totalPaid = paidInvoices + paidDebts + totalDirectPayments;

    /*
      Sobra e percentual só existem se a renda for CONHECIDA.

      Com renda desconhecida (mês anterior à primeira entrada do histórico),
      calcular `0 - totalToPay` afirmaria uma capacidade financeira que
      ninguém informou. `null` deixa a tela dizer "não registrada".
    */
    const remaining = salary.known ? salary.amount - totalToPay : null;

    /*
      Percentual comprometido exige denominador válido.

      Renda conhecida e igual a zero é legítima (alguém entre empregos), mas
      não tem percentual: dividir por zero daria Infinity, e devolver 0% ou
      100% seria uma aproximação inventada.
    */
    const committedPct =
      salary.known && salary.amount > 0
        ? (totalToPay / salary.amount) * 100
        : null;

    return {
      month,
      year,

      /** Renda do PERÍODO consultado, resolvida pelo histórico. */
      salary: salary.known ? salary.amount : null,
      /** `false` quando não há entrada aplicável — diferente de renda zero. */
      salaryKnown: salary.known,
      /** Competência da entrada que forneceu o valor. */
      salaryEffectiveFrom: salary.effectiveFrom,
      /** `null` quando a renda é desconhecida. */
      remaining,
      /** `null` quando desconhecida OU igual a zero. */
      committedPct,

      totalInvoices,
      totalReimbursable,
      netAmount,
      totalDirectPayments,

      /*
        Composição explícita das dívidas.

        `totalDebts` sozinho não dizia de onde vinha o número — e antes vinha
        de um valor já compensado por recebíveis.
      */
      /*
        `priorCarry` foi REMOVIDO: o nome descrevia o snapshot mensal que
        deixou de existir, e mantê-lo apontando para outro conceito faria
        qualquer consumidor calcular errado sem aviso.
      */
      debts: {
        dueInMonth,
        /** Anteriores ainda abertas — zero fora do mês corrente. */
        currentOpenPrior: currentOpenPriorTotal,
        /** Anteriores cujo pagamento aconteceu nesta competência. */
        priorPaidInMonth: priorPaidInMonthTotal,
        total: totalDebts,
        priorItems: priorBreakdown,
      },
      totalDebts,
      debtsCount: debts.length,
      priorCount: currentOpenPrior.length + priorPaidInMonth.length,
      paidDebtsCount,

      /** Informativo: NÃO entra em `totalToPay`. */
      receivables: {
        dueInMonth: totalReceivableInMonth,
        count: monthReceivables.length,
      },

      /**
       * Consolidação por pessoa — camada de APRESENTAÇÃO.
       *
       * Existe para o usuário não precisar calcular mentalmente
       * "480 a receber − 250 a pagar". Nenhum destes valores alimenta
       * `totalToPay`, `remaining` ou `committedPct`.
       */
      peopleSettlements,

      totalToPay,
      totalPaid,
      totalPending: totalToPay - totalPaid,
      invoices: invoicesWithBreakdown,
      debtBreakdown,
    };
  }

  /**
   * Dívidas do mês, linha a linha: uma entrada por pessoa (com o saldo já
   * compensado pelo que ela te deve) e uma por dívida sem pessoa vinculada.
   *
   * Quem te deve mais do que você deve sai da lista — saldo a favor não é
   * gasto, e mostrá-lo como valor negativo reduziria o total do mês por algo
   * que ainda nem entrou.
   */
  /**
   * Dívidas do mês, linha a linha: uma entrada por pessoa e uma por dívida sem
   * pessoa vinculada.
   *
   * NÃO existe mais compensação. A versão anterior calculava
   * `gross - min(receivable, gross)` e ainda filtrava `amount > 0`, então uma
   * pessoa com R$ 500 de dívida e R$ 500 a receber DESAPARECIA da lista — a
   * obrigação sumia da tela e do total, como se tivesse sido paga.
   *
   * Recebível é dinheiro esperado, não pagamento realizado. Quitar liquida
   * cada item pelo próprio valor, e o orçamento precisa dizer a mesma coisa.
   */
  private buildDebtBreakdown(
    debts: Array<{
      amount: unknown;
      isPaid: boolean;
      title: string;
      dueDate: Date;
      personId: string | null;
      person: { id: string; name: string } | null;
    }>,
    now: Date = new Date(),
  ) {
    // Comparação por dia: uma dívida que vence hoje ainda não está vencida.
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const byPerson = new Map<
      string,
      {
        name: string;
        amount: number;
        count: number;
        allPaid: boolean;
        anyOverdue: boolean;
      }
    >();
    const standalone: Array<{
      kind: 'debt';
      id: string | null;
      name: string;
      amount: number;
      isPaid: boolean;
      status: DebtStatus;
    }> = [];

    const statusOf = (debt: { isPaid: boolean; dueDate: Date }): DebtStatus =>
      debt.isPaid ? 'PAID' : debt.dueDate < today ? 'OVERDUE' : 'PENDING';

    for (const debt of debts) {
      if (debt.personId && debt.person) {
        const entry = byPerson.get(debt.personId) ?? {
          name: debt.person.name,
          amount: 0,
          count: 0,
          allPaid: true,
          anyOverdue: false,
        };
        entry.amount += Number(debt.amount);
        entry.count += 1;
        if (!debt.isPaid) entry.allPaid = false;
        if (statusOf(debt) === 'OVERDUE') entry.anyOverdue = true;
        byPerson.set(debt.personId, entry);
      } else {
        standalone.push({
          kind: 'debt',
          id: null,
          name: debt.title,
          amount: Number(debt.amount),
          isPaid: debt.isPaid,
          status: statusOf(debt),
        });
      }
    }

    const people = [...byPerson.entries()].map(([personId, entry]) => ({
      kind: 'person' as const,
      id: personId,
      name: entry.name,
      /** Valor ÍNTEGRO da dívida. Nunca reduzido por recebíveis. */
      amount: entry.amount,
      isPaid: entry.allPaid,
      // Atraso domina: uma pessoa com várias dívidas, uma delas vencida,
      // precisa aparecer como vencida mesmo que as outras estejam em dia.
      status: (entry.allPaid
        ? 'PAID'
        : entry.anyOverdue
          ? 'OVERDUE'
          : 'PENDING') as DebtStatus,
    }));

    // Urgência primeiro — vencida, a pagar, paga — e valor como desempate.
    // Quem já foi resolvido não precisa disputar o topo da lista.
    const urgency: Record<DebtStatus, number> = {
      OVERDUE: 0,
      PENDING: 1,
      PAID: 2,
    };

    return [...people, ...standalone].sort(
      (a, b) => urgency[a.status] - urgency[b.status] || b.amount - a.amount,
    );
  }

  /**
   * Mês que o orçamento deve abrir: o mais antigo que ainda tem algo a pagar.
   *
   * Procura 12 meses para trás — uma fatura esquecida há mais de um ano
   * raramente é algo a resolver hoje — e, quando nada está pendente no
   * passado, segue para frente até achar o próximo mês com pendência. Se
   * estiver tudo quitado, devolve o mês corrente.
   */
  async getFocusPeriod(userId: string, now: Date = new Date()) {
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;

    const windowStart = new Date(Date.UTC(currentYear, currentMonth - 13, 1));
    const windowEnd = new Date(Date.UTC(currentYear + 1, currentMonth, 1));

    // Só o que ainda exige desembolso: faturas não pagas e dívidas em aberto.
    // Pagamentos diretos já aconteceram por definição, então não contam.
    const [invoices, debts] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          userId,
          status: { not: 'PAID' },
          totalAmount: { gt: 0 },
          OR: [
            { year: { gt: windowStart.getUTCFullYear() } },
            {
              year: windowStart.getUTCFullYear(),
              month: { gte: windowStart.getUTCMonth() + 1 },
            },
          ],
        },
        select: { month: true, year: true },
      }),
      this.prisma.debt.findMany({
        where: {
          userId,
          isPaid: false,
          dueDate: { gte: windowStart, lt: windowEnd },
        },
        select: { dueDate: true },
      }),
    ]);

    const periods = [
      ...invoices.map((invoice) => ({
        year: invoice.year,
        month: invoice.month,
      })),
      ...debts.map((debt) => ({
        year: debt.dueDate.getUTCFullYear(),
        month: debt.dueDate.getUTCMonth() + 1,
      })),
    ];

    if (periods.length === 0) {
      return { month: currentMonth, year: currentYear };
    }

    // O mais antigo pendente: atraso tem prioridade sobre o que vem à frente.
    return periods.reduce((oldest, period) =>
      period.year !== oldest.year
        ? period.year < oldest.year
          ? period
          : oldest
        : period.month < oldest.month
          ? period
          : oldest,
    );
  }
}
