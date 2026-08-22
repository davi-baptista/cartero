/**
 * ══════════════════════════════════════════════════════════════════════════
 * Seed de demonstração — ano de 2026
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Popula uma conta de DESENVOLVIMENTO com um ano financeiro plausível para
 * exercitar as telas do Cartero.
 *
 * ─── Princípios ───────────────────────────────────────────────────────────
 *
 * 1. **Usa os services reais.** Sobe um contexto Nest e chama
 *    `TransactionsService`, `SubscriptionsService`, `DebtsService` etc. Nada de
 *    inserir linhas direto no Prisma: competência de fatura, split de
 *    parcelas, Receivable automático e geração de assinatura são regras do
 *    domínio, e um seed que as reimplementasse produziria dados que PARECEM
 *    certos e violam os invariantes.
 *
 * 2. **Só banco local.** Aborta se o host não for reconhecidamente local.
 *
 * 3. **Nunca cria User nem toca em senha.** Localiza a conta pelo email.
 *
 * 4. **Idempotente.** Rodar duas vezes não duplica: cada entidade é procurada
 *    antes de ser criada, usando as garantias naturais (unique de
 *    SalaryHistory, `creationKey` de Subscription) ou a combinação estável dos
 *    próprios dados. Ambiguidade PARA o item e reporta.
 *
 * 5. **Não altera preferências do usuário.** `createExpenseOnDebtPaid` e
 *    `createIncomeOnReceivablePaid` ficam como estão — mudá-las para o dataset
 *    ficar mais bonito falsificaria o comportamento que se quer testar.
 *
 * ─── Uso ──────────────────────────────────────────────────────────────────
 *
 *   SEED_TARGET_EMAIL=... SEED_DRY_RUN=true npx ts-node scripts/seed-demo-2026.ts
 *   SEED_TARGET_EMAIL=... npx ts-node scripts/seed-demo-2026.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BanksService } from '../src/banks/banks.service';
import { CategoriesService } from '../src/categories/categories.service';
import { TransactionsService } from '../src/transactions/transactions.service';
import { PersonsService } from '../src/persons/persons.service';
import { DebtsService } from '../src/debts/debts.service';
import { ReceivablesService } from '../src/receivables/receivables.service';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { InvoicesService } from '../src/invoices/invoices.service';
import { SalaryService } from '../src/salary/salary.service';
import { TransactionType } from '@prisma/client';

const log = new Logger('seed-demo-2026');

const DRY_RUN = process.env.SEED_DRY_RUN === 'true';
const EMAIL = process.env.SEED_TARGET_EMAIL;

/** Hosts aceitos. Qualquer outro aborta antes de escrever. */
const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
]);

/** Contadores do relatório final. */
const report = {
  created: [] as string[],
  reused: [] as string[],
  skipped: [] as string[],
  problems: [] as string[],
};

function created(what: string) {
  report.created.push(what);
  log.log(`  + ${what}`);
}
function reused(what: string) {
  report.reused.push(what);
}
function skipped(why: string) {
  report.skipped.push(why);
  log.warn(`  ~ ${why}`);
}

/**
 * Verifica que o destino é um banco local.
 *
 * A senha nunca é impressa — só host, porta, database e schema.
 */
function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL não definida.');

  const url = new URL(raw);
  const schema = url.searchParams.get('schema') ?? '(default)';

  log.log('─── Destino ───');
  log.log(`host     : ${url.hostname}`);
  log.log(`port     : ${url.port || '5432'}`);
  log.log(`database : ${url.pathname.replace(/^\//, '')}`);
  log.log(`schema   : ${schema}`);

  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `ABORTADO: host "${url.hostname}" não é local. Este seed nunca deve ` +
        'rodar contra produção ou staging compartilhado.',
    );
  }
  log.log('host local confirmado.');
}

/** `YYYY-MM-DD` — o formato que os DTOs esperam. */
function d(month: number, day: number, year = 2026): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function main() {
  assertLocalDatabase();

  if (!EMAIL) {
    throw new Error('SEED_TARGET_EMAIL não definida.');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const prisma = app.get(PrismaService);
  const banks = app.get(BanksService);
  const categories = app.get(CategoriesService);
  const transactions = app.get(TransactionsService);
  const persons = app.get(PersonsService);
  const debts = app.get(DebtsService);
  const receivables = app.get(ReceivablesService);
  const subscriptions = app.get(SubscriptionsService);
  const invoices = app.get(InvoicesService);
  const salary = app.get(SalaryService);

  // ── Conta alvo ──
  const found = await prisma.user.findMany({
    where: { email: EMAIL },
    select: {
      id: true,
      email: true,
      name: true,
      createExpenseOnDebtPaid: true,
      createIncomeOnReceivablePaid: true,
    },
  });

  if (found.length === 0) {
    throw new Error(
      'A conta não existe no banco local. Cadastre-a pelo fluxo normal do ' +
        'aplicativo e execute o seed novamente.',
    );
  }
  if (found.length > 1) {
    throw new Error(
      `Inconsistência: ${found.length} usuários com o mesmo email. Abortado.`,
    );
  }

  const user = found[0];
  const userId = user.id;
  log.log('─── Conta ───');
  log.log(`${user.name} <${user.email}>`);
  log.log(`createExpenseOnDebtPaid      : ${user.createExpenseOnDebtPaid}`);
  log.log(`createIncomeOnReceivablePaid : ${user.createIncomeOnReceivablePaid}`);
  log.log(DRY_RUN ? '─── DRY RUN (nada será gravado) ───' : '─── Gravando ───');

  // ════════════════════════════════════════════════════════════════════════
  // Bancos
  // ════════════════════════════════════════════════════════════════════════
  async function ensureBank(
    name: string,
    invoiceDueDate: number,
    invoiceDueDaysAfterClose: number,
  ) {
    // `isSystem: false` exclui o banco técnico `__system_receivables__`.
    const existing = await prisma.bank.findFirst({
      where: { userId, name, isSystem: false },
    });
    if (existing) {
      reused(`Bank ${name}`);
      return existing;
    }
    if (DRY_RUN) {
      created(`Bank ${name} (dry-run)`);
      return { id: `dry-bank-${name}` } as { id: string };
    }
    const bank = await banks.create(userId, {
      name,
      invoiceDueDate,
      invoiceDueDaysAfterClose,
    } as never);
    created(`Bank ${name}`);
    return bank;
  }

  /*
    Nubank: vencimento dia 10, fechando 7 dias antes.
    Inter: usado como conta (salário, PIX, débito). O modelo exige configuração
    de fatura mesmo assim — valores neutros, sem inventar tipo Conta/Cartão.
  */
  const nubank = await ensureBank('Nubank', 10, 7);
  const inter = await ensureBank('Inter', 15, 7);

  // ════════════════════════════════════════════════════════════════════════
  // Categorias
  // ════════════════════════════════════════════════════════════════════════
  const CATEGORY_NAMES = [
    'Moradia',
    'Alimentação',
    'Transporte',
    'Saúde',
    'Lazer',
    'Educação',
    'Eletrônicos',
  ];
  const cat: Record<string, { id: string }> = {};

  for (const name of CATEGORY_NAMES) {
    const existing = await prisma.category.findFirst({
      where: { userId, name },
    });
    if (existing) {
      cat[name] = existing;
      reused(`Category ${name}`);
      continue;
    }
    if (DRY_RUN) {
      cat[name] = { id: `dry-cat-${name}` };
      created(`Category ${name} (dry-run)`);
      continue;
    }
    cat[name] = await categories.create(userId, { name } as never);
    created(`Category ${name}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // SalaryHistory — upsert idempotente pelo unique (userId, year, month)
  // ════════════════════════════════════════════════════════════════════════
  const SALARY = [
    { year: 2026, month: 1, amount: 4500 },
    { year: 2026, month: 4, amount: 5000 },
    { year: 2026, month: 8, amount: 5500 },
  ];
  for (const entry of SALARY) {
    if (DRY_RUN) {
      created(`Salary ${entry.year}-${entry.month} = ${entry.amount} (dry-run)`);
      continue;
    }
    const before = await prisma.salaryHistory.findFirst({
      where: { userId, year: entry.year, month: entry.month },
    });
    await salary.upsert(userId, entry);
    // Upsert é idempotente pelo unique — distinguir criação de atualização
    // mantém o contador do relatório honesto entre execuções.
    if (before) reused(`Salary ${entry.year}-${entry.month}`);
    else created(`Salary ${entry.year}-${entry.month} = ${entry.amount}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Transações
  // ════════════════════════════════════════════════════════════════════════
  interface TxSpec {
    bankId: string;
    categoryId: string;
    title: string;
    type: TransactionType;
    amount: number;
    date: string;
    installments?: number;
    personId?: string;
    isRefund?: boolean;
  }

  /**
   * Cria uma transação se não existir uma equivalente.
   *
   * A chave de idempotência é a combinação estável do próprio dado
   * (título + valor + data + banco + tipo). Para parcelamentos o `amount`
   * enviado é o TOTAL e o backend divide, então a busca usa o título raiz.
   */
  async function ensureTransaction(spec: TxSpec, label = spec.title) {
    const base = {
      userId,
      bankId: spec.bankId,
      type: spec.type,
      date: new Date(`${spec.date}T12:00:00.000Z`),
    };

    const matches = await prisma.transaction.findMany({
      where: spec.installments
        ? // Parcelado: a raiz tem o sufixo " 1/N" no título.
          { ...base, title: { startsWith: spec.title } }
        : { ...base, title: spec.title, amount: spec.amount },
      select: { id: true, title: true },
    });

    if (matches.length > 0) {
      reused(`Transaction ${label}`);
      return null;
    }

    if (DRY_RUN) {
      created(
        `Transaction ${label} ${spec.amount}${spec.installments ? ` em ${spec.installments}x` : ''} (dry-run)`,
      );
      return null;
    }

    const result = await transactions.create(userId, spec as never);
    created(
      `Transaction ${label} ${spec.amount}${spec.installments ? ` em ${spec.installments}x` : ''}`,
    );
    return result;
  }

  // ── Receitas realizadas (Transaction INCOME, distinta de SalaryHistory) ──
  const SALARIOS: Array<[number, number]> = [
    [1, 4500],
    [2, 4500],
    [3, 4500],
    [4, 5000],
    [5, 5000],
    [6, 5000],
    [7, 5000],
    [8, 5500],
  ];
  for (const [month, amount] of SALARIOS) {
    await ensureTransaction(
      {
        bankId: inter.id,
        categoryId: cat['Educação'].id, // receita não tem categoria própria no modelo
        title: 'Salário',
        type: TransactionType.INCOME,
        amount,
        date: d(month, 5),
      },
      `Salário ${month}/2026`,
    );
  }
  await ensureTransaction({
    bankId: inter.id,
    categoryId: cat['Educação'].id,
    title: 'Freelance',
    type: TransactionType.INCOME,
    amount: 800,
    date: d(6, 18),
  });

  // ── Moradia ──
  for (let month = 1; month <= 8; month++) {
    await ensureTransaction(
      {
        bankId: inter.id,
        categoryId: cat['Moradia'].id,
        title: 'Aluguel',
        type: TransactionType.PIX,
        amount: 1500,
        date: d(month, 6),
      },
      `Aluguel ${month}/2026`,
    );
  }

  const ENERGIA = [198.42, 214.7, 230.15, 205.8, 221.9, 246.3, 233.1, 219.6];
  for (let i = 0; i < ENERGIA.length; i++) {
    await ensureTransaction(
      {
        bankId: inter.id,
        categoryId: cat['Moradia'].id,
        title: 'Conta de energia',
        type: TransactionType.BOLETO,
        amount: ENERGIA[i],
        date: d(i + 1, 10),
      },
      `Energia ${i + 1}/2026`,
    );
  }

  for (let month = 1; month <= 8; month++) {
    await ensureTransaction(
      {
        bankId: inter.id,
        categoryId: cat['Moradia'].id,
        title: 'Internet',
        type: TransactionType.BOLETO,
        amount: 119.9,
        date: d(month, 12),
      },
      `Internet ${month}/2026`,
    );
    await ensureTransaction(
      {
        bankId: inter.id,
        categoryId: cat['Moradia'].id,
        title: 'Plano de celular',
        type: TransactionType.PIX,
        amount: 59.9,
        date: d(month, 15),
      },
      `Celular ${month}/2026`,
    );
  }

  // ── Supermercado no crédito: a competência é do planner, não daqui ──
  const MERCADO = [620.35, 688.2, 742.6, 701.15, 755.4, 789.9, 812.3, 430.75];
  for (let i = 0; i < MERCADO.length; i++) {
    await ensureTransaction(
      {
        bankId: nubank.id,
        categoryId: cat['Alimentação'].id,
        title: 'Supermercado',
        type: TransactionType.CREDIT_CARD,
        amount: MERCADO[i],
        date: d(i + 1, 18),
      },
      `Supermercado ${i + 1}/2026`,
    );
  }

  // ── Transporte ──
  const COMBUSTIVEL: Array<[number, number, number]> = [
    [1, 22, 220],
    [2, 22, 245],
    [3, 22, 260],
    [4, 22, 235],
    [5, 22, 280],
    [6, 22, 310],
    [7, 22, 295],
    [8, 18, 180],
  ];
  for (const [month, day, amount] of COMBUSTIVEL) {
    await ensureTransaction(
      {
        bankId: inter.id,
        categoryId: cat['Transporte'].id,
        title: 'Combustível',
        type: TransactionType.DEBIT_CARD,
        amount,
        date: d(month, day),
      },
      `Combustível ${month}/2026`,
    );
  }

  // ── Lazer no crédito ──
  const LAZER: Array<[number, number, number]> = [
    [1, 25, 145],
    [2, 25, 189.9],
    [3, 25, 132.5],
    [4, 25, 210],
    [5, 25, 175.4],
    [6, 25, 198],
    [7, 25, 220],
    [8, 17, 96.5],
  ];
  for (const [month, day, amount] of LAZER) {
    await ensureTransaction(
      {
        bankId: nubank.id,
        categoryId: cat['Lazer'].id,
        title: 'Restaurante e lazer',
        type: TransactionType.CREDIT_CARD,
        amount,
        date: d(month, day),
      },
      `Lazer ${month}/2026`,
    );
  }

  /*
    Estorno próprio: reduz o gasto da categoria, não vira receita.
    Sem `personId` — estorno de terceiro é bloqueado pelo domínio.
  */
  await ensureTransaction(
    {
      bankId: nubank.id,
      categoryId: cat['Lazer'].id,
      title: 'Estorno restaurante',
      type: TransactionType.CREDIT_CARD,
      amount: 50,
      date: d(4, 28),
      isRefund: true,
    },
    'Estorno Lazer 4/2026',
  );

  // ── Saúde ──
  await ensureTransaction(
    {
      bankId: inter.id,
      categoryId: cat['Saúde'].id,
      title: 'Farmácia',
      type: TransactionType.DEBIT_CARD,
      amount: 86.4,
      date: d(3, 14),
    },
    'Farmácia 3/2026',
  );
  await ensureTransaction(
    {
      bankId: inter.id,
      categoryId: cat['Saúde'].id,
      title: 'Farmácia',
      type: TransactionType.DEBIT_CARD,
      amount: 124.7,
      date: d(5, 11),
    },
    'Farmácia 5/2026',
  );
  await ensureTransaction(
    {
      bankId: inter.id,
      categoryId: cat['Saúde'].id,
      title: 'Consulta',
      type: TransactionType.PIX,
      amount: 180,
      date: d(7, 16),
    },
    'Consulta 7/2026',
  );

  // ── Parcelamentos: `amount` é o TOTAL; o backend divide ──
  await ensureTransaction({
    bankId: nubank.id,
    categoryId: cat['Eletrônicos'].id,
    title: 'Notebook',
    type: TransactionType.CREDIT_CARD,
    amount: 3200,
    date: d(2, 12),
    installments: 10,
  });
  await ensureTransaction({
    bankId: nubank.id,
    categoryId: cat['Eletrônicos'].id,
    title: 'Cadeira de escritório',
    type: TransactionType.CREDIT_CARD,
    amount: 900,
    date: d(5, 10),
    installments: 3,
  });

  // ════════════════════════════════════════════════════════════════════════
  // Pessoas
  // ════════════════════════════════════════════════════════════════════════
  async function ensurePerson(name: string) {
    const existing = await prisma.person.findFirst({ where: { userId, name } });
    if (existing) {
      reused(`Person ${name}`);
      return existing;
    }
    if (DRY_RUN) {
      created(`Person ${name} (dry-run)`);
      return { id: `dry-person-${name}` } as { id: string };
    }
    // Sem telefone: um número fictício geraria link de WhatsApp para alguém real.
    const person = await persons.create(userId, { name } as never);
    created(`Person ${name}`);
    return person;
  }

  const mariana = await ensurePerson('Mariana Souza');
  const rafael = await ensurePerson('Rafael Lima');

  // ── Compras para a Mariana: o Receivable automático é criado pelo domínio ──
  await ensureTransaction({
    bankId: nubank.id,
    categoryId: cat['Lazer'].id,
    title: 'Passagem aérea da Mariana',
    type: TransactionType.CREDIT_CARD,
    amount: 900,
    date: d(3, 22),
    installments: 3,
    personId: mariana.id,
  });
  await ensureTransaction({
    bankId: nubank.id,
    categoryId: cat['Lazer'].id,
    title: 'Jantar dividido',
    type: TransactionType.CREDIT_CARD,
    amount: 240,
    date: d(8, 16),
    personId: mariana.id,
  });

  // ════════════════════════════════════════════════════════════════════════
  // Assinaturas — geração retroativa pelo service real
  // ════════════════════════════════════════════════════════════════════════
  const SUBS = [
    {
      key: 'seed-demo-2026:netflix',
      title: 'Netflix',
      amount: 44.9,
      type: TransactionType.CREDIT_CARD,
      bankId: nubank.id,
      dayOfMonth: 8,
      startedAt: '2026-01',
    },
    {
      key: 'seed-demo-2026:spotify',
      title: 'Spotify',
      amount: 21.9,
      type: TransactionType.CREDIT_CARD,
      bankId: nubank.id,
      dayOfMonth: 15,
      startedAt: '2026-01',
    },
    {
      key: 'seed-demo-2026:prime',
      title: 'Prime',
      amount: 19.9,
      type: TransactionType.CREDIT_CARD,
      bankId: nubank.id,
      dayOfMonth: 20,
      startedAt: '2026-03',
    },
    {
      key: 'seed-demo-2026:academia',
      title: 'Academia',
      amount: 99.9,
      type: TransactionType.PIX,
      bankId: inter.id,
      dayOfMonth: 3,
      startedAt: '2026-02',
    },
  ];

  for (const sub of SUBS) {
    const existing = await prisma.subscription.findFirst({
      where: { userId, creationKey: sub.key },
    });
    if (existing) {
      reused(`Subscription ${sub.title}`);
      continue;
    }
    if (DRY_RUN) {
      created(`Subscription ${sub.title} (dry-run)`);
      continue;
    }
    // Sem `categoryId`: exercita a categoria de sistema "Assinatura".
    await subscriptions.create(userId, {
      title: sub.title,
      bankId: sub.bankId,
      type: sub.type,
      amount: sub.amount,
      dayOfMonth: sub.dayOfMonth,
      startedAt: sub.startedAt,
      creationKey: sub.key,
    } as never);
    created(`Subscription ${sub.title}`);
  }

  if (!DRY_RUN) {
    // Geração retroativa: a mesma rotina que o runner do dashboard usa.
    const results = await subscriptions.runForUser(userId, new Date(), 'dashboard');
    // `generated` é a lista de ciclos criados; `failure` indica aborto.
    const generated = results.reduce((sum, r) => sum + r.generated.length, 0);
    const failures = results.filter((r) => r.failure);
    log.log(`  + Geração de assinaturas: ${generated} lançamento(s)`);
    for (const f of failures) {
      skipped(`Assinatura ${f.title}: ${f.failure?.reason}`);
    }
    if (generated > 0) {
      created(`Assinaturas geradas: ${generated} lançamentos`);
    } else {
      // Normal em re-execução: `create()` já gerou os ciclos retroativos.
      reused('Assinaturas: nenhum ciclo pendente');
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Dívidas
  // ════════════════════════════════════════════════════════════════════════
  async function ensureDebt(spec: {
    title: string;
    creditorName: string;
    amount: number;
    occurredAt: string;
    dueDate: string;
  }) {
    const existing = await prisma.debt.findFirst({
      where: { userId, title: spec.title, amount: spec.amount },
    });
    if (existing) {
      reused(`Debt ${spec.title}`);
      return existing;
    }
    if (DRY_RUN) {
      created(`Debt ${spec.title} (dry-run)`);
      return null;
    }
    const debt = await debts.create(userId, spec as never);
    created(`Debt ${spec.title}`);
    return Array.isArray(debt) ? debt[0] : debt;
  }

  await ensureDebt({
    title: 'Curso online',
    creditorName: 'Plataforma de cursos',
    amount: 420,
    occurredAt: d(8, 1),
    dueDate: d(8, 25),
  });

  const dentista = await ensureDebt({
    title: 'Dentista',
    creditorName: 'Clínica odontológica',
    amount: 600,
    occurredAt: d(7, 10),
    dueDate: d(7, 20),
  });

  /*
    Marcar paga pelo fluxo real. Com `createExpenseOnDebtPaid = false` o
    domínio NÃO cria transação-espelho — e isso é o comportamento correto a
    testar, não algo a contornar mudando a preferência do usuário.
  */
  if (!DRY_RUN && dentista && !dentista.isPaid) {
    await debts.update(dentista.id, userId, {
      isPaid: true,
      paymentDate: d(7, 25),
      ...(user.createExpenseOnDebtPaid
        ? { paymentBankId: inter.id, paymentType: TransactionType.PIX }
        : {}),
    } as never);
    created('Debt Dentista marcada como paga (25/07)');
  }

  // ════════════════════════════════════════════════════════════════════════
  // Recebíveis manuais
  // ════════════════════════════════════════════════════════════════════════
  async function ensureReceivable(spec: {
    title: string;
    personId: string;
    amount: number;
    occurredAt: string;
    dueDate: string;
  }) {
    const existing = await prisma.receivable.findFirst({
      where: { userId, title: spec.title, amount: spec.amount },
    });
    if (existing) {
      reused(`Receivable ${spec.title}`);
      return existing;
    }
    if (DRY_RUN) {
      created(`Receivable ${spec.title} (dry-run)`);
      return null;
    }
    const r = await receivables.create(userId, spec as never);
    created(`Receivable ${spec.title}`);
    return Array.isArray(r) ? r[0] : r;
  }

  await ensureReceivable({
    title: 'Reembolso de viagem',
    personId: rafael.id,
    amount: 350,
    occurredAt: d(8, 10),
    dueDate: d(8, 28),
  });

  const ingresso = await ensureReceivable({
    title: 'Ingresso do show',
    personId: rafael.id,
    amount: 180,
    occurredAt: d(6, 1),
    dueDate: d(6, 15),
  });

  if (!DRY_RUN && ingresso && !ingresso.isPaid) {
    await receivables.update(ingresso.id, userId, {
      isPaid: true,
      paymentDate: d(6, 14),
      ...(user.createIncomeOnReceivablePaid
        ? { paymentBankId: inter.id, paymentType: TransactionType.PIX }
        : {}),
    } as never);
    created('Receivable Ingresso do show marcado como recebido (14/06)');
  }

  // ── Recebíveis automáticos da passagem: receber os DOIS primeiros ──
  if (!DRY_RUN) {
    const autoReceivables = await prisma.receivable.findMany({
      where: {
        userId,
        personId: mariana.id,
        transactionId: { not: null },
        title: { startsWith: 'Passagem aérea da Mariana' },
      },
      orderBy: { dueDate: 'asc' },
    });

    if (autoReceivables.length !== 3) {
      skipped(
        `Esperava 3 recebíveis automáticos da passagem, encontrei ${autoReceivables.length}`,
      );
    }

    for (const r of autoReceivables.slice(0, 2)) {
      if (r.isPaid) {
        reused(`Receivable automático ${r.title} (já recebido)`);
        continue;
      }
      const due = r.dueDate.toISOString().slice(0, 10);
      await receivables.update(r.id, userId, {
        isPaid: true,
        paymentDate: due,
        ...(user.createIncomeOnReceivablePaid
          ? { paymentBankId: inter.id, paymentType: TransactionType.PIX }
          : {}),
      } as never);
      created(`Receivable automático ${r.title} recebido em ${due}`);
    }
    // O terceiro fica PENDENTE de propósito: alimenta "Atenção agora".
  }

  // ════════════════════════════════════════════════════════════════════════
  // Faturas históricas — por último, para não pular ciclos de assinatura
  // ════════════════════════════════════════════════════════════════════════
  if (!DRY_RUN) {
    const all = await invoices.findAll(userId, { bankId: nubank.id } as never);
    const hoje = new Date();

    for (const inv of all as Array<{
      id: string;
      month: number;
      year: number;
      status: string;
      dueDate: Date | string;
      totalAmount: unknown;
    }>) {
      if (inv.status === 'PAID') {
        reused(`Invoice ${inv.month}/${inv.year} (já paga)`);
        continue;
      }
      if (Number(inv.totalAmount) === 0) continue;

      const due = new Date(inv.dueDate);
      // Só o que já venceu. A fatura corrente/futura fica como os helpers
      // deixaram (OPEN/CLOSED) — é o estado que se quer ver na tela.
      if (due >= hoje) {
        skipped(
          `Invoice ${inv.month}/${inv.year} não vencida — mantida ${inv.status}`,
        );
        continue;
      }
      await invoices.update(inv.id, userId, { status: 'PAID' } as never);
      created(`Invoice ${inv.month}/${inv.year} marcada PAID`);
    }
  }

  // ── Relatório ──
  log.log('─── Resumo ───');
  log.log(`criados : ${report.created.length}`);
  log.log(`reusados: ${report.reused.length}`);
  log.log(`pulados : ${report.skipped.length}`);
  if (report.problems.length) {
    log.warn(`problemas: ${report.problems.join(' | ')}`);
  }

  await app.close();
}

main().catch((error) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
