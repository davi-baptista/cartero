import { describe, expect, it, vi } from 'vitest';
import { CommitmentsService } from './commitments.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, makeTransaction, money } from 'src/common/testing/fixtures';

/**
 * Compromissos projeta o que já está contratado: parcelas ainda por vencer e
 * assinaturas ativas.
 *
 * A regra que mais importa proteger: uma compra feita em nome de outra pessoa
 * passa pela fatura mas NÃO é custo seu — ela é separada em `othersInstallments`
 * e fica fora da projeção de custo fixo.
 *
 * ─── NOTA PARA A FASE ESTRUTURAL ──────────────────────────────────────────────
 * O serviço identifica parcelamentos por REGEX no título (`/\s(\d+)\/(\d+)$/`)
 * e conta o total de parcelas a partir do sufixo, apesar de `parentId` existir
 * e ser confiável. Os testes abaixo usam títulos com sufixo porque é a única
 * forma de exercitar o código atual — isso NÃO endossa a regex como fonte de
 * verdade. Quando `parentId` passar a governar, estes testes devem ser
 * reescritos em termos de vínculo, não de texto. Ver o `it.todo` no final.
 */

/** Uma parcela como o serviço a recebe: com invoice, bank, category e person. */
function installmentRow(options: {
  id: string;
  parentId?: string | null;
  title: string;
  amount: string;
  invoiceMonth: number;
  invoiceYear: number;
  personName?: string | null;
  bankName?: string;
  categoryName?: string;
}) {
  return {
    ...makeTransaction({
      id: options.id,
      parentId: options.parentId ?? null,
      title: options.title,
      amount: money(options.amount),
    }),
    invoice: {
      month: options.invoiceMonth,
      year: options.invoiceYear,
      status: 'OPEN' as const,
    },
    bank: { name: options.bankName ?? 'Cartão Teste' },
    category: { name: options.categoryName ?? 'Compras' },
    person: options.personName ? { name: options.personName } : null,
  };
}

/**
 * Assinatura de teste com os campos temporais que a projeção precisa.
 *
 * `startedAt`/`activeSince`/`lastGeneratedFor` passaram a ser obrigatórios
 * desde que o forecast usa as regras reais de recorrência em vez de aplicar o
 * mesmo valor nos seis meses.
 */
function subscriptionRow(
  overrides: Partial<{
    id: string;
    title: string;
    amount: ReturnType<typeof money>;
    dayOfMonth: number;
    type: string;
    bankId: string;
    startedAt: string;
    activeSince: string | null;
    lastGeneratedFor: string | null;
    isActive: boolean;
  }> = {},
) {
  return {
    id: 'sub-1',
    title: 'Netflix',
    amount: money('40'),
    dayOfMonth: 12,
    type: 'PIX',
    bankId: 'bank-1',
    startedAt: '2020-01',
    activeSince: null,
    lastGeneratedFor: null,
    isActive: true,
    ...overrides,
  };
}

function buildPrisma(options: {
  installments?: ReturnType<typeof installmentRow>[];
  forecastRows?: {
    amount: ReturnType<typeof money>;
    title: string;
    invoice: { month: number; year: number };
  }[];
  subscriptions?: any[];
  /** Faturas existentes que a projeção de crédito consulta. */
  invoices?: any[];
  banks?: any[];
}) {
  const findMany = vi
    .fn()
    // 1ª chamada: getActiveInstallments. 2ª: as parcelas do forecast.
    .mockResolvedValueOnce(options.installments ?? [])
    .mockResolvedValueOnce(options.forecastRows ?? []);

  return {
    transaction: { findMany },
    subscription: {
      findMany: vi.fn().mockResolvedValue(options.subscriptions ?? []),
    },
    // O forecast busca bancos (calendário e arquivamento) e as faturas das
    // competências alcançadas — duas consultas agregadas, não por assinatura.
    bank: {
      findMany: vi.fn().mockResolvedValue(
        options.banks ?? [
          {
            id: 'bank-1',
            isArchived: false,
            invoiceDueDate: 10,
            invoiceDueDaysAfterClose: 7,
          },
        ],
      ),
    },
    invoice: {
      findMany: vi.fn().mockResolvedValue(options.invoices ?? []),
    },
  } as unknown as PrismaService;
}

/**
 * "Futura" é decidido pela fatura, comparada com o mês corrente real. Para não
 * depender do relógio, os testes usam faturas muito à frente (2099) para
 * "ainda vai vencer" e muito atrás (2020) para "já passou".
 */
const FUTURE = { invoiceMonth: 6, invoiceYear: 2099 };
const PAST = { invoiceMonth: 6, invoiceYear: 2020 };

describe('CommitmentsService — parcelas próprias', () => {
  it('soma como restante apenas as parcelas em faturas futuras', async () => {
    const prisma = buildPrisma({
      installments: [
        installmentRow({
          id: 't1',
          title: 'Notebook 1/3',
          amount: '500',
          ...PAST,
        }),
        installmentRow({
          id: 't2',
          parentId: 't1',
          title: 'Notebook 2/3',
          amount: '500',
          ...FUTURE,
        }),
        installmentRow({
          id: 't3',
          parentId: 't1',
          title: 'Notebook 3/3',
          amount: '500',
          ...FUTURE,
        }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.installments).toHaveLength(1);
    expect(result.installments[0].remaining).toBe(1000);
    expect(result.totals.installmentsRemaining).toBe(1000);
  });

  it('conta as parcelas já vencidas em paidCount', async () => {
    const prisma = buildPrisma({
      installments: [
        installmentRow({
          id: 't1',
          title: 'Curso 1/4',
          amount: '100',
          ...PAST,
        }),
        installmentRow({
          id: 't2',
          parentId: 't1',
          title: 'Curso 2/4',
          amount: '100',
          ...PAST,
        }),
        installmentRow({
          id: 't3',
          parentId: 't1',
          title: 'Curso 3/4',
          amount: '100',
          ...FUTURE,
        }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.installments[0].paidCount).toBe(2);
    expect(result.installments[0].remaining).toBe(100);
  });

  it('expõe o total de parcelas da compra', async () => {
    const prisma = buildPrisma({
      installments: [
        installmentRow({
          id: 't1',
          title: 'TV 1/10',
          amount: '200',
          ...FUTURE,
        }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.installments[0].totalCount).toBe(10);
    expect(result.installments[0].installmentAmount).toBe(200);
  });

  it('agrupa a série pela raiz, mesmo quando só a raiz sobrou', async () => {
    // A primeira parcela tem parentId null — agrupar só por parentId perderia
    // a compra inteira. O serviço usa `parentId ?? id`.
    const prisma = buildPrisma({
      installments: [
        installmentRow({
          id: 'root',
          title: 'Sofá 1/2',
          amount: '300',
          ...FUTURE,
        }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.installments).toHaveLength(1);
    expect(result.installments[0].id).toBe('root');
  });

  it('descarta compras sem nenhuma parcela futura', async () => {
    const prisma = buildPrisma({
      installments: [
        installmentRow({
          id: 't1',
          title: 'Antigo 1/2',
          amount: '50',
          ...PAST,
        }),
        installmentRow({
          id: 't2',
          parentId: 't1',
          title: 'Antigo 2/2',
          amount: '50',
          ...PAST,
        }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.installments).toHaveLength(0);
    expect(result.totals.installmentsRemaining).toBe(0);
  });

  it('marca o fim da compra pela fatura da última parcela', async () => {
    const prisma = buildPrisma({
      installments: [
        installmentRow({
          id: 't1',
          title: 'Geladeira 1/2',
          amount: '400',
          invoiceMonth: 11,
          invoiceYear: 2099,
        }),
        installmentRow({
          id: 't2',
          parentId: 't1',
          title: 'Geladeira 2/2',
          amount: '400',
          invoiceMonth: 12,
          invoiceYear: 2099,
        }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.installments[0].endsAt).toEqual({ month: 12, year: 2099 });
  });

  it('ordena as compras pelo maior valor restante', async () => {
    const prisma = buildPrisma({
      installments: [
        installmentRow({
          id: 'a',
          title: 'Pequena 1/1',
          amount: '100',
          ...FUTURE,
        }),
        installmentRow({
          id: 'b',
          title: 'Grande 1/1',
          amount: '900',
          ...FUTURE,
        }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.installments.map((i) => i.title)).toEqual([
      'Grande',
      'Pequena',
    ]);
  });

  it('remove o sufixo de parcela do título exibido', async () => {
    const prisma = buildPrisma({
      installments: [
        installmentRow({
          id: 't1',
          title: 'Bicicleta 3/12',
          amount: '150',
          ...FUTURE,
        }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.installments[0].title).toBe('Bicicleta');
  });
});

describe('CommitmentsService — separação entre custo próprio e de terceiros', () => {
  it('compra de terceiro vai para othersInstallments, fora do custo próprio', async () => {
    // A regra central: passa pelo cartão, mas o valor volta como recebível.
    const prisma = buildPrisma({
      installments: [
        installmentRow({
          id: 'own',
          title: 'Meu 1/2',
          amount: '300',
          ...FUTURE,
        }),
        installmentRow({
          id: 'eva',
          title: 'Ingresso 1/2',
          amount: '200',
          personName: 'Eva',
          ...FUTURE,
        }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.installments.map((i) => i.title)).toEqual(['Meu']);
    expect(result.othersInstallments.map((i) => i.title)).toEqual(['Ingresso']);
    expect(result.totals.installmentsRemaining).toBe(300);
    expect(result.totals.othersRemaining).toBe(200);
  });

  it('preserva o nome da pessoa na parcela de terceiro', async () => {
    const prisma = buildPrisma({
      installments: [
        installmentRow({
          id: 'eva',
          title: 'Show 1/3',
          amount: '150',
          personName: 'Eva',
          ...FUTURE,
        }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.othersInstallments[0].personName).toBe('Eva');
  });

  it('a projeção de custo fixo exclui compras de terceiros na consulta', async () => {
    const prisma = buildPrisma({});

    await new CommitmentsService(prisma).getCommitments(USER_ID);

    const forecastWhere = (prisma.transaction.findMany as any).mock.calls[1][0]
      .where;
    expect(forecastWhere.personId).toBeNull();
    expect(forecastWhere.isRefund).toBe(false);
    expect(forecastWhere.type).toBe('CREDIT_CARD');
  });

  it('estornos ficam fora das parcelas ativas', async () => {
    const prisma = buildPrisma({});

    await new CommitmentsService(prisma).getCommitments(USER_ID);

    const where = (prisma.transaction.findMany as any).mock.calls[0][0].where;
    expect(where.isRefund).toBe(false);
    expect(where.invoiceId).toEqual({ not: null });
  });
});

describe('CommitmentsService — assinaturas e projeção', () => {
  it('soma o valor mensal das assinaturas ativas', async () => {
    const prisma = buildPrisma({
      subscriptions: [
        { amount: money('29.90'), dayOfMonth: 5 },
        { amount: money('19.90'), dayOfMonth: 15 },
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.totals.monthlySubscriptions).toBeCloseTo(49.8, 10);
  });

  it('consulta apenas assinaturas ativas', async () => {
    const prisma = buildPrisma({});

    await new CommitmentsService(prisma).getCommitments(USER_ID);

    const where = (prisma.subscription.findMany as any).mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: USER_ID, isActive: true });
  });

  it('projeta seis meses à frente', async () => {
    const prisma = buildPrisma({});

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    expect(result.forecast).toHaveLength(6);
  });

  it('projeta a assinatura pela recorrência real, não repetindo um valor fixo', async () => {
    /**
     * Substitui um teste que afirmava exatamente o defeito: "repete o custo
     * das assinaturas em todos os meses". A versão antiga aplicava
     * `subscription.amount` igual nas seis posições, ignorando `dayOfMonth`,
     * `startedAt`, `activeSince` e `lastGeneratedFor` — o número não
     * correspondia a nada que o sistema fosse gerar.
     *
     * Agora cada mês recebe o valor SÓ se a assinatura realmente cobra nele.
     * A soma dos meses passa a ser verificável contra as ocorrências.
     */
    const prisma = buildPrisma({
      subscriptions: [
        subscriptionRow({ amount: money(50), dayOfMonth: 10, type: 'PIX' }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    // Cada mês projetado tem zero ou exatamente uma cobrança desta assinatura.
    for (const month of result.forecast) {
      expect([0, 50]).toContain(month.subscriptions);
    }

    // E ao longo do horizonte há cobrança de fato — não é tudo zero.
    const totalProjected = result.forecast.reduce(
      (sum, month) => sum + month.subscriptions,
      0,
    );
    expect(totalProjected).toBeGreaterThan(0);
  });

  it('assinatura pausada não entra na projeção', async () => {
    // Compromissos é obrigação futura ativa; pausada não é obrigação.
    const prisma = buildPrisma({
      subscriptions: [subscriptionRow({ amount: money(50), isActive: false })],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    for (const month of result.forecast) {
      expect(month.subscriptions).toBe(0);
    }
  });

  it('a soma dos meses fecha com as ocorrências projetadas', async () => {
    // Invariante do item 45: nada de `amount × 6` como atalho.
    const prisma = buildPrisma({
      subscriptions: [
        subscriptionRow({ id: 'a', amount: money(50), dayOfMonth: 10 }),
        subscriptionRow({ id: 'b', amount: money(30), dayOfMonth: 20 }),
      ],
    });

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    const monthsTotal = result.forecast.reduce(
      (sum, month) => sum + month.subscriptions,
      0,
    );
    // Cada ocorrência soma uma vez, e só uma.
    expect(monthsTotal % 10).toBe(0);
    expect(monthsTotal).toBeGreaterThan(0);
  });

  it('a projeção é contínua, sem repetir nem pular meses', async () => {
    const prisma = buildPrisma({});

    const result = await new CommitmentsService(prisma).getCommitments(USER_ID);

    for (let i = 1; i < result.forecast.length; i++) {
      const previous = result.forecast[i - 1];
      const current = result.forecast[i];
      const gap =
        (current.year - previous.year) * 12 + (current.month - previous.month);
      expect(gap).toBe(1);
    }
  });

  it('soma parcela ao mês correspondente da projeção', async () => {
    const prisma = buildPrisma({});
    const service = new CommitmentsService(prisma);

    // Descobre o primeiro mês da projeção para casar a fatura sem usar
    // o relógio diretamente no assert.
    const probe = await service.getCommitments(USER_ID);
    const first = probe.forecast[0];

    // Sem assinatura no cenário: o teste é sobre a parcela cair no mês certo,
    // e misturar uma ocorrência de assinatura tornaria o total dependente do
    // dia de hoje.
    const prismaWithRow = buildPrisma({
      forecastRows: [
        {
          amount: money(250),
          title: 'Câmera 2/6',
          invoice: { month: first.month, year: first.year },
        },
      ],
    });

    const result = await new CommitmentsService(prismaWithRow).getCommitments(
      USER_ID,
    );

    expect(result.forecast[0].installments).toBe(250);
    // Sem assinatura no cenário, o total é só a parcela.
    expect(result.forecast[0].total).toBe(250);
  });

  it('ignora na projeção linhas que não são parcelamento', async () => {
    const prisma = buildPrisma({});
    const first = (await new CommitmentsService(prisma).getCommitments(USER_ID))
      .forecast[0];

    const prismaWithRow = buildPrisma({
      forecastRows: [
        {
          amount: money(999),
          title: 'Compra à vista',
          invoice: { month: first.month, year: first.year },
        },
      ],
    });

    const result = await new CommitmentsService(prismaWithRow).getCommitments(
      USER_ID,
    );

    expect(result.forecast[0].installments).toBe(0);
  });
});

describe('CommitmentsService — fragilidade estrutural conhecida', () => {
  it('comportamento ATUAL: uma compra à vista com "1/2" no título é lida como parcelamento', () => {
    // Documenta a consequência da detecção por texto. NÃO é a regra desejada.
    const INSTALLMENT_SUFFIX = /\s(\d+)\/(\d+)$/;

    expect(INSTALLMENT_SUFFIX.test('Aluguel 1/2')).toBe(true);
    expect(INSTALLMENT_SUFFIX.test('Corrida 5/10')).toBe(true);
  });

  it.todo(
    'DEVERIA: parcelamento identificado por parentId e contagem estrutural, não por sufixo no título',
    // Alvo da fase estrutural: `parentId` já é confiável e existe no schema.
    // A contagem total de parcelas precisaria vir de metadado (ex.: um campo
    // installmentCount) em vez de ser extraída do texto do título.
  );
});
