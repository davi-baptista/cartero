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

/**
 * O item em aberto já está VENCIDO hoje?
 *
 * Dia civil de Fortaleza (UTC-3): no PRÓPRIO dia do vencimento o item ainda
 * não está atrasado — há o dia inteiro para resolvê-lo. O servidor roda em
 * UTC, e comparar instantes marcaria como vencido algo que ainda está no
 * prazo durante a noite.
 */
function civilDay(date: Date): string {
  return new Date(date.getTime() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function isOverdueToday(
  dueDate: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  /*
    Sem vencimento não há atraso a afirmar. A coluna é obrigatória no schema,
    mas tratar a ausência como "vencido" pintaria a linha de vermelho por um
    dado faltante — o oposto de informar.
  */
  if (!dueDate) return false;

  return civilDay(dueDate) < civilDay(now);
}

/**
 * Primeiro instante do dia civil de HOJE, para usar como limite no Prisma.
 *
 * `dueDate < overdueBound()` é a tradução exata de `isOverdueToday` para o
 * banco: pega tudo que venceu ANTES de hoje, e deixa de fora o que vence
 * hoje — no próprio dia do vencimento ainda há o dia inteiro para resolver.
 *
 * As duas formas precisam concordar: uma decide o que a consulta traz, a
 * outra decide se o ícone fica vermelho. Definições temporais diferentes para
 * a mesma pergunta é como o carry futuro nasceu.
 */
function overdueBound(now: Date = new Date()): Date {
  return new Date(`${civilDay(now)}T00:00:00.000Z`);
}

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

    /*
      Limite das pendências ANTERIORES em aberto de "Acertos com pessoas".

      O menor entre o início da competência e o começo de hoje. Navegar para
      setembro em 25/08 não pode trazer um item que vence 30/08: ele ainda
      está no prazo, e projetar esse atraso afirmaria um fato que não
      aconteceu. Para meses passados o limite continua sendo `monthStart`.
    */
    const overdueLimit = overdueBound();
    const priorOpenLimit =
      overdueLimit < monthStart ? overdueLimit : monthStart;

    const [
      salary,
      invoices,
      directPayments,
      openDueInMonth,
      monthReceivables,
      currentOpenPrior,
      paidInMonth,
      openReceivablesInMonth,
      openDebtsInMonth,
      openPriorReceivables,
      receivedInMonth,
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
      /*
        Dívidas que VENCEM no mês e continuam ABERTAS.

        `isPaid: false` é a mudança: uma dívida resolvida pertence
        financeiramente ao mês em que o dinheiro saiu (`paidAt`), não ao mês em
        que venceu. Mantê-la aqui faria a mesma obrigação contribuir duas
        vezes — no vencimento e no pagamento — em competências diferentes.

        Enquanto aberta, o vencimento é a melhor referência que existe: é
        planejamento, e ainda não há data de desembolso.
      */
      this.prisma.debt.findMany({
        where: {
          userId,
          isPaid: false,
          dueDate: { gte: monthStart, lt: monthEnd },
        },
        select: PRIOR_DEBT_SELECT,
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

          B. `paidInMonth` — dívida antiga cujo pagamento ACONTECEU nesta
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
        Dívidas PAGAS nesta competência — qualquer vencimento.

        O recorte por `dueDate < monthStart` saiu: uma dívida paga no próprio
        mês do vencimento, ou paga ANTES de vencer, também teve o desembolso
        aqui. A competência financeira de uma dívida resolvida é `paidAt`,
        ponto — sem exceção por onde ela venceu.

        `paidAt: null` (legado pago sem data) não casa com o range e fica de
        fora: sem saber QUANDO o dinheiro saiu, nenhum mês pode reivindicar o
        desembolso, e inventar um seria pior que omitir.
      */
      this.prisma.debt.findMany({
        where: {
          userId,
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
          /* Para derivar `hasOverdue` na mesma passagem, sem consulta extra. */
          dueDate: true,
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
          dueDate: true,
        },
      }),

      /*
        Anteriores ainda em aberto: `dueDate < monthStart` com o estado ATUAL.

        Sem `paidAt` de propósito — se já foi recebido ou pago, não falta
        acertar, independentemente de ter estado aberto numa competência
        passada. É exatamente aqui que nasciam os R$ 300 fantasmas.

        ── Por que também `lt: overdueLimit` ──

        `dueDate < monthStart` sozinho PROJETAVA atraso futuro: em 25/08,
        olhando setembro, um item que vence 30/08 satisfaz `30/08 < 01/09` e
        era trazido como pendência anterior — mas em 25/08 ele ainda está no
        prazo, e afirmar o contrário é inventar um fato.

        O menor dos dois limites resolve: para competência futura vale
        `overdueLimit` (só o que JÁ venceu); para competência passada vale
        `monthStart` (o recorte da própria competência).
      */
      this.prisma.receivable.findMany({
        where: {
          userId,
          personId: { not: null },
          isPaid: false,
          dueDate: { lt: priorOpenLimit },
        },
        select: {
          amount: true,
          personId: true,
          person: { select: { id: true, name: true } },
          transactionId: true,
          /* Para derivar `hasOverdue` na mesma passagem, sem consulta extra. */
          dueDate: true,
        },
      }),
      /*
        Recebíveis de pessoa RECEBIDOS nesta competência.

        Espelha `paidInMonth` do lado da dívida. Sem ele, o netting mensal
        veria só o que continua aberto: uma dívida de 120 paga em agosto
        contra um recebível de 100 recebido em agosto daria 120 de saída
        líquida, quando o mês custou 20.

        `paidAt` na janela, como no lado da dívida — recebimento de outro mês
        não compensa esta competência.
      */
      this.prisma.receivable.findMany({
        where: {
          userId,
          personId: { not: null },
          paidAt: { gte: monthStart, lt: monthEnd },
        },
        select: {
          amount: true,
          personId: true,
          person: { select: { id: true, name: true } },
        },
      }),

      // Simétrico ao recebível: a mesma regra dos dois lados.
      this.prisma.debt.findMany({
        where: {
          userId,
          personId: { not: null },
          isPaid: false,
          dueDate: { lt: priorOpenLimit },
        },
        select: {
          amount: true,
          personId: true,
          person: { select: { id: true, name: true } },
          dueDate: true,
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
    /*
      O detalhamento por linha reúne os três conjuntos — é o que a tela lista
      abaixo do total, e precisa fechar com ele.
    */
    const allDebtRows = [
      ...openDueInMonth,
      ...currentOpenPrior,
      ...paidInMonth,
    ];
    const debtBreakdown = this.buildDebtBreakdown(allDebtRows);

    const sumAmount = (rows: readonly { amount: unknown }[]) =>
      rows.reduce((sum, row) => sum + Number(row.amount), 0);

    /**
     * ══════════════════════════════════════════════════════════════════════
     * A competência financeira de uma dívida
     * ══════════════════════════════════════════════════════════════════════
     *
     * ABERTA  → o vencimento, que é a melhor referência disponível: ainda não
     *           existe data de desembolso, e o orçamento é planejamento.
     *
     * PAGA    → `paidAt`, sempre. É quando o dinheiro saiu do bolso, e essa é
     *           a pergunta que o Orçamento responde.
     *
     * Antes, uma dívida resolvida contribuía nos DOIS meses: no vencimento
     * como obrigação e no pagamento como desembolso. A mesma R$ 300 aparecia
     * em dezembro e em agosto.
     *
     * Os três conjuntos são disjuntos por construção — `isPaid: false` nos
     * dois primeiros, `paidAt` na janela no terceiro —, então nenhuma dívida
     * é contada duas vezes e a transição open → paid não provoca salto.
     */

    /** Vence no mês e continua aberta. */
    const openDueTotal = sumAmount(openDueInMonth);

    /** Venceu antes, continua aberta — só no mês corrente. */
    const currentOpenPriorTotal = sumAmount(currentOpenPrior);

    /** Paga NESTA competência, qualquer que tenha sido o vencimento. */
    const paidInMonthTotal = sumAmount(paidInMonth);

    const dueInMonth = openDueTotal;
    const priorTotal = currentOpenPriorTotal + paidInMonthTotal;

    /*
      Tipo explícito: sem ele o spread das duas listas alarga para `any` e o
      `.map` seguinte perde a checagem de cada campo.
    */
    type PriorRow = (typeof currentOpenPrior)[number];
    const priorBreakdown = [
      ...currentOpenPrior.map((debt: PriorRow) => ({ debt, settled: false })),
      ...paidInMonth.map((debt: PriorRow) => ({ debt, settled: true })),
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
        `openDueInMonth.total`, `priorCarry` e `totalToPay` com o que a tela mostra.
      */
      budgetReceivableDueInMonth: number;
      budgetDebtDueInMonth: number;
      /** Anteriores ainda abertas (só no mês corrente). */
      budgetCurrentOpenPrior: number;
      /** Anteriores pagas nesta competência. */
      budgetPriorPaidInMonth: number;
      /**
       * Recebíveis DESTA pessoa relevantes para a competência.
       *
       * Só compensam dívidas da MESMA pessoa — dinheiro que Eva me deve não
       * paga uma obrigação com Fabrício.
       */
      budgetReceivableAmount: number;
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
      /**
       * Existe algo VENCIDO em aberto nesta relação?
       *
       * Urgência, não direção: um saldo negativo dentro do prazo não é
       * atraso, e um saldo positivo com cobrança vencida é.
       */
      openHasOverdue: boolean;
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
        budgetReceivableAmount: 0,
        budgetAutomaticReceivable: 0,
        openReceivableInMonth: 0,
        openDebtInMonth: 0,
        openPriorReceivable: 0,
        openPriorDebt: 0,
        openItemCount: 0,
        openHasOverdue: false,
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

    for (const debt of openDueInMonth) {
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
    /*
      Recebidos NESTA competência entram no netting mesmo já resolvidos.

      A fotografia mensal precisa deles: um recebível de 100 recebido em
      agosto compensa uma dívida de 120 paga em agosto — o mês custou 20, não
      120. `open` não os vê, porque lá `isPaid: false`.
    */
    for (const receivable of receivedInMonth) {
      if (!receivable.personId) continue;
      settlementEntry(
        receivable.personId,
        receivable.person?.name ?? 'Pessoa',
      ).budgetReceivableAmount += Number(receivable.amount);
    }

    for (const debt of currentOpenPrior) {
      if (!debt.personId) continue;
      settlementEntry(
        debt.personId,
        debt.person?.name ?? 'Pessoa',
      ).budgetCurrentOpenPrior += Number(debt.amount);
    }

    for (const debt of paidInMonth) {
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
      entry.budgetReceivableAmount += amount;
      entry.openItemCount += 1;
      if (isOverdueToday(receivable.dueDate)) entry.openHasOverdue = true;
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
      if (isOverdueToday(debt.dueDate)) entry.openHasOverdue = true;
    }

    for (const receivable of openPriorReceivables) {
      if (!receivable.personId) continue;
      const entry = settlementEntry(
        receivable.personId,
        receivable.person?.name ?? 'Pessoa',
      );
      const amount = Number(receivable.amount);
      entry.openPriorReceivable += amount;
      entry.budgetReceivableAmount += amount;
      entry.openItemCount += 1;
      if (isOverdueToday(receivable.dueDate)) entry.openHasOverdue = true;
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
      if (isOverdueToday(debt.dueDate)) entry.openHasOverdue = true;
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

    /*
      ══════════════════════════════════════════════════════════════════════
      Netting POR PESSOA — supera deliberadamente a regra da Fase 9B
      ══════════════════════════════════════════════════════════════════════

      A Fase 9B proibiu qualquer compensação Debt × Receivable no
      `totalToPay`, e estava certa para o problema daquela época: o cálculo
      compensava e ainda FILTRAVA a pessoa da lista, então a obrigação sumia
      da tela junto com o número.

      A pergunta do Orçamento mensal, porém, é "quanto preciso considerar
      como saída minha nesta competência?". Se Fabrício me deve 10 e eu devo
      11 a ele, a saída é 1 — somar 11 brutos infla o mês com dinheiro que
      volta.

      As três travas que tornam isso seguro:

        · a compensação é por `personId`, nunca entre pessoas diferentes;
        · o resultado é `max(…, 0)` — a pessoa nunca vira crédito no total;
        · nada é escrito: `Debt.amount`, `isPaid` e `paidAt` seguem intactos.
          Isto é projeção de planejamento, não encontro de contas.

      A dívida SEM pessoa não participa: não há com o que compensá-la, e ela
      continua integral no bucket genérico.
    */
    const personDebtTotal = [
      ...openDueInMonth,
      ...currentOpenPrior,
      ...paidInMonth,
    ]
      .filter((debt) => debt.personId)
      .reduce((sum, debt) => sum + Number(debt.amount), 0);

    /* Dívidas genéricas = o total de dívidas menos a parte com pessoa. */
    const genericDebtTotal = dueInMonth + priorTotal - personDebtTotal;

    const peopleBudgetPayableTotal = [...settlementByPerson.values()].reduce(
      (sum, entry) =>
        sum +
        Math.max(
          entry.budgetDebtDueInMonth +
            entry.budgetCurrentOpenPrior +
            entry.budgetPriorPaidInMonth -
            entry.budgetReceivableAmount,
          0,
        ),
      0,
    );

    /*
      O bruto NÃO entra mais em `totalToPay`: somá-lo e depois adicionar o
      líquido das pessoas contaria a dívida com pessoa duas vezes.
    */
    const totalDebts = genericDebtTotal + peopleBudgetPayableTotal;

    // Faturas e dívidas já quitadas continuam somando: o número representa o
    // custo real do mês, não só o que ainda falta desembolsar.
    const totalToPay = netAmount + totalDirectPayments + totalDebts;

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
            fechar com `openDueInMonth.total` e `totalToPay`. Nunca leia daqui a
            resposta de "ainda falta acertar".
          */
          budget: {
            receivableDueInMonth: entry.budgetReceivableDueInMonth,
            openDueInMonth: entry.budgetDebtDueInMonth,
            currentOpenPrior: entry.budgetCurrentOpenPrior,
            paidInMonth: entry.budgetPriorPaidInMonth,
            /** Recebíveis desta pessoa relevantes para a competência. */
            receivableAmount: entry.budgetReceivableAmount,
            /**
             * O que esta pessoa acrescenta ao `totalToPay`.
             *
             * `max(dívidas − recebíveis, 0)`: quem me deve mais do que eu
             * devo contribui com ZERO, nunca com crédito.
             */
            payable: Math.max(
              entry.budgetDebtDueInMonth +
                entry.budgetCurrentOpenPrior +
                entry.budgetPriorPaidInMonth -
                entry.budgetReceivableAmount,
              0,
            ),
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
            /*
              `overdue` no nome, não só `prior`: estes campos trazem APENAS o
              que já está vencido hoje. "Prior" sozinho sugeria qualquer item
              de mês anterior, e foi essa leitura que produziu carry futuro.
            */
            priorOverdueReceivable: entry.openPriorReceivable,
            priorOverdueDebt: entry.openPriorDebt,
            receivableTotal: openReceivableTotal,
            debtTotal: openDebtTotal,
            net: openReceivableTotal - openDebtTotal,
            /** `priorReceivable - priorDebt`. Zero = nada trazido. */
            priorOverdueNet: entry.openPriorReceivable - entry.openPriorDebt,
            itemCount: entry.openItemCount,
            /** Urgência: existe item vencido, de qualquer lado. */
            hasOverdue: entry.openHasOverdue,
            automaticReceivable: entry.openAutomaticReceivable,
          },
        };
      });

    const paidInvoices = invoices
      .filter((inv) => inv.status === 'PAID')
      .reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
    /*
      A parcela JÁ PAGA do mês vem de `paidInMonth`.

      Antes saía de `openDueInMonth` filtrando `isPaid`, mas aquele conjunto
      agora só traz dívidas abertas — o filtro devolveria sempre zero, e a
      linha "R$ X pago" nunca sairia do lugar.

      Valor íntegro: sem compensação, o pago não pode superar o total.
    */
    const paidDebts = paidInMonthTotal;
    const paidDebtsCount = paidInMonth.length;

    /*
      Pagamentos diretos já aconteceram por definição — a transação só existe
      porque o dinheiro saiu.

      O `min` com `totalToPay` é necessário desde o netting: `paidDebts` é
      BRUTO, e o total passou a ser líquido. Uma dívida de 100 paga com 40 a
      receber da mesma pessoa daria "R$ 100 pago" de um total de R$ 60 — a
      linha diria que se pagou mais do que havia a pagar.

      O teto é o próprio total: acima dele o número deixaria de descrever
      esta competência.
    */
    const totalPaid = Math.min(
      paidInvoices + paidDebts + totalDirectPayments,
      totalToPay,
    );

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
        /** Vence no mês e continua ABERTA. */
        openDueInMonth: openDueTotal,
        /** Anteriores ainda abertas — zero fora do mês corrente. */
        currentOpenPrior: currentOpenPriorTotal,
        /** PAGAS nesta competência, qualquer vencimento. */
        paidInMonth: paidInMonthTotal,
        total: totalDebts,
        priorItems: priorBreakdown,
      },
      /**
       * De onde vem o `totalToPay` — a composição exibida sob o número.
       *
       * Montado aqui para o frontend não somar dinheiro no JSX: os quatro
       * componentes fecham exatamente com o total, por construção.
       */
      breakdown: {
        invoices: netAmount,
        directPayments: totalDirectPayments,
        /** Só dívidas SEM pessoa — as com pessoa vão em `peopleSettlements`. */
        debts: genericDebtTotal,
        peopleSettlements: peopleBudgetPayableTotal,
      },
      totalDebts,
      debtsCount: openDueInMonth.length,
      priorCount: currentOpenPrior.length + paidInMonth.length,
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
    const [invoices, openDebts] = await Promise.all([
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
      ...openDebts.map((debt) => ({
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
