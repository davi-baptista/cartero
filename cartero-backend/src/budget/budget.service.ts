import { Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { SalaryService } from 'src/salary/salary.service';
import { civilDay } from 'src/common/helpers/date-only.helper';
import { resolveContribution } from 'src/common/helpers/budget-contribution.helper';
import {
  classifyDebtForBudget,
  type BudgetPeriod,
} from 'src/common/helpers/budget-debt-bucket';

/**
 * Formas de pagamento que saem do bolso na própria data da transação —
 * ao contrário do crédito, que só sai no vencimento da fatura.
 */
const DIRECT_PAYMENT_TYPES: TransactionType[] = [
  TransactionType.DEBIT_CARD,
  TransactionType.PIX,
  TransactionType.BOLETO,
];

/** O item em aberto já está VENCIDO hoje? Dia civil de Fortaleza. */
/**
 * O mais próximo entre dois vencimentos.
 *
 * Vencido tem data MENOR, então lidera sozinho — a mesma propriedade que
 * `nextSettlementItem` usa em Pessoas, e a razão de não haver um `if` de
 * urgência aqui: prioridade por data já ordena atrasado → hoje → futuro.
 */
function menorData(atual: Date | null, candidata: Date | null): Date | null {
  if (!candidata) return atual;
  if (!atual) return candidata;
  return candidata < atual ? candidata : atual;
}

/**
 * A MAIOR entre duas datas de liquidação.
 *
 * Representa quando o último item pendente foi quitado — o momento em que o
 * agregado ficou integralmente resolvido.
 */
function maiorData(atual: Date | null, candidata: Date | null): Date | null {
  if (!candidata) return atual;
  if (!atual) return candidata;
  return candidata > atual ? candidata : atual;
}

/**
 * O evento aberto mais urgente do MESMO sentido do saldo.
 *
 * Espelha `nextSettlementItem` (Pessoas) sobre os mínimos já acumulados: aqui
 * a agregação percorre os itens uma vez e guarda o menor por lado, então não
 * há array para reprocessar — mas a POLICY é idêntica, e é isso que importa
 * para as duas telas não divergirem.
 *
 * Saldo zero devolve `null`: não há um sentido a mostrar, então não há evento.
 */
function nextOpenItem(
  entry: { openNextReceivableDue: Date | null; openNextDebtDue: Date | null },
  netBalance: number,
): { direction: 'receive' | 'pay'; dueDate: string } | null {
  if (Math.abs(netBalance) < 0.005) return null;

  const direction = netBalance > 0 ? 'receive' : 'pay';
  const escolhido =
    direction === 'receive'
      ? entry.openNextReceivableDue
      : entry.openNextDebtDue;

  return escolhido === null
    ? null
    : { direction, dueDate: civilDay(escolhido) };
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
 * ══════════════════════════════════════════════════════════════════════════
 * A autoridade temporal ÚNICA de `Pendências anteriores`
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Decide se pendências anteriores ainda abertas entram — dívidas E faturas,
 * pela MESMA regra. A fila é o estado de AGORA, nunca uma projeção: afirmar
 * em outubro que um atraso de agosto continuará aberto lá inventaria um fato
 * que ninguém sabe, já que o usuário pode resolvê-lo amanhã.
 *
 * A fatura ficou de fora desta regra por omissão, não por decisão: a consulta
 * dela raciocinou apenas sobre o limite INFERIOR ("competência anterior à
 * exibida") e nunca sobre o superior. No mesmo cenário, a dívida não
 * carregava para o futuro e a fatura carregava.
 *
 * Existe uma `isCurrentCompetence` em `salary.helper` com a mesma aritmética.
 * Ela não é reusada aqui de propósito: recebe `SalaryCompetence` e existe para
 * decidir o cache de `User.salary`. Compartilhar a função acoplaria a regra de
 * carry ao domínio de renda, e a próxima mudança em um dos lados teria de
 * justificar-se para o outro.
 *
 * O fuso é explícito porque o servidor roda em UTC: em 31/08 às 22h de
 * Fortaleza já é 01/09 em UTC, e `getUTCMonth()` diria setembro — o carry
 * sumiria da tela um dia antes da hora.
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
      /** Vencidas de competências anteriores — a fila viva de faturas. */
      overdueInvoicesFromPast,
      directPayments,
      openDueInMonth,
      monthReceivables,
      currentOpenPrior,
      paidInCompetence,
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

      /*
        ══════════════════════════════════════════════════════════════════
        Faturas VENCIDAS de competências anteriores, ainda não pagas
        ══════════════════════════════════════════════════════════════════

        Dívida vencida sempre carregou para `Pendências anteriores`; fatura
        vencida não. A inconsistência era da consulta acima, fechada em
        `month/year` — não havia predicado a corrigir, faltava a pergunta.

        Uma fatura de agosto que venceu e continua aberta é dinheiro que ainda
        precisa sair. Em setembro ela pertence à fila.

        ── O recorte ──

        `status: OVERDUE` é a autoridade temporal já existente: o cron a move
        de CLOSED para OVERDUE no vencimento, e `deriveStatusFromInvoiceDates`
        faz o mesmo inline. Usar `dueDate < hoje` aqui seria uma segunda
        definição de "vencida".

        Isso também resolve o caso de fechada-mas-não-vencida: fatura que
        fecha em 25/08 e vence em 05/09 está CLOSED, não OVERDUE, e não entra
        na fila — ela pertence à competência dela.

        Competência ANTERIOR à exibida: a fatura do próprio mês já vem na
        consulta acima, e trazê-la aqui a contaria duas vezes.

        ── E somente no mês CORRENTE ──

        A fila é o estado de AGORA, não uma projeção. Uma fatura vencida em
        agosto e ainda aberta é fato de setembro; afirmá-la em outubro seria
        dizer que ela ainda estará aberta lá, o que ninguém sabe — o usuário
        pode pagá-la amanhã.

        É a MESMA regra que a dívida já seguia (`isCurrentMonth` guardando a
        consulta de `currentOpenPrior`, e `classifyDebtForBudget` devolvendo
        `excluded` fora do mês corrente). A primeira versão desta consulta
        raciocinou só sobre o limite INFERIOR — "competência anterior à
        exibida" — e nunca considerou o superior: a fatura projetava para
        outubro e novembro um atraso que a dívida, no mesmo cenário, não
        projetava.

        Mês passado continua fora pelo mesmo motivo da dívida: aquele mês não
        viu o dinheiro sair, e contá-lo inventaria um desembolso histórico. O
        recorte de competência anterior já produzia isso; o guard só torna a
        intenção explícita em vez de acidental.
      */
      isCurrentMonth
        ? this.prisma.invoice.findMany({
            where: {
              userId,
              status: 'OVERDUE',
              OR: [{ year: { lt: year } }, { year, month: { lt: month } }],
            },
            include: { bank: true },
          })
        : /*
            O tipo do ramo vazio é explícito: `Promise.resolve([])` sozinho
            infere `never[]`, e a união com o ramo da consulta colapsa para
            `never` — os acessos a `inv.totalAmount` e `inv.id` mais abaixo
            deixariam de compilar.

            A consulta da dívida não precisa disso porque `select` lhe dá uma
            forma concreta que sobrevive à união; esta usa `include`.
          */
          Promise.resolve(
            [] as Awaited<
              ReturnType<typeof this.prisma.invoice.findMany<{
                include: { bank: true };
              }>>
            >,
          ),
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

          B. `paidInCompetence` — dívida que VENCE nesta competência e já
             foi resolvida. Fica na competência dela, exibida como paga, e
             NÃO viaja para o mês em que o pagamento aconteceu.

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
        Dívidas que VENCEM nesta competência e já foram pagas.

        ── Contrato V2: a competência é o vencimento ──

        A consulta era `paidAt` dentro do mês — "pagas nesta competência,
        qualquer vencimento". Ela deslocava a dívida para o mês do
        desembolso: vencida em janeiro e paga em março, aparecia em MARÇO.

        O Budget é competência, não fluxo de caixa. Quem responde "quando o
        dinheiro saiu" é o Extrato. Agora o recorte é o vencimento, e o
        pagamento só decide que a linha aparece como resolvida.

        `paidAt` não é mais consultado aqui — nem o legado pago sem data
        precisa de tratamento especial, porque a competência não depende dele.
      */
      this.prisma.debt.findMany({
        where: {
          userId,
          isPaid: true,
          dueDate: { gte: monthStart, lt: monthEnd },
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

        Espelha `paidInCompetence` do lado da dívida. Sem ele, o netting mensal
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
          /* Para `settledAt`: quando o acerto terminou de ser liquidado. */
          paidAt: true,
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

    /*
      As faturas carregadas entram no MESMO agrupamento de terceiros.

      É o que garante que a fatura em `Pendências anteriores` use a sua parte
      econômica, e não o bruto: a autoridade é uma só, a mesma que a row
      normal do Budget usa.
    */
    const invoiceIds = [
      ...invoices.map((inv) => inv.id),
      ...overdueInvoicesFromPast.map((inv) => inv.id),
    ];

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
    /*
      `totalReimbursable` agora abrange as faturas carregadas também, então o
      desconto de terceiros do próprio mês precisa ser isolado — senão
      `netAmount` (a parte do mês) descontaria terceiros de outra competência.
    */
    const reimbursableThisMonth = invoices.reduce(
      (sum, inv) => sum + (reimbursablePerInvoice.get(inv.id) ?? 0),
      0,
    );
    const netAmount = totalInvoices - reimbursableThisMonth;

    /*
      ── A fila viva de faturas entra no total ──

      Uma fatura vencida e aberta é dinheiro que ainda precisa sair; enquanto
      ela permanece na fila, participa do total operacional do mês exibido.

      Ao ser paga, `status` deixa de ser OVERDUE, ela sai da consulta, e o
      total daquele mês diminui — a retroatividade deliberada do contrato.

      Pela SUA PARTE, nunca pelo bruto: é a mesma decomposição da row normal.
    */
    const overdueInvoicesOwnTotal = overdueInvoicesFromPast.reduce(
      (sum, inv) =>
        sum +
        Number(inv.totalAmount) -
        (reimbursablePerInvoice.get(inv.id) ?? 0),
      0,
    );

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
    const selectedPeriod: BudgetPeriod = { year, month };

    /*
      O detalhamento por linha reúne os três conjuntos — é o que a tela lista
      abaixo do total, e precisa fechar com ele.

      ── Menos as que vão para `Pendências anteriores` ──

      `debtBreakdown` alimenta a seção "Dívidas" e `priorItems` alimenta a
      fila. Sem este filtro os dois conjuntos se sobrepõem: `currentOpenPrior`
      entrava inteiro nos dois, e a MESMA dívida aparecia nas duas seções da
      mesma tela — "Pendências anteriores · R$ 300,00" e "Dívidas · R$ 300,00"
      sendo a mesma obrigação.

      Os totais nunca dobraram (`debts.total` sempre usou os baldes
      separados), então nenhuma soma estava errada: o defeito era de
      APRESENTAÇÃO, e a tela contradizia o próprio número ao listar duas
      linhas sob um total que contava uma.

      Quem decide continua sendo `classifyDebtForBudget` — o balde é único por
      construção, e este filtro só o respeita em vez de reimplementá-lo.
    */
    const allDebtRows = [
      ...openDueInMonth,
      ...currentOpenPrior,
      ...paidInCompetence,
    ].filter(
      (debt) => classifyDebtForBudget(debt, selectedPeriod) !== 'prior',
    );
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

    /** Vence nesta competência e já foi paga. */
    const paidInCompetenceTotal = sumAmount(paidInCompetence);

    /*
      Obrigação da competência: abertas E pagas que vencem aqui.

      As pagas saíram de `priorTotal` — elas não são pendência anterior
      nenhuma sob o contrato V2 — e entram aqui, onde a competência delas
      realmente é. Sem isto, uma dívida paga no próprio mês do vencimento
      desapareceria do total.
    */
    const dueInMonth = openDueTotal + paidInCompetenceTotal;

    /*
      `Pendências anteriores` é uma FILA VIVA: só o que ainda exige ação.

      O total somava as pagas — porque elas viajavam para o mês do pagamento
      e apareciam ali como pendência resolvida. Sob o contrato V2 elas ficam
      na própria competência, na seção normal, e o total desta seção passa a
      refletir apenas obrigação aberta.
    */
    const priorTotal = currentOpenPriorTotal;

    /*
      Tipo explícito: sem ele o spread das duas listas alarga para `any` e o
      `.map` seguinte perde a checagem de cada campo.
    */
    type PriorRow = (typeof currentOpenPrior)[number];

    /*
      ── Somente obrigação ABERTA ──

      A lista recebia também as dívidas pagas, com `settled: true`. Isso fazia
      sentido enquanto a competência de uma dívida paga era o mês do
      pagamento: ela chegava aqui como "pendência anterior resolvida".

      Sob o contrato V2 a competência é o vencimento, e `Pendências
      anteriores` passou a ser uma fila viva — o que foi resolvido pertence à
      seção normal da competência dele.

      O filtro por `classifyDebtForBudget` permanece: ele já devolve
      `excluded` para paga fora da própria competência e nunca `prior` para
      paga. Manter a checagem torna a seção imune a uma consulta futura que
      traga algo a mais.
    */
    const priorBreakdown = currentOpenPrior
      .filter(
        (debt: PriorRow) =>
          classifyDebtForBudget(debt, selectedPeriod) === 'prior',
      )
      .map((debt: PriorRow) => ({
        title: debt.title,
        amount: Number(debt.amount),
        /** Vencimento ORIGINAL — não reescrito como se fosse deste mês. */
        dueDate: debt.dueDate,
        personId: debt.personId,
        personName: debt.person?.name ?? null,
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
      /**
       * Dívidas desta pessoa que VENCEM na competência e já foram pagas.
       *
       * O nome era `budgetPriorPaidInMonth` — "anteriores pagas neste mês" —,
       * duas afirmações que a V2 desfez: elas não são anteriores (a
       * competência é o vencimento) nem "deste mês" (o mês do pagamento
       * deixou de posicionar). O valor econômico é o mesmo; o nome mentia.
       */
      budgetPaidInCompetence: number;
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
      /*
        ── Universo C: QUANDO ──

        Os dois universos acima respondem "quanto". A lista do Orçamento
        precisava de uma terceira resposta: "quando isto acontece?". Antes o
        payload só levava `openHasOverdue` — existe algo vencido, sim ou não —,
        então a tela sabia que havia urgência mas não sabia dizer "Pagar em 5d",
        e caía na composição bilateral como metadata de recurso.

        `dueDate` já era lido nos quatro laços de pendência aberta, só para
        derivar aquele booleano, e descartado depois. O mínimo por LADO é
        acumulado na mesma passagem — nenhuma consulta nova, nenhuma consulta
        por pessoa.

        Um por lado, não um global: a row mostra o evento do MESMO sentido do
        saldo, e um mínimo único obrigaria a escolher o lado antes de saber
        qual é.
      */
      openNextReceivableDue: Date | null;
      openNextDebtDue: Date | null;
      /*
        ── Quando o agregado terminou de ser liquidado ──

        `settledAt` é a MAIOR data entre os itens resolvidos: o instante em que
        o último pendente foi quitado e, portanto, em que a relação daquela
        competência ficou integralmente resolvida. Não é "a última que
        apareceu" — é um fato com significado próprio.

        ── Por que não existe um `settledUnknown` ──

        As duas consultas de resolvidos filtram `paidAt` na janela do mês, e o
        legado pago SEM data não casa com o range: ele nunca chega aqui. Um
        campo para marcar essa ausência seria inalcançável por construção, e
        código morto que aparenta cobrir um caso é pior que a ausência dele.

        A ambiguidade honesta que SOBRA é `settledAtMax === null`, quando nada
        foi resolvido na competência — e a tela já trata isso.
      */
      settledAtMax: Date | null;
      settledCount: number;
      /*
        Os pagamentos de DÍVIDA da competência, para derivar quando a
        contribuição do orçamento ficou coberta.

        Só dívidas: recebimentos não cobrem saída de caixa. Guardados como
        pares (valor, data) porque a resposta depende da ORDEM cronológica —
        ver `budgetSettledAt`.
      */
      debtPayments: Array<{ amount: number; paidAt: Date | null }>;
    }

    const settlementByPerson = new Map<string, SettlementAccumulator>();

    /**
     * Registra um item RESOLVIDO da competência.
     *
     * `settledAt` fica com a MAIOR data: o momento em que o último item
     * pendente foi liquidado e, portanto, em que o agregado ficou
     * integralmente resolvido. Não é "a última que apareceu" — é um fato com
     * significado próprio, e é o que a row afirma ao dizer "Quitado em 18/08".
     *
     * `paidAt` ausente é defensivo, não um caso real: as consultas de
     * resolvidos filtram `paidAt` na janela, então o legado pago sem data não
     * chega até aqui. Se chegasse, a data não seria afirmada — nunca a de
     * outro item como se fosse a conclusão.
     */
    function registrarLiquidacao(
      entry: SettlementAccumulator,
      paidAt: Date | null | undefined,
    ): void {
      entry.settledCount += 1;
      if (!paidAt) return;
      entry.settledAtMax = maiorData(entry.settledAtMax, paidAt);
    }

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
        budgetPaidInCompetence: 0,
        budgetReceivableAmount: 0,
        budgetAutomaticReceivable: 0,
        openReceivableInMonth: 0,
        openDebtInMonth: 0,
        openPriorReceivable: 0,
        openPriorDebt: 0,
        openItemCount: 0,
        openHasOverdue: false,
        openAutomaticReceivable: 0,
        openNextReceivableDue: null,
        openNextDebtDue: null,
        settledAtMax: null,
        settledCount: 0,
        debtPayments: [],
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
      const entry = settlementEntry(
        receivable.personId,
        receivable.person?.name ?? 'Pessoa',
      );
      entry.budgetReceivableAmount += Number(receivable.amount);
      registrarLiquidacao(entry, receivable.paidAt);
    }

    /*
      ── Dívida ANTERIOR não participa do netting da pessoa ──

      A temporalidade decide antes da pessoa: se a origem é de um mês
      anterior, o balde é "Pendências anteriores", e só ele.

      Deixá-la também aqui produziria a dupla representação que esta tarefa
      fecha — compensada silenciosamente dentro de "Acertos com pessoas" E
      exibida como pendência anterior, a mesma obrigação contando duas vezes.

      `budgetPaidInCompetence` recebe a dívida paga cuja competência é ESTA —
      e sob a V2 isso é toda dívida paga que vence aqui, qualquer que tenha
      sido a data do pagamento. Ela pertence ao netting normalmente.
    */
    for (const debt of currentOpenPrior) {
      if (!debt.personId) continue;
      if (classifyDebtForBudget(debt, selectedPeriod) === 'prior') continue;
      settlementEntry(
        debt.personId,
        debt.person?.name ?? 'Pessoa',
      ).budgetCurrentOpenPrior += Number(debt.amount);
    }

    for (const debt of paidInCompetence) {
      if (!debt.personId) continue;
      if (classifyDebtForBudget(debt, selectedPeriod) === 'prior') continue;
      const entry = settlementEntry(
        debt.personId,
        debt.person?.name ?? 'Pessoa',
      );
      entry.budgetPaidInCompetence += Number(debt.amount);
      registrarLiquidacao(entry, debt.paidAt);
      entry.debtPayments.push({
        amount: Number(debt.amount),
        paidAt: debt.paidAt ?? null,
      });
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
      entry.openNextReceivableDue = menorData(
        entry.openNextReceivableDue,
        receivable.dueDate,
      );
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
      entry.openNextDebtDue = menorData(entry.openNextDebtDue, debt.dueDate);
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
      /*
        Pendência anterior entra no MESMO mínimo: a regra do Budget já carrega
        o atraso de meses passados, e um item vencido em agosto é o evento mais
        urgente de setembro — não um item de outro universo.
      */
      entry.openNextReceivableDue = menorData(
        entry.openNextReceivableDue,
        receivable.dueDate,
      );
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
      entry.openNextDebtDue = menorData(entry.openNextDebtDue, debt.dueDate);
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
      entry.budgetPaidInCompetence +
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
    /*
      A parte com pessoa que REALMENTE foi para "Acertos com pessoas".

      O `.filter(personId)` sozinho não basta desde que a temporalidade passou
      a ter precedência: uma dívida anterior com pessoa vai para "Pendências
      anteriores", não para os acertos. Subtraí-la aqui a removeria do bucket
      genérico sem que nada a somasse de volta — ela desapareceria do total,
      que foi exatamente o que aconteceu na primeira tentativa desta correção.

      A condição é a mesma do laço que alimenta o netting: um único
      classificador decide os dois lados.
    */
    const personDebtTotal = [
      ...openDueInMonth,
      ...currentOpenPrior,
      ...paidInCompetence,
    ]
      .filter(
        (debt) =>
          debt.personId &&
          classifyDebtForBudget(debt, selectedPeriod) !== 'prior',
      )
      .reduce((sum, debt) => sum + Number(debt.amount), 0);

    /*
      Dívidas genéricas = total de dívidas menos a parte que foi para acertos.

      O que sobra inclui as pendências anteriores (com pessoa ou sem), que é
      o balde onde elas agora vivem — e continuam somando no total uma única
      vez.
    */
    const genericDebtTotal = dueInMonth + priorTotal - personDebtTotal;

    const peopleBudgetPayableTotal = [...settlementByPerson.values()].reduce(
      (sum, entry) =>
        sum +
        Math.max(
          entry.budgetDebtDueInMonth +
            entry.budgetCurrentOpenPrior +
            entry.budgetPaidInCompetence -
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

    /*
      Faturas e dívidas já quitadas continuam somando: o número representa o
      custo da competência, não só o que ainda falta desembolsar.

      `overdueInvoicesOwnTotal` é a fila viva de faturas — obrigação de outra
      competência que ainda precisa sair. Enquanto aberta, participa; ao ser
      paga, sai da consulta e o total deste mês diminui.
    */
    const totalToPay =
      netAmount +
      totalDirectPayments +
      totalDebts +
      overdueInvoicesOwnTotal;

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
            /*
              Vence nesta competência e já foi paga. Era `paidInMonth`, que
              afirmava o MÊS DO PAGAMENTO — o que a V2 deixou de usar.
            */
            paidInCompetence: entry.budgetPaidInCompetence,
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
                entry.budgetPaidInCompetence -
                entry.budgetReceivableAmount,
              0,
            ),
            /** `debtDueInMonth + priorDebtCarry` — o que compõe o orçamento. */
            debtTotal:
              entry.budgetDebtDueInMonth +
              entry.budgetCurrentOpenPrior +
              entry.budgetPaidInCompetence,
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
            /*
              ── O próximo acerto, do MESMO sentido do saldo ──

              A regra é a de `nextSettlementItem`, em Pessoas: o líquido decide
              o lado, e o menor `dueDate` daquele lado é o evento. Vencido tem
              data menor, então lidera sozinho — atrasado, hoje e futuro saem
              ordenados sem um `if` de urgência.

              Seguir o sentido do saldo é o que impede a row de se contradizer:
              "VOCÊ DEVE" com "Receber amanhã" embaixo é factualmente correto e
              exige do leitor o esforço que a lista existe para evitar. O custo
              é conhecido — uma dívida vencendo amanhã não aparece quando o
              saldo é a receber —, e o extrato da pessoa é onde ela está.

              Saldo ZERO não tem sentido a mostrar (pode haver R$ 500 abertos
              de cada lado), então também não tem evento a destacar.

              DADO, nunca copy: o verbo e a distância são decisões de
              apresentação, e a mesma informação alimenta a lista hoje e
              poderia alimentar um push amanhã, com outro vocabulário.
            */
            nextItem: nextOpenItem(entry, openReceivableTotal - openDebtTotal),
          },

          /*
            ── QUANDO o acerto terminou de ser liquidado ──

            `settledAt` é a MAIOR data de liquidação entre os itens resolvidos
            da competência: o instante em que o último pendente foi quitado.
            Não é conveniência de layout — é o momento em que a relação daquele
            mês ficou integralmente resolvida.

            `null` quando nada foi resolvido na competência — e a tela cai num
            fallback neutro, porque não existe data a afirmar. O legado pago
            sem `paidAt` não produz esse caso: ele não casa com a janela das
            consultas de resolvidos e nunca chega ao agregado.
          */
          settled: {
            /** `YYYY-MM-DD` civil, ou `null` quando não há data defensável. */
            settledAt: entry.settledAtMax
              ? civilDay(entry.settledAtMax)
              : null,
            /** Quantos itens da competência estão resolvidos. */
            itemCount: entry.settledCount,
          },

          /*
            ── O estado da CONTRIBUIÇÃO ao orçamento ──

            Responde "a saída líquida desta relação já foi coberta?", que é
            outra pergunta de "a relação bilateral terminou?" (`settled`).

            Devendo R$ 11 a quem me deve R$ 10, pagar a dívida cobre a saída de
            R$ 1 — mesmo com o recebível aberto. Acoplar os dois faria o
            orçamento dizer "a pagar R$ 1" depois de o dinheiro ter saído, só
            porque falta alguém me pagar.

            `paid` é limitado por `planned`: R$ 130 quitados com R$ 80 a
            receber deram R$ 50 de saída, não R$ 130 — e é o que mantém
            `paid + remaining = planned`.
          */
          contribution: resolveContribution(
            Math.max(
              entry.budgetDebtDueInMonth +
                entry.budgetCurrentOpenPrior +
                entry.budgetPaidInCompetence -
                entry.budgetReceivableAmount,
              0,
            ),
            entry.debtPayments,
          ),
        };
      });

    const paidInvoices = invoices
      .filter((inv) => inv.status === 'PAID')
      .reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
    /*
      A parcela JÁ PAGA do mês vem de `paidInCompetence`.

      Antes saía de `openDueInMonth` filtrando `isPaid`, mas aquele conjunto
      agora só traz dívidas abertas — o filtro devolveria sempre zero, e a
      linha "R$ X pago" nunca sairia do lugar.

      Valor íntegro: sem compensação, o pago não pode superar o total.
    */
    /*
      ══════════════════════════════════════════════════════════════════════
      O pago de uma dívida COM pessoa é limitado pela contribuição dela
      ══════════════════════════════════════════════════════════════════════

      `paidInCompetenceTotal` é o BRUTO de tudo que foi quitado, e o total do
      orçamento usa o netting por pessoa. Devendo R$ 30 a alguém que me deve
      R$ 50, a contribuição é ZERO — a relação não é saída líquida nenhuma —,
      mas quitar a dívida somava R$ 30 ao "pago".

      O usuário via "R$ 30 pago" sem nenhuma row de origem: com contribuição
      zero a pessoa nem aparece em "Acertos com pessoas".

      O `Math.min(..., totalToPay)` logo abaixo é um teto GLOBAL: impede o
      absurdo de "pagou mais que o total", não o vazamento por pessoa. Com
      qualquer outra despesa dando folga, os R$ 30 passavam.

      ── O teto por pessoa ──

      `min(contribuição, dívidas quitadas)` — o pago nunca ultrapassa o que
      aquela relação planejou tirar do bolso. Dívida SEM pessoa não passa por
      aqui: sem contraparte, não há recebível com quem compensar, e a regra
      antiga vale sem alteração.
    */
    const paidPorPessoa = peopleSettlements.reduce(
      (soma, pessoa) => soma + pessoa.contribution.paid,
      0,
    );

    const paidDebtsSemPessoa = paidInCompetence
      .filter((debt) => !debt.personId)
      .reduce((soma, debt) => soma + Number(debt.amount), 0);

    const paidDebts = paidDebtsSemPessoa + paidPorPessoa;
    const paidDebtsCount = paidInCompetence.length;

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
        /** Vencem nesta competência e já estão pagas. */
        paidInCompetence: paidInCompetenceTotal,
        total: totalDebts,
        priorItems: priorBreakdown,
      },

      /*
        ── A fila viva de FATURAS ──

        Faturas vencidas de competências anteriores, ainda abertas. Campo
        próprio em vez de misturar com `debts.priorItems`: a row de fatura tem
        identidade visual e navegação próprias, e achatá-las num item genérico
        perderia isso.

        O valor é a SUA PARTE — a mesma decomposição da row normal do
        Orçamento, nunca o bruto.
      */
      /*
        A MESMA forma de `invoices` — o registro inteiro mais a decomposição.

        Um objeto reduzido (só nome do banco e valor) obrigaria a tela a
        montar a row de fatura por um segundo caminho, e foi exatamente isso
        que fez Bancos e Orçamento divergirem antes da Fase UI-ALIGN.
        `status` e `closeDate` vêm junto porque o presenter canônico os pede.
      */
      priorInvoices: overdueInvoicesFromPast.map((invoice) => {
        const reimbursable = reimbursablePerInvoice.get(invoice.id) ?? 0;
        return {
          ...invoice,
          reimbursable,
          /** O que sai do bolso do usuário — o valor que soma no total. */
          ownAmount: Number(invoice.totalAmount) - reimbursable,
        };
      }),
      /** Σ da sua parte das faturas carregadas — entra em `totalToPay`. */
      priorInvoicesTotal: overdueInvoicesOwnTotal,
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
      /*
        Quantos itens estão na FILA VIVA de pendências anteriores.

        Somava `paidInCompetence` — as dívidas pagas, que na V1 chegavam à
        seção como pendência resolvida. Sob a V2 elas pertencem à competência
        do vencimento, e contá-las aqui faria a contagem discordar do que a
        seção realmente renderiza.

        As faturas carregadas entram porque são itens da mesma seção.
      */
      priorCount: currentOpenPrior.length + overdueInvoicesFromPast.length,
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
      /** Quando o dinheiro saiu. `null` no legado pago sem data. */
      paidAt?: Date | null;
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
        /* Menor vencimento ABERTO: o próximo evento. */
        nextDue: Date | null;
        /* Maior liquidação: quando o último pendente foi quitado. */
        settledAt: Date | null;
      }
    >();
    const standalone: Array<{
      kind: 'debt';
      id: string | null;
      name: string;
      amount: number;
      isPaid: boolean;
      status: DebtStatus;
      dueDate: string | null;
      settledAt: string | null;
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
          nextDue: null as Date | null,
          settledAt: null as Date | null,
        };
        entry.amount += Number(debt.amount);
        entry.count += 1;
        if (!debt.isPaid) entry.allPaid = false;
        if (statusOf(debt) === 'OVERDUE') entry.anyOverdue = true;
        /*
          Aberta alimenta o PRÓXIMO evento; paga alimenta a CONCLUSÃO. Cada
          item contribui para um só dos dois, e a linha usa o que o estado
          agregado pedir.
        */
        if (debt.isPaid) {
          entry.settledAt = maiorData(entry.settledAt, debt.paidAt ?? null);
        } else {
          entry.nextDue = menorData(entry.nextDue, debt.dueDate);
        }
        byPerson.set(debt.personId, entry);
      } else {
        /*
          Dívida avulsa é UM item: a data é inequívoca por natureza, sem
          agregação a desambiguar. `dueDate` quando aberta (o prazo a cumprir)
          e `paidAt` quando paga (quando o dinheiro saiu) — nunca as duas, para
          a tela não ter de escolher.
        */
        standalone.push({
          kind: 'debt',
          id: null,
          name: debt.title,
          amount: Number(debt.amount),
          isPaid: debt.isPaid,
          status: statusOf(debt),
          dueDate: debt.isPaid ? null : civilDay(debt.dueDate),
          settledAt:
            debt.isPaid && debt.paidAt ? civilDay(debt.paidAt) : null,
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
      /*
        Só quando há algo ABERTO: numa pessoa inteiramente paga o próximo
        vencimento não existe, e devolver um seria afirmar pendência.
      */
      dueDate: entry.nextDue ? civilDay(entry.nextDue) : null,
      /*
        Só quando TUDO está pago. Com item aberto, a relação não terminou de
        ser liquidada — a data do que já foi pago não é a conclusão dela.
      */
      settledAt:
        entry.allPaid && entry.settledAt ? civilDay(entry.settledAt) : null,
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
