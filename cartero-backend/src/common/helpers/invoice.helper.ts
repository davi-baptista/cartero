import { Bank, Invoice, InvoiceStatus, Prisma } from '@prisma/client';

export const SYSTEM_RECEIVABLE_BANK_NAME = '__system_receivables__';
export const DEFAULT_INVOICE_DAYS_AFTER_CLOSE = 7;

export function getLegacyCloseDay(
  dueDay: number,
  daysAfterClose: number,
): number {
  const closeOffset = Math.max(1, daysAfterClose);
  return ((((dueDay - 1 - closeOffset) % 31) + 31) % 31) + 1;
}

/**
 * A conta interna de recebíveis do usuário, criando-a se ainda não existir.
 *
 * Existe para satisfazer o `bankId` obrigatório da transação de receita gerada
 * ao marcar uma cobrança como recebida sem informar conta de destino. Não é
 * uma conta real: fica fora de `GET /banks` e o nome técnico nunca deve
 * aparecer ao usuário.
 *
 * ─── A corrida ───────────────────────────────────────────────────────────
 *
 * `findFirst` seguido de `create` tem janela: dois recebimentos marcados em
 * paralelo, cada um na sua transação, não veem a linha criada pelo outro sob
 * READ COMMITTED, e os dois inserem. O resultado seriam duas contas internas
 * para o mesmo usuário — uma delas passando a receber lançamentos que a outra
 * não conhece.
 *
 * A defesa é a releitura após falha, não uma constraint nova: `Bank` não tem
 * unique de nome, e adicioná-la agora poderia falhar na aplicação se algum
 * usuário já tiver dois bancos homônimos (o `create` do serviço checa por
 * `findFirst`, que tem a mesma janela). Este laço resolve o caso real sem
 * arriscar uma migration que não sobe.
 */
export async function findOrCreateSystemReceivableBank(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<Bank> {
  const existing = await tx.bank.findFirst({
    where: { userId, isSystem: true, name: SYSTEM_RECEIVABLE_BANK_NAME },
  });
  if (existing) return existing;

  try {
    return await tx.bank.create({
      data: {
        userId,
        name: SYSTEM_RECEIVABLE_BANK_NAME,
        isSystem: true,
        invoiceCloseDate: 31,
        invoiceDueDate: 31,
        invoiceDueDaysAfterClose: DEFAULT_INVOICE_DAYS_AFTER_CLOSE,
      },
    });
  } catch (error) {
    // Perdeu a corrida: outra execução criou a conta entre a leitura e a
    // escrita. Reler devolve a vencedora em vez de propagar o erro.
    const winner = await tx.bank.findFirst({
      where: { userId, isSystem: true, name: SYSTEM_RECEIVABLE_BANK_NAME },
    });
    if (winner) return winner;
    throw error;
  }
}

export type InvoiceSchedule = Pick<
  Bank,
  'invoiceDueDate' | 'invoiceDueDaysAfterClose'
>;

function daysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateForDayUtc(year: number, month: number, day: number): Date {
  const clampedDay = Math.min(day, daysInMonthUtc(year, month));
  return new Date(Date.UTC(year, month - 1, clampedDay, 3));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function intervalDays(bank: Pick<Bank, 'invoiceDueDaysAfterClose'>): number {
  return Math.max(
    1,
    bank.invoiceDueDaysAfterClose ?? DEFAULT_INVOICE_DAYS_AFTER_CLOSE,
  );
}

function closeOffsetDays(bank: Pick<Bank, 'invoiceDueDaysAfterClose'>): number {
  return intervalDays(bank);
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Cálculo PROSPECTIVO — para faturas que ainda não existem
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Estas funções respondem "em que fatura uma compra nova entraria, e quando
 * essa fatura fecharia/venceria". Servem para criar faturas e para projetar
 * cenários; nunca para reler a data de uma fatura que já está no banco —
 * para isso existem `getInvoiceDueDate`/`getInvoiceCloseDate`, que leem o
 * valor persistido.
 *
 * Misturar os dois papéis era exatamente a causa da deriva histórica.
 *
 * A competência é identificada pelo mês do VENCIMENTO. O fechamento é contado
 * para trás em dias corridos, então pode cair no mês anterior: uma fatura de
 * agosto pode fechar em 30 de julho e continuar sendo a fatura de agosto.
 */
export function getInvoiceCloseDateForPeriod(
  bank: InvoiceSchedule,
  year: number,
  month: number,
): Date {
  const dueDate = getInvoiceDueDateForPeriod(bank, year, month);
  return addDays(dueDate, -closeOffsetDays(bank));
}

export function getInvoiceDueDateForPeriod(
  bank: InvoiceSchedule,
  year: number,
  month: number,
): Date {
  // The invoice period always follows the due month. The close date may be
  // in the previous month; that does not change the invoice's month/year.
  return dateForDayUtc(year, month, bank.invoiceDueDate);
}

/**
 * Vencimento de uma fatura que JÁ EXISTE — sempre o valor persistido.
 *
 * A assinatura antiga recebia o banco e recalculava a partir da configuração
 * vigente, o que fazia a data de uma fatura paga mudar quando o cartão era
 * reconfigurado. Agora a fatura é a fonte de verdade e o banco não participa.
 *
 * Para saber o vencimento de uma fatura que ainda NÃO existe, use
 * `getInvoiceDueDateForPeriod` — é o cálculo prospectivo, e a distinção entre
 * os dois é justamente o que impede o histórico de derivar.
 */
export function getInvoiceDueDate(invoice: Pick<Invoice, 'dueDate'>): Date {
  return invoice.dueDate;
}

/** Fechamento de uma fatura existente — persistido. Ver `getInvoiceDueDate`. */
export function getInvoiceCloseDate(invoice: Pick<Invoice, 'closeDate'>): Date {
  return invoice.closeDate;
}

/**
 * Status de uma fatura existente, pelas datas que ela própria guarda.
 *
 * Contraparte de `deriveInvoiceStatus`, que calcula a partir de uma
 * configuração de banco e serve para faturas ainda inexistentes. Esta versão
 * nunca consulta o banco, então uma reconfiguração do cartão não pode mexer no
 * estado de uma fatura histórica durante o cron.
 *
 * `PAID` é terminal e não é derivado aqui — quem chama decide preservá-lo.
 */
export function deriveStatusFromInvoiceDates(
  invoice: Pick<Invoice, 'closeDate' | 'dueDate'>,
  today: Date = new Date(),
): InvoiceStatus {
  if (isAfterCivilDay(today, invoice.dueDate)) return 'OVERDUE';
  if (!isAfterCivilDay(invoice.closeDate, today)) return 'CLOSED';
  return 'OPEN';
}

/**
 * Número do dia civil (UTC), sem hora — a unidade em que datas do app são
 * comparadas.
 *
 * Campos de data aqui representam um DIA, não um instante, mas os helpers
 * ancoram em horas diferentes (`parseDateOnly` usa 12h; as datas de fatura,
 * 3h). Comparar os instantes crus faria uma compra registrada no próprio dia
 * do fechamento parecer posterior a ele — 12h > 3h — e cair na fatura errada.
 * Reduzir ambos ao dia civil elimina essa interferência sem exigir que os
 * helpers concordem sobre a âncora.
 */
function toCivilDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** `true` se `date` é um dia civil posterior a `reference`. */
function isAfterCivilDay(date: Date, reference: Date): boolean {
  return toCivilDay(date) > toCivilDay(reference);
}

/**
 * Quantas competências olhar à frente antes de desistir. Duas bastariam para
 * qualquer configuração real (o intervalo entre fechamento e vencimento teria
 * de passar de dois meses para exigir mais); o limite existe só como barreira
 * contra laço infinito diante de dados corrompidos.
 */
const MAX_PERIOD_LOOKAHEAD = 14;

/**
 * A competência de uma compra é a PRIMEIRA cujo fechamento ainda não passou.
 *
 * Não basta testar o mês da compra e avançar uma vez: quando o fechamento cai
 * no mês anterior ao vencimento, a competência seguinte também pode já estar
 * fechada. Exemplo real — cartão que vence dia 5 e fecha 7 dias antes: a fatura
 * de março fecha em 26/02, então uma compra em 27/02 não pertence nem a
 * fevereiro (fechou em 29/01) nem a março, e sim a abril.
 *
 * O dia do fechamento pertence à fatura que fecha nele; só o dia seguinte
 * empurra para a próxima.
 */
export function getInvoicePeriodForDate(
  bank: InvoiceSchedule,
  transactionDate: Date,
): { year: number; month: number } {
  let month = transactionDate.getUTCMonth() + 1;
  let year = transactionDate.getUTCFullYear();

  for (let attempt = 0; attempt < MAX_PERIOD_LOOKAHEAD; attempt++) {
    const closeDate = getInvoiceCloseDateForPeriod(bank, year, month);
    if (!isAfterCivilDay(transactionDate, closeDate)) {
      return { year, month };
    }

    month = (month % 12) + 1;
    if (month === 1) year += 1;
  }

  return { year, month };
}

export function offsetInvoicePeriod(
  year: number,
  month: number,
  offset: number,
): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

/**
 * Status que a fatura teria pelas suas próprias datas, ignorando pagamento.
 *
 * Usado ao criar uma fatura e ao reabrir uma paga: nos dois casos o estado
 * correto vem do calendário, não de um valor fixo — reabrir uma fatura cujo
 * vencimento já passou tem de devolvê-la como OVERDUE, não como CLOSED.
 */
export function deriveInvoiceStatus(
  schedule: InvoiceSchedule,
  year: number,
  month: number,
  today: Date = new Date(),
): InvoiceStatus {
  const closeDate = getInvoiceCloseDateForPeriod(schedule, year, month);
  const dueDate = getInvoiceDueDateForPeriod(schedule, year, month);

  // Comparação por dia civil, pela mesma razão de `getInvoicePeriodForDate`:
  // o horário em que cada data foi ancorada não pode decidir o status.
  // Vencer hoje ainda não é estar vencida; fechar hoje já é estar fechada.
  if (isAfterCivilDay(today, dueDate)) return 'OVERDUE';
  if (!isAfterCivilDay(closeDate, today)) return 'CLOSED';
  return 'OPEN';
}

/**
 * A fatura da competência, criando-a se ainda não existir.
 *
 * Quando ela JÁ EXISTE, é devolvida como está: as datas persistidas não são
 * recalculadas só porque a linha foi lida de novo. É o que impede uma fatura
 * antiga de mudar de vencimento quando o cartão é reconfigurado.
 *
 * Quando precisa ser criada, fechamento e vencimento são calculados UMA VEZ
 * pela configuração vigente e gravados junto — passando a ser fato da fatura.
 */
export async function findOrCreateInvoiceForPeriod(
  tx: Prisma.TransactionClient,
  userId: string,
  bankId: string,
  schedule: InvoiceSchedule,
  year: number,
  month: number,
): Promise<Invoice> {
  const existing = await tx.invoice.findFirst({
    where: { userId, bankId, month, year },
  });

  if (existing) return existing;

  const closeDate = getInvoiceCloseDateForPeriod(schedule, year, month);
  const dueDate = getInvoiceDueDateForPeriod(schedule, year, month);

  return await tx.invoice.create({
    data: {
      userId,
      bankId,
      month,
      year,
      closeDate,
      dueDate,
      // Derivado das MESMAS datas que estão sendo gravadas, não de um segundo
      // cálculo — assim status e datas não podem nascer contraditórios.
      status: deriveStatusFromInvoiceDates({ closeDate, dueDate }),
    },
  });
}

export async function findOrCreateInvoice(
  tx: Prisma.TransactionClient,
  userId: string,
  bankId: string,
  invoiceDueDate: number,
  invoiceDueDaysAfterClose: number,
  transactionDate: Date,
): Promise<Invoice> {
  const schedule = { invoiceDueDate, invoiceDueDaysAfterClose };
  const { year, month } = getInvoicePeriodForDate(schedule, transactionDate);
  return findOrCreateInvoiceForPeriod(
    tx,
    userId,
    bankId,
    schedule,
    year,
    month,
  );
}
