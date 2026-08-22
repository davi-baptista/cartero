import { describe, expect, it, vi } from 'vitest';
import { BanksService } from './banks.service';
import type { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, makeInvoice } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Alteração do ciclo de faturamento — integração (Fase 6B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O plano puro é testado em `billing-config-plan.spec.ts`. Aqui interessa o
 * que o serviço FAZ com ele: o que grava, o que não toca, e se a prévia
 * projeta exatamente o mesmo conjunto que o save aplica.
 */

interface Setup {
  bank?: ReturnType<typeof makeBank>;
  invoices?: any[];
  /** Cobranças pendentes automáticas contadas pela prévia. */
  pendingReceivables?: number;
}

function buildHarness(setup: Setup = {}) {
  const bank = setup.bank ?? makeBank({ invoiceDueDate: 8 });

  const writes = {
    invoiceUpdates: [] as any[],
    receivableUpdates: [] as any[],
    bankUpdates: [] as any[],
  };

  const prisma: any = {
    bank: {
      findUnique: vi.fn().mockResolvedValue(bank),
      update: vi.fn(async ({ data }: any) => {
        writes.bankUpdates.push(data);
        return { ...bank, ...data };
      }),
    },
    invoice: {
      findMany: vi.fn(async () => setup.invoices ?? []),
      update: vi.fn(async (args: any) => {
        writes.invoiceUpdates.push({ id: args.where.id, ...args.data });
        return args.data;
      }),
    },
    receivable: {
      updateMany: vi.fn(async (args: any) => {
        writes.receivableUpdates.push(args);
        return { count: setup.pendingReceivables ?? 0 };
      }),
      count: vi.fn(async () => setup.pendingReceivables ?? 0),
    },
    transaction: { count: vi.fn(async () => 0) },
    subscription: { count: vi.fn(async () => 0) },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));

  const validation = {
    validateBank: vi.fn().mockResolvedValue(bank),
  } as unknown as EntityValidationService;

  return {
    service: new BanksService(prisma as unknown as PrismaService, validation),
    prisma,
    writes,
    bank,
  };
}

/** Fatura de setembro/2026 pelo calendário "vence dia 8, fecha 7 antes". */
function septemberOpen(id = 'inv-set') {
  return makeInvoice({
    id,
    month: 9,
    year: 2026,
    status: 'OPEN',
    schedule: { invoiceDueDate: 8, invoiceDueDaysAfterClose: 7 },
  });
}

const isoDay = (value: Date) => value.toISOString().slice(0, 10);

describe('update do ciclo — o que é gravado', () => {
  it('persiste as novas datas da fatura em aberto', async () => {
    const harness = buildHarness({ invoices: [septemberOpen()] });

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    expect(harness.writes.invoiceUpdates).toHaveLength(1);
    const update = harness.writes.invoiceUpdates[0];
    expect(update.id).toBe('inv-set');
    expect(isoDay(update.dueDate)).toBe('2026-09-15');
    expect(isoDay(update.closeDate)).toBe('2026-09-08');
  });

  it('grava closeDate e dueDate distintos — não o mesmo valor nos dois', async () => {
    // Guarda contra um erro de digitação fácil de cometer e difícil de notar:
    // atribuir `dueDate` às duas colunas.
    const harness = buildHarness({ invoices: [septemberOpen()] });

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    const update = harness.writes.invoiceUpdates[0];
    expect(update.closeDate.getTime()).not.toBe(update.dueDate.getTime());
  });

  it('não toca em month, year, totalAmount nem invoiceId', async () => {
    const harness = buildHarness({ invoices: [septemberOpen()] });

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    const update = harness.writes.invoiceUpdates[0];
    expect(update.month).toBeUndefined();
    expect(update.year).toBeUndefined();
    expect(update.totalAmount).toBeUndefined();
    // Transações não são reclassificadas: nada aqui escreve em `transaction`.
    expect(harness.prisma.transaction.count).not.toHaveBeenCalled();
  });

  it('grava o status derivado junto das datas', async () => {
    const harness = buildHarness({
      invoices: [
        makeInvoice({
          id: 'inv',
          month: 8,
          year: 2026,
          status: 'OPEN',
          schedule: { invoiceDueDate: 28, invoiceDueDaysAfterClose: 7 },
        }),
      ],
    });

    // Vencimento 28/08 → 05/08, que já passou em 20/08.
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 5,
      invoiceDueDaysAfterClose: 3,
    } as any);
    vi.useRealTimers();

    expect(harness.writes.invoiceUpdates[0].status).toBe('OVERDUE');
  });

  it('não escreve fatura nenhuma quando só o nome muda', async () => {
    const harness = buildHarness({ invoices: [septemberOpen()] });

    await harness.service.update('bank-1', USER_ID, { name: 'Outro' } as any);

    expect(harness.writes.invoiceUpdates).toHaveLength(0);
    expect(harness.writes.receivableUpdates).toHaveLength(0);
  });

  it('faturas históricas não recebem update', async () => {
    const harness = buildHarness({
      invoices: [
        makeInvoice({ id: 'paga', month: 7, year: 2026, status: 'PAID' }),
        makeInvoice({ id: 'fechada', month: 8, year: 2026, status: 'CLOSED' }),
        septemberOpen('aberta'),
      ],
    });

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    expect(harness.writes.invoiceUpdates.map((u) => u.id)).toEqual(['aberta']);
  });

  it('tudo passa pela mesma transação de banco', async () => {
    // Banco com a configuração nova e faturas nas datas antigas seria um
    // estado que nada corrige depois — o plano já não saberia quais ficaram
    // para trás, porque a configuração "atual" passou a ser a nova.
    const harness = buildHarness({ invoices: [septemberOpen()] });

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('update do ciclo — cobranças de terceiros', () => {
  it('cobranças automáticas pendentes acompanham o novo vencimento', async () => {
    const harness = buildHarness({ invoices: [septemberOpen()] });

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    expect(harness.writes.receivableUpdates).toHaveLength(1);
    const call = harness.writes.receivableUpdates[0];
    expect(isoDay(call.data.dueDate)).toBe('2026-09-15');
  });

  it('exclui as manuais pelo vínculo estrutural, não por título', async () => {
    // Cobrança criada à mão tem vencimento escolhido pelo usuário e não
    // deriva do cartão. O filtro é `transactionId: not null` — relação real,
    // nunca comparação de nome.
    const harness = buildHarness({ invoices: [septemberOpen()] });

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    const where = harness.writes.receivableUpdates[0].where;
    expect(where.transactionId).toEqual({ not: null });
    expect(where.transaction).toEqual({ invoiceId: 'inv-set' });
  });

  it('exclui as já recebidas — fato financeiro concluído', async () => {
    const harness = buildHarness({ invoices: [septemberOpen()] });

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    expect(harness.writes.receivableUpdates[0].where.isPaid).toBe(false);
  });

  it('não mexe em cobranças quando nenhuma fatura muda', async () => {
    const harness = buildHarness({
      invoices: [makeInvoice({ id: 'paga', status: 'PAID' })],
    });

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    expect(harness.writes.receivableUpdates).toHaveLength(0);
  });
});

describe('previewBillingConfig', () => {
  it('projeta as faturas afetadas sem escrever nada', async () => {
    const harness = buildHarness({
      invoices: [septemberOpen(), makeInvoice({ id: 'paga', status: 'PAID' })],
    });

    const preview = await harness.service.previewBillingConfig(
      'bank-1',
      USER_ID,
      { invoiceDueDate: 15 } as any,
    );

    expect(preview.affectedCount).toBe(1);
    expect(harness.writes.invoiceUpdates).toHaveLength(0);
    expect(harness.writes.bankUpdates).toHaveLength(0);
    expect(harness.writes.receivableUpdates).toHaveLength(0);
  });

  it('devolve antes e depois de cada data', async () => {
    const harness = buildHarness({ invoices: [septemberOpen()] });

    const preview = await harness.service.previewBillingConfig(
      'bank-1',
      USER_ID,
      { invoiceDueDate: 15 } as any,
    );

    const change = preview.changes[0];
    expect(change.dueDate.before.slice(0, 10)).toBe('2026-09-08');
    expect(change.dueDate.after.slice(0, 10)).toBe('2026-09-15');
  });

  it('conta as faturas que mudam de status', async () => {
    const harness = buildHarness({
      invoices: [
        makeInvoice({
          id: 'vira-overdue',
          month: 8,
          year: 2026,
          status: 'OPEN',
          schedule: { invoiceDueDate: 28, invoiceDueDaysAfterClose: 7 },
        }),
        makeInvoice({
          id: 'segue-aberta',
          month: 12,
          year: 2026,
          status: 'OPEN',
          schedule: { invoiceDueDate: 28, invoiceDueDaysAfterClose: 7 },
        }),
      ],
    });

    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
    const preview = await harness.service.previewBillingConfig(
      'bank-1',
      USER_ID,
      { invoiceDueDate: 5, invoiceDueDaysAfterClose: 3 } as any,
    );
    vi.useRealTimers();

    expect(preview.affectedCount).toBe(2);
    expect(preview.statusChangeCount).toBe(1);
  });

  it('conta as cobranças pendentes que serão atualizadas', async () => {
    const harness = buildHarness({
      invoices: [septemberOpen()],
      pendingReceivables: 3,
    });

    const preview = await harness.service.previewBillingConfig(
      'bank-1',
      USER_ID,
      { invoiceDueDate: 15 } as any,
    );

    expect(preview.pendingReceivables).toBe(3);
  });

  it('sinaliza quando o ciclo não muda — a interface não abre confirmação', async () => {
    const harness = buildHarness({ invoices: [septemberOpen()] });

    const preview = await harness.service.previewBillingConfig(
      'bank-1',
      USER_ID,
      { name: 'Outro nome' } as any,
    );

    expect(preview.scheduleUnchanged).toBe(true);
    expect(preview.affectedCount).toBe(0);
  });

  it('não consulta cobranças quando nada é afetado', async () => {
    const harness = buildHarness({
      invoices: [makeInvoice({ id: 'paga', status: 'PAID' })],
    });

    await harness.service.previewBillingConfig('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    expect(harness.prisma.receivable.count).not.toHaveBeenCalled();
  });
});

describe('preview e update concordam', () => {
  /**
   * Mesma exigência das prévias de transação: os dois consomem
   * `planBillingConfigUpdate`, então projeção e gravação não podem divergir.
   * O teste executa os dois sobre o mesmo cenário e compara.
   */
  it.each([
    ['mudança de vencimento', { invoiceDueDate: 15 }],
    ['mudança de intervalo', { invoiceDueDaysAfterClose: 20 }],
    ['mudança de ambos', { invoiceDueDate: 22, invoiceDueDaysAfterClose: 12 }],
  ])('%s: mesmas faturas e mesmas datas', async (_label, dto) => {
    const scenario = () => ({
      invoices: [
        septemberOpen('set'),
        makeInvoice({
          id: 'out',
          month: 10,
          year: 2026,
          status: 'OPEN',
          schedule: { invoiceDueDate: 8, invoiceDueDaysAfterClose: 7 },
        }),
        makeInvoice({ id: 'paga', month: 7, year: 2026, status: 'PAID' }),
      ],
    });

    const previewHarness = buildHarness(scenario());
    const preview = await previewHarness.service.previewBillingConfig(
      'bank-1',
      USER_ID,
      dto as any,
    );

    const updateHarness = buildHarness(scenario());
    await updateHarness.service.update('bank-1', USER_ID, dto as any);

    const applied = updateHarness.writes.invoiceUpdates;

    expect(preview.affectedCount).toBe(applied.length);
    expect(preview.changes.map((c) => c.invoiceId)).toEqual(
      applied.map((u) => u.id),
    );
    expect(preview.changes.map((c) => c.dueDate.after)).toEqual(
      applied.map((u) => u.dueDate.toISOString()),
    );
    expect(preview.changes.map((c) => c.closeDate.after)).toEqual(
      applied.map((u) => u.closeDate.toISOString()),
    );
    expect(preview.changes.map((c) => c.status.after)).toEqual(
      applied.map((u) => u.status),
    );
  });
});

describe('banco arquivado', () => {
  it('segue a mesma política — arquivar não congela faturas em aberto', async () => {
    // Arquivar significa "não usar para novas movimentações", não "histórico
    // intocável". Um cartão encerrado pode ter faturas futuras de um
    // parcelamento, e elas continuam acompanhando a configuração.
    const harness = buildHarness({
      bank: makeBank({ invoiceDueDate: 8, isArchived: true }),
      invoices: [septemberOpen()],
    });

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    expect(harness.writes.invoiceUpdates).toHaveLength(1);
    expect(isoDay(harness.writes.invoiceUpdates[0].dueDate)).toBe('2026-09-15');
  });
});
