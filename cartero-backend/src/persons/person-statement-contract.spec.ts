import { describe, expect, it, vi } from 'vitest';
import { PersonsService } from './persons.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Contrato de `GET /persons/:id/statement` (Fase 8C)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O extrato carrega DOIS universos, e o defeito que esta fase fecha era eles
 * compartilharem nomes:
 *
 *   `totalDebts` significava "dívidas do mês" antes da Fase 8B e "todas as
 *   dívidas pendentes" depois. O mesmo campo, dois universos — e nenhum
 *   consumidor tinha como saber qual versão da implementação estava rodando.
 *
 * Agora:
 *
 *   `summary` + `pending` → situação ATUAL, sem corte temporal
 *   `period`              → universo TEMPORAL, recortado por `paidAt`
 *
 * Este arquivo prova que os dois coexistem sem colidir, e que os espelhos
 * ambíguos não voltaram.
 */

interface Setup {
  pendingDebts?: any[];
  pendingReceivables?: any[];
  settledDebts?: any[];
  settledReceivables?: any[];
}

const debt = (
  id: string,
  amount: number,
  dueDate: string,
  paidAt?: string,
) => ({
  id,
  userId: USER_ID,
  personId: 'person-1',
  parentId: null,
  paymentTransactionId: null,
  title: `Dívida ${id}`,
  creditorName: 'Eva',
  amount: money(amount),
  description: null,
  occurredAt: new Date(`${dueDate}T12:00:00.000Z`),
  dueDate: new Date(`${dueDate}T12:00:00.000Z`),
  isAlertEnabled: true,
  isPaid: Boolean(paidAt),
  paidAt: paidAt ? new Date(`${paidAt}T12:00:00.000Z`) : null,
});

const receivable = (
  id: string,
  amount: number,
  dueDate: string,
  paidAt?: string,
) => ({
  id,
  userId: USER_ID,
  personId: 'person-1',
  parentId: null,
  transactionId: null,
  paymentTransactionId: null,
  title: `Cobrança ${id}`,
  debtorName: 'Eva',
  amount: money(amount),
  description: null,
  occurredAt: new Date(`${dueDate}T12:00:00.000Z`),
  dueDate: new Date(`${dueDate}T12:00:00.000Z`),
  isPaid: Boolean(paidAt),
  paidAt: paidAt ? new Date(`${paidAt}T12:00:00.000Z`) : null,
});

function buildHarness(setup: Setup = {}) {
  /** Os `where` de cada consulta, para inspecionar o recorte aplicado. */
  const queries = { debt: [] as any[], receivable: [] as any[] };

  const prisma: any = {
    person: {
      findUnique: vi.fn(async () => ({
        id: 'person-1',
        userId: USER_ID,
        name: 'Eva',
        phone: null,
      })),
    },
    debt: {
      findMany: vi.fn(async ({ where }: any) => {
        queries.debt.push(where);
        // O serviço faz duas consultas: pendentes e histórico. Responde por
        // filtro, para que o teste veja os dois universos de verdade.
        return where.isPaid === false
          ? (setup.pendingDebts ?? [])
          : (setup.settledDebts ?? []);
      }),
    },
    receivable: {
      findMany: vi.fn(async ({ where }: any) => {
        queries.receivable.push(where);
        return where.isPaid === false
          ? (setup.pendingReceivables ?? [])
          : (setup.settledReceivables ?? []);
      }),
    },
  };

  const validation = new EntityValidationService(prisma as PrismaService);

  return {
    service: new PersonsService(prisma as PrismaService, validation),
    queries,
  };
}

/**
 * Cenário canônico da Fase 8B/8C — pendências em três meses distintos.
 *
 *   Dívida    junho   R$ 200  pendente (em atraso)
 *   Dívida    agosto  R$ 100  pendente
 *   Cobrança  julho   R$ 500  pendente (em atraso)
 *   Cobrança  agosto  R$ 300  pendente
 *
 * Consolidado: 800 a receber, 300 a pagar, saldo +500, 4 pendências.
 */
const CENARIO: Setup = {
  pendingDebts: [
    debt('d-jun', 200, '2026-06-05'),
    debt('d-ago', 100, '2026-08-20'),
  ],
  pendingReceivables: [
    receivable('r-jul', 500, '2026-07-10'),
    receivable('r-ago', 300, '2026-08-15'),
  ],
  // Quitados em agosto: pertencem ao período, não ao consolidado.
  settledDebts: [debt('d-mai', 90, '2026-05-01', '2026-08-03')],
  settledReceivables: [receivable('r-mai', 40, '2026-05-02', '2026-08-04')],
};

const AGOSTO = { startDate: '2026-08-01', endDate: '2026-08-31' };

describe('summary é all-time, mesmo com filtro de agosto', () => {
  it('soma junho, julho e agosto', async () => {
    const harness = buildHarness(CENARIO);

    const result = await harness.service.getStatement(
      'person-1',
      USER_ID,
      AGOSTO as any,
    );

    expect(result.summary.receivablePending).toBe(800);
    expect(result.summary.debtPending).toBe(300);
    expect(result.summary.netBalance).toBe(500);
    expect(result.summary.pendingReceivablesCount).toBe(2);
    expect(result.summary.pendingDebtsCount).toBe(2);
  });

  it('a consulta de pendências ignora datas', async () => {
    const harness = buildHarness(CENARIO);

    await harness.service.getStatement('person-1', USER_ID, AGOSTO as any);

    const pendingWhere = harness.queries.debt.find(
      (where) => where.isPaid === false,
    );
    // Nem `dueDate` nem `paidAt`: pendência não tem recorte temporal.
    expect(pendingWhere).not.toHaveProperty('dueDate');
    expect(pendingWhere).not.toHaveProperty('paidAt');
  });

  it('pending lista as quatro pendências', async () => {
    const harness = buildHarness(CENARIO);

    const result = await harness.service.getStatement(
      'person-1',
      USER_ID,
      AGOSTO as any,
    );

    const ids = [
      ...result.pending.debts.map((d) => d.id),
      ...result.pending.receivables.map((r) => r.id),
    ];
    expect(ids).toEqual(
      expect.arrayContaining(['d-jun', 'd-ago', 'r-jul', 'r-ago']),
    );
  });
});

describe('period é temporal e recortado por paidAt', () => {
  it('filtra por paidAt, nunca por dueDate', async () => {
    /**
     * A distinção importa: uma dívida vencida em maio e paga em agosto
     * pertence ao histórico de AGOSTO — é quando o dinheiro se moveu. Filtrar
     * por `dueDate` a jogaria em maio, onde nada aconteceu.
     */
    const harness = buildHarness(CENARIO);

    await harness.service.getStatement('person-1', USER_ID, AGOSTO as any);

    const historyWhere = harness.queries.debt.find(
      (where) => where.isPaid === true,
    );
    expect(historyWhere).toHaveProperty('paidAt');
    expect(historyWhere).not.toHaveProperty('dueDate');
  });

  it('declara o recorte aplicado', async () => {
    // Sem isso o consumidor não distingue "nada foi quitado em agosto" de
    // "nenhum filtro foi enviado".
    const harness = buildHarness(CENARIO);

    const result = await harness.service.getStatement(
      'person-1',
      USER_ID,
      AGOSTO as any,
    );

    expect(result.period.appliedRange).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });
    expect(result.period.scopedBy).toBe('paidAt');
  });

  it('sem filtro, o recorte é nulo — não zero', async () => {
    const harness = buildHarness(CENARIO);

    const result = await harness.service.getStatement('person-1', USER_ID, {});

    expect(result.period.appliedRange).toEqual({
      startDate: null,
      endDate: null,
    });
  });

  it('os totais do período NÃO se misturam ao consolidado', async () => {
    const harness = buildHarness(CENARIO);

    const result = await harness.service.getStatement(
      'person-1',
      USER_ID,
      AGOSTO as any,
    );

    // Quitados em agosto: 90 e 40. Pendentes: 300 e 800. Universos separados.
    expect(result.period.settledDebtTotal).toBe(90);
    expect(result.period.settledReceivableTotal).toBe(40);
    expect(result.summary.debtPending).toBe(300);
    expect(result.summary.receivablePending).toBe(800);
  });
});

describe('Os espelhos ambíguos não existem mais', () => {
  it.each([
    'totalDebts',
    'totalReceivables',
    'netBalance',
    'debts',
    'receivables',
  ])('a resposta não expõe `%s`', async (field) => {
    /**
     * Estes nomes carregavam dois significados dependendo da versão. Mantê-los
     * como alias faria qualquer consumidor calcular certo por acidente — ou
     * errado sem aviso nenhum.
     *
     * `netBalance` continua existindo DENTRO de `summary`, onde o nome tem um
     * único significado possível.
     */
    const harness = buildHarness(CENARIO);

    const result = await harness.service.getStatement(
      'person-1',
      USER_ID,
      AGOSTO as any,
    );

    expect(result).not.toHaveProperty(field);
  });
});

describe('Saldo zero all-time com pendências abertas', () => {
  const zerado: Setup = {
    pendingDebts: [debt('d1', 500, '2026-06-01')],
    pendingReceivables: [receivable('r1', 500, '2026-07-01')],
    settledDebts: [],
    settledReceivables: [],
  };

  it('net 0 mas duas pendências', async () => {
    const harness = buildHarness(zerado);

    const result = await harness.service.getStatement(
      'person-1',
      USER_ID,
      AGOSTO as any,
    );

    expect(result.summary.netBalance).toBe(0);
    expect(result.summary.pendingDebtsCount).toBe(1);
    expect(result.summary.pendingReceivablesCount).toBe(1);
    expect(result.summary.isFullySettled).toBe(false);
  });

  it('período vazio NÃO implica quitação', async () => {
    /**
     * Agosto sem nada quitado + saldo líquido zero é a combinação mais
     * perigosa: as duas leituras isoladas sugerem "está tudo resolvido",
     * enquanto existem R$ 500 abertos de cada lado.
     */
    const harness = buildHarness(zerado);

    const result = await harness.service.getStatement(
      'person-1',
      USER_ID,
      AGOSTO as any,
    );

    expect(result.period.settledDebts).toHaveLength(0);
    expect(result.period.settledReceivables).toHaveLength(0);
    // A conclusão sai das CONTAGENS de pendência, não do período nem do saldo.
    expect(result.summary.isFullySettled).toBe(false);
  });
});

describe('Performance', () => {
  it('quatro consultas, sem N+1', async () => {
    // Duas por domínio (pendente + histórico), independente da quantidade de
    // itens. Nada é buscado por registro.
    const harness = buildHarness(CENARIO);

    await harness.service.getStatement('person-1', USER_ID, AGOSTO as any);

    expect(harness.queries.debt).toHaveLength(2);
    expect(harness.queries.receivable).toHaveLength(2);
  });
});
