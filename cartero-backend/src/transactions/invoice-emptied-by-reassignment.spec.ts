import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TransactionsService } from './transactions.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import {
  USER_ID,
  makeBank,
  makeInvoice,
  makeTransaction,
  money,
  utcDate,
} from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A fatura que fica vazia quando a transação SAI dela
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `remove` sempre soube limpar: decrementa o `totalAmount` e, se a fatura
 * zerou, apaga a fatura — não faz sentido guardar um ciclo sem lançamento
 * nenhum.
 *
 * `update` faz metade disso. Quando a edição muda `date`, `bankId`, `type`,
 * `amount` ou `isRefund`, a transação é REATRIBUÍDA: a fatura antiga recebe o
 * decremento e a nova é resolvida por `findOrCreateInvoice`. O decremento
 * acontece; a limpeza, não.
 *
 * O resultado é uma fatura de R$ 0,00 sem transações — que continua sendo
 * listada, ganha status pelo cron e aparece na visão mensal como se o cartão
 * tivesse tido um ciclo naquele mês.
 *
 * O caso mais fácil de produzir é mover a ÚNICA transação de uma fatura para
 * outro banco: a fatura de origem fica órfã no banco de origem.
 *
 * ── Por que isso importa para o relato de produção ──
 *
 * O usuário viu uma fatura de R$ 0,00 num banco onde não esperava ter
 * fatura. Este caminho produz exatamente esse estado, e sem depender de
 * "banco sem cartão" — conceito que o schema não tem (`invoiceCloseDate` e
 * `invoiceDueDate` são `Int` obrigatórios, então todo banco tem ciclo).
 */

const BANK_ORIGEM = 'bank-origem';
const BANK_DESTINO = 'bank-destino';
const INVOICE_ORIGEM = 'inv-origem';

function buildHarness() {
  /* Única transação da fatura de origem: ao sair, a fatura zera. */
  const transaction = makeTransaction({
    id: 'tx-1',
    bankId: BANK_ORIGEM,
    amount: money(400),
    date: utcDate(2026, 5, 10),
    invoiceId: INVOICE_ORIGEM,
    type: 'CREDIT_CARD',
    parentId: null,
  });

  const invoiceOrigem = makeInvoice({
    id: INVOICE_ORIGEM,
    bankId: BANK_ORIGEM,
    month: 5,
    year: 2026,
    status: 'OPEN',
    totalAmount: money(400),
  });

  /** Cada `invoice.delete` que o service pediu. */
  const invoiceDeletes: string[] = [];
  /** Cada `invoice.update`, com o id e o `data` enviado. */
  const invoiceUpdates: Array<{ id: string; data: any }> = [];

  const prisma: any = {
    bank: {
      findUnique: vi.fn(async ({ where }: any) =>
        makeBank({ id: where.id, invoiceDueDate: 10 }),
      ),
      findFirst: vi.fn(async ({ where }: any) =>
        makeBank({ id: where.id, invoiceDueDate: 10 }),
      ),
    },
    transaction: {
      findUnique: vi.fn(async () => transaction),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => [transaction]),
      update: vi.fn(async () => transaction),
      updateMany: vi.fn(async () => ({ count: 1 })),
      delete: vi.fn(async () => transaction),
      count: vi.fn(async () => 0),
    },
    invoice: {
      findUniqueOrThrow: vi.fn(async () => ({ status: 'OPEN' })),
      findUnique: vi.fn(async () => invoiceOrigem),
      findFirst: vi.fn(async ({ where }: any) => {
        /*
          A fatura do DESTINO não existe: é isso que faz `findOrCreateInvoice`
          criá-la, exatamente como em produção.
        */
        if (where?.bankId === BANK_DESTINO) return null;
        return invoiceOrigem;
      }),
      create: vi.fn(async ({ data }: any) => ({
        ...invoiceOrigem,
        id: 'inv-destino',
        bankId: data.bankId,
        month: data.month,
        year: data.year,
        totalAmount: money(0),
      })),
      update: vi.fn(async ({ where, data }: any) => {
        invoiceUpdates.push({ id: where.id, data });
        /*
          Reproduz o efeito do decremento: a única transação saiu, então a
          fatura de origem chega a zero.
        */
        return { ...invoiceOrigem, totalAmount: money(0) };
      }),
      delete: vi.fn(async ({ where }: any) => {
        invoiceDeletes.push(where.id);
        return invoiceOrigem;
      }),
    },
    receivable: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 0),
    },
    debt: { findFirst: vi.fn(async () => null) },
    category: { findFirst: vi.fn(async () => ({ id: 'cat-1' })) },
    $transaction: vi.fn(async (fn: any) => await fn(prisma)),
  };

  const validation = {
    validateTransaction: vi.fn(async () => transaction),
    validateBank: vi.fn(async () => makeBank({ invoiceDueDate: 10 })),
    validateCategory: vi.fn(async () => ({ id: 'cat-1' })),
    validatePerson: vi.fn(async () => ({ id: 'p-1' })),
    findOrCreateSystemCategory: vi.fn(async () => ({ id: 'cat-sys' })),
  };

  const service = new TransactionsService(
    prisma as PrismaService,
    validation as unknown as EntityValidationService,
  );

  return { service, prisma, invoiceDeletes, invoiceUpdates, transaction };
}

describe('mover a única transação de uma fatura', () => {
  it('não deixa a fatura de origem vazia no banco', async () => {
    /*
      A REPRODUÇÃO da vulnerabilidade.

      `remove` faz `if (totalAmount === 0) delete invoice`. O caminho de
      reatribuição do `update` decrementa e para ali — a fatura de R$ 0,00
      fica no banco, é listada, recebe status pelo cron e aparece na visão
      mensal como um ciclo que nunca existiu.
    */
    const h = buildHarness();

    await h.service.update(
      'tx-1',
      USER_ID,
      { bankId: BANK_DESTINO } as never,
      'ONE' as never,
    );

    /* A origem foi decrementada — o caminho de reatribuição rodou. */
    expect(h.invoiceUpdates.some((u) => u.id === INVOICE_ORIGEM)).toBe(true);

    /* E, tendo zerado, precisa ter sido apagada. */
    expect(h.invoiceDeletes).toContain(INVOICE_ORIGEM);
  });

  it('a fatura que AINDA tem lançamento é preservada', async () => {
    /*
      O contrapeso: a limpeza não pode apagar uma fatura que só ficou menor.
      Aqui o decremento deixa saldo, e nada deve ser removido.
    */
    const h = buildHarness();
    h.prisma.invoice.update = vi.fn(async ({ where, data }: any) => {
      h.invoiceUpdates.push({ id: where.id, data });
      /* Sobrou saldo: havia outras transações na fatura. */
      return { id: where.id, bankId: BANK_ORIGEM, totalAmount: money(150) };
    });

    await h.service.update(
      'tx-1',
      USER_ID,
      { bankId: BANK_DESTINO } as never,
      'ONE' as never,
    );

    expect(h.invoiceDeletes).toHaveLength(0);
  });
});

describe('a limpeza tem uma dona só', () => {
  /*
    Caminho a partir da raiz, e não `import.meta.url`: este backend compila
    para CommonJS, onde `import.meta` não existe — a mesma restrição que
    `source-delete-capability.spec.ts` já documenta.
  */
  const ler = (path: string) =>
    readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  const CONSUMIDORES = [
    ['transações', 'src/transactions/transactions.service.ts'],
    ['dívidas', 'src/debts/debts.service.ts'],
    ['cobranças', 'src/receivables/receivables.service.ts'],
    ['quitação', 'src/common/helpers/settlement.core.ts'],
  ] as const;

  it('ninguém repete a condição à mão', () => {
    /*
      Era assim que a lacuna nasceu: a condição existia copiada em quatro
      fluxos, todos corretos, e o quinto — a reatribuição do `update` — foi
      escrito sem ela. Com uma dona só, esquecer deixa de ser possível.
    */
    for (const [nome, caminho] of CONSUMIDORES) {
      const fonte = ler(caminho);
      expect(fonte, `${nome} voltou a decidir por conta própria`).not.toMatch(
        /Number\(\s*invoice\.totalAmount\s*\)\s*===\s*0/,
      );
      expect(fonte, `${nome} não usa a política`).toContain(
        'deleteInvoiceIfEmpty',
      );
    }
  });

  it('o único `invoice.delete` de limpeza vive no helper', () => {
    /*
      `settlement.core` também apaga a fatura ao desfazer uma quitação, e
      agora pelo helper. Qualquer `invoice.delete` solto nos consumidores
      seria uma segunda política.
    */
    for (const [nome, caminho] of CONSUMIDORES) {
      expect(ler(caminho), nome).not.toContain('invoice.delete(');
    }
    expect(ler('src/common/helpers/invoice.helper.ts')).toContain(
      'tx.invoice.delete(',
    );
  });
});
