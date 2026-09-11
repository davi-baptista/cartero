import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BanksService } from './banks.service';
import type { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeBank, makeInvoice } from 'src/common/testing/fixtures';
import { planBillingConfigUpdate } from './billing-config-plan.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Alteração do ciclo de faturamento — integração (Fase 6B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O plano puro é testado em `billing-config-plan.spec.ts`. Aqui interessa o
 * que o serviço FAZ com ele: o que grava, o que não toca, e se a prévia
 * projeta exatamente o mesmo conjunto que o save aplica.
 *
 * ─── Por que o relógio é congelado ────────────────────────────────────────
 *
 * `planBillingConfigUpdate` aceita `today` injetável, e o spec puro passa uma
 * data em toda chamada. Aqui o caminho é o SERVIÇO, que não expõe esse
 * parâmetro: ele usa `new Date()` internamente, de propósito — é produção.
 *
 * A elegibilidade depende do presente. Uma fatura só acompanha a nova
 * configuração se ainda estiver aberta HOJE: `isEffectivelyOpen` exige status
 * `OPEN` E datas que confirmem a abertura, porque o cron roda uma vez por dia
 * e a coluna pode estar atrasada.
 *
 * As fixtures são de setembro/2026 e os testes foram escritos em 22/08/2026,
 * quando aquela fatura estava legitimamente aberta. Com o relógio real, os
 * casos passaram a falhar sozinhos em 01/09/2026 — o fechamento chegou e a
 * fatura virou `EFFECTIVELY_CLOSED`. Nenhum commit quebrou nada: os testes
 * expiraram.
 *
 * Duas chamadas soltas de `vi.useRealTimers()` no meio do arquivo descongelavam
 * o relógio para tudo que vinha depois, e era por isso que apenas dois casos
 * sobreviviam. O congelamento agora é do arquivo inteiro, restaurado a cada
 * teste — teste de data não pode depender do dia em que roda.
 */

/**
 * Presente canônico do arquivo: a fatura de setembro/2026 (fecha 01/09) está
 * aberta, e a de agosto já é histórico. É a data em que estes casos foram
 * escritos, então descrevem o mesmo cenário de sempre.
 */
const NOW = new Date('2026-08-20T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

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
      /**
       * O duplo HONRA o `where`, como o Prisma.
       *
       * Devolver a lista fixa fazia o teste ser cego a um filtro na ORIGEM: o
       * serviço podia passar a consultar só `status: 'OPEN'` e nenhum caso
       * falharia, embora a prévia perdesse os motivos `HISTORICAL_STATUS` que
       * ela reporta — a decisão de elegibilidade pertence ao plano, não à
       * query. É o mesmo recurso de `budget-temporality.spec.ts`.
       */
      findMany: vi.fn(async ({ where }: any = {}) => {
        const all = setup.invoices ?? [];
        return all.filter((invoice: any) =>
          Object.entries(where ?? {}).every(
            ([field, expected]) => invoice[field] === expected,
          ),
        );
      }),
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

/**
 * O relógio congelado é premissa do arquivo, não detalhe de implementação.
 *
 * Sem esta vigilância, remover o `beforeEach` devolveria a suíte ao estado em
 * que ela apodrecia sozinha na virada do mês — e nenhum outro teste apontaria
 * a causa, porque todos falhariam com o mesmo sintoma genérico de "nada foi
 * gravado".
 */
describe('premissa temporal do arquivo', () => {
  it('a fatura de setembro está aberta no presente canônico', () => {
    expect(new Date().toISOString()).toBe(NOW.toISOString());

    const september = septemberOpen();
    expect(september.closeDate.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('a elegibilidade depende do presente — não do dia em que o teste roda', () => {
    /**
     * Prova a mecânica que quebrou os 11 casos: a MESMA fatura, o MESMO plano,
     * dois presentes diferentes. Depois do fechamento ela vira
     * `EFFECTIVELY_CLOSED` e para de acompanhar a configuração nova — que é o
     * comportamento correto, e por isso os testes precisam fixar a data.
     */
    const invoice = septemberOpen() as any;
    const schedules = {
      current: { invoiceDueDate: 8, invoiceDueDaysAfterClose: 7 },
      next: { invoiceDueDate: 15, invoiceDueDaysAfterClose: 7 },
    };

    const antes = planBillingConfigUpdate({
      ...schedules,
      invoices: [invoice],
      today: NOW,
    });
    expect(antes.changes).toHaveLength(1);

    const depois = planBillingConfigUpdate({
      ...schedules,
      invoices: [invoice],
      today: new Date('2026-09-11T12:00:00Z'),
    });
    expect(depois.changes).toHaveLength(0);
    expect(depois.skipped[0].reason).toBe('EFFECTIVELY_CLOSED');
  });
});

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

    // Vencimento 28/08 → 05/08, que já passou no presente do arquivo (20/08).
    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 5,
      invoiceDueDaysAfterClose: 3,
    } as any);

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

  it('a consulta carrega TODOS os status — quem filtra é o plano', async () => {
    /**
     * Teste discriminante: sem ele, mover a elegibilidade para o `where` da
     * query (`status: 'OPEN'`) passaria despercebido, porque o resultado
     * gravado seria o mesmo.
     *
     * A separação importa. O plano distingue `HISTORICAL_STATUS` de
     * `EFFECTIVELY_CLOSED` — uma fatura gravada como `OPEN` cujo fechamento já
     * passou é recusada por motivo diferente de uma `CLOSED`. Filtrar na
     * origem destruiria essa distinção e, pior, uma futura contagem de
     * recusadas passaria a ignorar justamente o histórico que ela deveria
     * explicar.
     */
    const harness = buildHarness({
      invoices: [
        makeInvoice({ id: 'paga', month: 7, year: 2026, status: 'PAID' }),
        septemberOpen('aberta'),
      ],
    });

    await harness.service.update('bank-1', USER_ID, {
      invoiceDueDate: 15,
    } as any);

    const where = harness.prisma.invoice.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ bankId: 'bank-1', userId: USER_ID });
    expect(where.status).toBeUndefined();
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

    const preview = await harness.service.previewBillingConfig(
      'bank-1',
      USER_ID,
      { invoiceDueDate: 5, invoiceDueDaysAfterClose: 3 } as any,
    );

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
