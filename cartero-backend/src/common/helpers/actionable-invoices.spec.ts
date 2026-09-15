import { describe, expect, it } from 'vitest';
import { InvoiceStatus } from '@prisma/client';
import {
  ACTIONABLE_INVOICES_DEFAULT_LIMIT,
  ACTIONABLE_INVOICES_MAX_LIMIT,
  selectActionableInvoices,
  type ActionableInvoiceCandidate,
} from './actionable-invoices.helper';
import { money, utcDate } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A política ACTIONABLE, agora como authority backend (M5A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Estes cenários reproduzem deliberadamente os do Web
 * (`cartero-frontend/src/lib/bank-ordering.spec.ts`,
 * `bank-month-priority.spec.ts`) como especificação de paridade — o código
 * não foi importado, só o comportamento. Ver M5A §33.
 *
 * Datas ancoradas em 3h UTC: é a mesma âncora que
 * `invoice.helper.ts#dateForDayUtc` usa para persistir `closeDate`/`dueDate`
 * de verdade — testar com meio-dia UTC provaria uma authority que nunca
 * recebe esse dado em produção.
 */

interface InvoiceOverrides {
  bankName: string;
  status: InvoiceStatus;
  closeDate: [number, number, number];
  dueDate: [number, number, number];
  totalAmount?: ActionableInvoiceCandidate['totalAmount'];
  reimbursable?: ActionableInvoiceCandidate['reimbursable'];
  /**
   * Identidade do banco. Default = o próprio `bankName`: nos cenários que já
   * existiam, cada nome já representava um banco distinto, então o default
   * preserva o comportamento sem reescrevê-los. Os testes de M5A.1/M5A.2
   * passam `bankId` explícito para simular múltiplas invoices do MESMO banco,
   * ou bancos distintos com o MESMO nome.
   */
  bankId?: string;
  /**
   * Fallback técnico de desempate (M5A.2) — sem significado financeiro.
   * Default único por chamada: sem isso, testes que criam várias invoices
   * sem especificar `invoiceId` colidiriam silenciosamente no fallback e
   * mascarariam o que estão testando de verdade (competência, por exemplo).
   */
  invoiceId?: string;
  /**
   * Competência (M5A.2). Default = extraída de `closeDate`: no domínio real
   * a competência normalmente casa com o mês de fechamento, e a maioria dos
   * cenários já existentes não testa competência — só precisa de UM valor
   * estável e coerente com as datas informadas.
   */
  year?: number;
  month?: number;
}

let nextInvoiceId = 0;

function invoice(over: InvoiceOverrides): ActionableInvoiceCandidate {
  const [closeYear, closeMonth] = over.closeDate;
  return {
    bankId: over.bankId ?? over.bankName,
    bankName: over.bankName,
    invoiceId: over.invoiceId ?? `auto-invoice-${nextInvoiceId++}`,
    year: over.year ?? closeYear,
    month: over.month ?? closeMonth,
    status: over.status,
    totalAmount: over.totalAmount ?? money('100'),
    closeDate: utcDate(...over.closeDate, 3),
    dueDate: utcDate(...over.dueDate, 3),
    reimbursable: over.reimbursable ?? money('0'),
  };
}

describe('surface fechada (A1, A2)', () => {
  it('devolve somente os campos aprovados', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankName: 'Banco X',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
        }),
      ],
      3,
    );

    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]).sort()).toEqual(
      [
        'actionDate',
        'bankName',
        'closeDate',
        'dueDate',
        'ownAmountCents',
        'status',
        'totalAmountCents',
      ].sort(),
    );
  });

  it('não expõe id, userId, bankId ou bank inteiro', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankName: 'Banco X',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('999.99'),
          reimbursable: money('100'),
        }),
      ],
      3,
    );

    expect(items[0]).not.toHaveProperty('id');
    expect(items[0]).not.toHaveProperty('userId');
    expect(items[0]).not.toHaveProperty('bankId');
    expect(items[0]).not.toHaveProperty('bank');
  });

  it('M6.2: totalAmountCents é o bruto — ownAmountCents continua a parte própria, os dois convivem', () => {
    // reimbursable > 0 garante que bruto e ownAmount divergem numericamente —
    // sem isso, os dois campos poderiam coincidir por acaso e o teste não
    // provaria que totalAmountCents é de fato o bruto, não uma cópia de ownAmount.
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'Banco X',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('999.99'),
          reimbursable: money('100'),
        }),
      ],
      3,
    );

    expect(item.totalAmountCents).toBe(99999); // bruto, nunca descontado
    expect(item.ownAmountCents).toBe(89999); // 999.99 − 100
    expect(item.totalAmountCents).not.toBe(item.ownAmountCents);
  });

  it('M6.2: sem reimbursable, totalAmountCents e ownAmountCents coincidem (não há terceiro a descontar)', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'Banco X',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('450'),
        }),
      ],
      3,
    );

    expect(item.totalAmountCents).toBe(45000);
    expect(item.ownAmountCents).toBe(45000);
  });
});

describe('money (A3, A24-A27)', () => {
  it('ownAmountCents é inteiro', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('446.24'),
        }),
      ],
      3,
    );
    expect(Number.isInteger(item.ownAmountCents)).toBe(true);
    expect(item.ownAmountCents).toBe(44624);
  });

  it('0.01 → 1 cent', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('0.01'),
        }),
      ],
      3,
    );
    expect(item.ownAmountCents).toBe(1);
  });

  it('valor inteiro → cents corretos', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('1500'),
        }),
      ],
      3,
    );
    expect(item.ownAmountCents).toBe(150000);
  });

  it('desconta reimbursable — ownAmount, nunca o bruto', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('1000'),
          reimbursable: money('300'),
        }),
      ],
      3,
    );
    expect(item.ownAmountCents).toBe(70000);
  });

  it('conversão via Decimal exato, não via Number(decimal)*100 arredondado', () => {
    /*
      Discriminante real entre as duas estratégias: `Decimal('1.005').mul(100)`
      é exatamente 100.5 → 101 cents (arredonda para cima, meio para cima).
      `Number('1.005') * 100` cai em 100.49999999999999 no IEEE-754 — e
      `Math.round` disso dá 100, um cent a menos. A imprecisão só aparece
      NESTE valor (e em poucos outros): testá-la com 0.1/0.2 não distinguiria
      as duas implementações, porque `Math.round` absorve o erro comum.
    */
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('1.005'),
        }),
      ],
      3,
    );
    expect(item.ownAmountCents).toBe(101);
  });

  it('nenhum round-trip por float introduz perda (Decimal exato)', () => {
    // 0.1 + 0.2 em IEEE-754 não é 0.3 — este valor testemunha o risco.
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('0.3'),
        }),
      ],
      3,
    );
    expect(item.ownAmountCents).toBe(30);
  });

  it('valor grande plausível não perde precisão', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('184320.77'),
        }),
      ],
      3,
    );
    expect(item.ownAmountCents).toBe(18432077);
  });
});

describe('civil date (A4, A28-A32)', () => {
  it('closeDate e dueDate preservam o dia civil', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 18],
          dueDate: [2026, 9, 25],
        }),
      ],
      3,
    );
    expect(item.closeDate).toBe('2026-09-18');
    expect(item.dueDate).toBe('2026-09-25');
  });

  it('formato é YYYY-MM-DD, sem componente de horário', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.CLOSED,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
        }),
      ],
      3,
    );
    expect(item.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('virada de mês não desloca o dia', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 30],
          dueDate: [2026, 10, 7],
        }),
      ],
      3,
    );
    expect(item.closeDate).toBe('2026-09-30');
    expect(item.dueDate).toBe('2026-10-07');
  });

  it('virada de ano não desloca o dia', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2025, 12, 24],
          dueDate: [2025, 12, 31],
        }),
      ],
      3,
    );
    expect(item.dueDate).toBe('2025-12-31');
  });
});

describe('PAID e zero (A5, A6, A20, A21)', () => {
  it('PAID nunca aparece', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.PAID,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
        }),
      ],
      3,
    );
    expect(items).toHaveLength(0);
  });

  it('totalAmount <= 0 nunca aparece', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('0'),
        }),
      ],
      3,
    );
    expect(items).toHaveLength(0);
  });

  it('o filtro de zero usa o BRUTO — ownAmount zero com bruto positivo continua actionable', () => {
    // totalAmount=1000, reimbursable=1000 → ownAmount=0, mas a fatura é
    // actionable pela regra Web (que filtra por totalAmount, não ownAmount).
    const items = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
          totalAmount: money('1000'),
          reimbursable: money('1000'),
        }),
      ],
      3,
    );
    expect(items).toHaveLength(1);
    expect(items[0].ownAmountCents).toBe(0);
  });
});

describe('prioridade (A7-A12)', () => {
  it('OVERDUE antes de CLOSED, antes de OPEN', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankName: 'Open',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 12],
          dueDate: [2026, 9, 20],
        }),
        invoice({
          bankName: 'Overdue',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 8, 3],
          dueDate: [2026, 8, 10],
        }),
        invoice({
          bankName: 'Closed',
          status: InvoiceStatus.CLOSED,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 15],
        }),
      ],
      3,
    );
    expect(items.map((i) => i.bankName)).toEqual(['Overdue', 'Closed', 'Open']);
  });

  it('duas OVERDUE: actionDate (dueDate) menor primeiro', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankName: 'Tarde',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 8, 3],
          dueDate: [2026, 8, 20],
        }),
        invoice({
          bankName: 'Cedo',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 8, 3],
          dueDate: [2026, 8, 5],
        }),
      ],
      3,
    );
    expect(items.map((i) => i.bankName)).toEqual(['Cedo', 'Tarde']);
  });

  it('duas CLOSED: actionDate (dueDate) menor primeiro', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankName: 'Tarde',
          status: InvoiceStatus.CLOSED,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 27],
        }),
        invoice({
          bankName: 'Cedo',
          status: InvoiceStatus.CLOSED,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 12],
        }),
      ],
      3,
    );
    expect(items.map((i) => i.bankName)).toEqual(['Cedo', 'Tarde']);
  });

  it('duas OPEN: actionDate (closeDate) menor primeiro', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankName: 'Tarde',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 20],
          dueDate: [2026, 9, 27],
        }),
        invoice({
          bankName: 'Cedo',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 5],
          dueDate: [2026, 9, 12],
        }),
      ],
      3,
    );
    expect(items.map((i) => i.bankName)).toEqual(['Cedo', 'Tarde']);
  });

  it('mesmo rank e mesma actionDate: desempate por bankName', () => {
    const mesmasDatas = {
      status: InvoiceStatus.OPEN,
      closeDate: [2026, 9, 10] as [number, number, number],
      dueDate: [2026, 9, 17] as [number, number, number],
    };
    const items = selectActionableInvoices(
      [
        invoice({ bankName: 'Zeta', ...mesmasDatas }),
        invoice({ bankName: 'Alfa', ...mesmasDatas }),
      ],
      3,
    );
    expect(items.map((i) => i.bankName)).toEqual(['Alfa', 'Zeta']);
  });
});

describe('actionDate (A13-A15)', () => {
  it('OPEN → actionDate == closeDate', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 12],
          dueDate: [2026, 9, 20],
        }),
      ],
      3,
    );
    expect(item.actionDate).toBe(item.closeDate);
    expect(item.actionDate).toBe('2026-09-12');
  });

  it('CLOSED → actionDate == dueDate', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.CLOSED,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 15],
        }),
      ],
      3,
    );
    expect(item.actionDate).toBe(item.dueDate);
    expect(item.actionDate).toBe('2026-09-15');
  });

  it('OVERDUE → actionDate == dueDate', () => {
    const [item] = selectActionableInvoices(
      [
        invoice({
          bankName: 'A',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 8, 3],
          dueDate: [2026, 8, 10],
        }),
      ],
      3,
    );
    expect(item.actionDate).toBe(item.dueDate);
    expect(item.actionDate).toBe('2026-08-10');
  });
});

describe('limit (A16-A19)', () => {
  const tresInvoices = [
    invoice({
      bankName: 'C',
      status: InvoiceStatus.OVERDUE,
      closeDate: [2026, 8, 1],
      dueDate: [2026, 8, 5],
    }),
    invoice({
      bankName: 'B',
      status: InvoiceStatus.CLOSED,
      closeDate: [2026, 9, 1],
      dueDate: [2026, 9, 10],
    }),
    invoice({
      bankName: 'A',
      status: InvoiceStatus.OPEN,
      closeDate: [2026, 9, 20],
      dueDate: [2026, 9, 27],
    }),
  ];

  it('default (constante do módulo) devolve a quantidade esperada', () => {
    const items = selectActionableInvoices(tresInvoices, ACTIONABLE_INVOICES_DEFAULT_LIMIT);
    expect(items).toHaveLength(3);
  });

  it('limit=1 devolve o item canônico (mais urgente)', () => {
    const items = selectActionableInvoices(tresInvoices, 1);
    expect(items).toHaveLength(1);
    expect(items[0].bankName).toBe('C');
  });

  it('ordena ANTES de limitar — limit=1 nunca é um item arbitrário', () => {
    // Embaralhado de propósito: se o limit cortasse antes de ordenar, a
    // primeira posição do array de entrada venceria em vez da mais urgente.
    const embaralhado = [tresInvoices[2], tresInvoices[1], tresInvoices[0]];
    const items = selectActionableInvoices(embaralhado, 1);
    expect(items[0].bankName).toBe('C');
  });

  it('max limit é respeitado como valor de authority', () => {
    expect(ACTIONABLE_INVOICES_MAX_LIMIT).toBeGreaterThanOrEqual(
      ACTIONABLE_INVOICES_DEFAULT_LIMIT,
    );
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * M5A.1 — a unidade é o BANCO, não a invoice solta
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `selectBankInvoice` no Web recebe todas as invoices e escolhe NO MÁXIMO
 * uma por banco antes de qualquer ordenação entre bancos. O M5A original
 * tratava cada invoice como candidata independente — nenhum teste dele tinha
 * mais de uma invoice actionable no mesmo banco, então o gap passou.
 */
describe('M5A.1 — uma invoice representa cada banco (§12-§17)', () => {
  it('§12: banco com 3 invoices actionable produz 1 item, não 3', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankId: 'banco-a',
          bankName: 'Banco A',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 8, 3],
          dueDate: [2026, 8, 10],
        }),
        invoice({
          bankId: 'banco-a',
          bankName: 'Banco A',
          status: InvoiceStatus.CLOSED,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 15],
        }),
        invoice({
          bankId: 'banco-a',
          bankName: 'Banco A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 20],
          dueDate: [2026, 9, 27],
        }),
        invoice({
          bankId: 'banco-b',
          bankName: 'Banco B',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 25],
          dueDate: [2026, 10, 2],
        }),
      ],
      3,
    );

    // 2 bancos, nunca 3 (o que aconteceria se cada invoice de A contasse).
    expect(items).toHaveLength(2);

    // A representante do Banco A é a OVERDUE — a mesma que `selectBankInvoice`
    // escolheria (maior prioridade do grupo).
    const bancoA = items.find((i) => i.bankName === 'Banco A');
    expect(bancoA?.status).toBe(InvoiceStatus.OVERDUE);
    expect(items.map((i) => i.bankName)).toEqual(['Banco A', 'Banco B']);
  });

  it('§13: limit conta BANCOS, não invoice rows — 2 invoices do mesmo banco não consomem 2 posições', () => {
    const items = selectActionableInvoices(
      [
        // Banco A: 3 invoices actionable (só a mais urgente deveria contar).
        invoice({
          bankId: 'a',
          bankName: 'Banco A',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 8, 1],
          dueDate: [2026, 8, 5],
        }),
        invoice({
          bankId: 'a',
          bankName: 'Banco A',
          status: InvoiceStatus.CLOSED,
          closeDate: [2026, 9, 1],
          dueDate: [2026, 9, 10],
        }),
        invoice({
          bankId: 'a',
          bankName: 'Banco A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 20],
          dueDate: [2026, 9, 27],
        }),
        invoice({
          bankId: 'b',
          bankName: 'Banco B',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 8, 2],
          dueDate: [2026, 8, 9],
        }),
        invoice({
          bankId: 'c',
          bankName: 'Banco C',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 22],
          dueDate: [2026, 9, 29],
        }),
      ],
      2,
    );

    expect(items).toHaveLength(2);
    // Bancos DISTINTOS — nunca o Banco A ocupando as duas posições sozinho.
    expect(new Set(items.map((i) => i.bankName)).size).toBe(2);
    expect(items.map((i) => i.bankName)).toEqual(['Banco A', 'Banco B']);
  });

  it('§14: mesmo banco, mesmo status — a representante é a de actionDate menor', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankId: 'a',
          bankName: 'Banco A',
          status: InvoiceStatus.CLOSED,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 27], // dueDate MAIOR
        }),
        invoice({
          bankId: 'a',
          bankName: 'Banco A',
          status: InvoiceStatus.CLOSED,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 12], // dueDate MENOR — deve vencer
        }),
      ],
      3,
    );

    expect(items).toHaveLength(1);
    expect(items[0].dueDate).toBe('2026-09-12');
    expect(items[0].actionDate).toBe('2026-09-12');
  });

  it('§15: bancos DIFERENTES com o MESMO nome não se fundem — grouping usa bankId, não bankName', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankId: 'id-real-1',
          bankName: 'Nubank',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 8, 3],
          dueDate: [2026, 8, 10],
        }),
        invoice({
          bankId: 'id-real-2', // banco DIFERENTE, mesmo nome de exibição
          bankName: 'Nubank',
          status: InvoiceStatus.CLOSED,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 15],
        }),
      ],
      3,
    );

    // Os dois participam — nomes iguais não são o mesmo banco.
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.status).sort()).toEqual(
      [InvoiceStatus.OVERDUE, InvoiceStatus.CLOSED].sort(),
    );
  });

  it('§16: PAID no mesmo banco de uma actionable não pode ganhar a representação', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankId: 'a',
          bankName: 'Banco A',
          status: InvoiceStatus.PAID,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 10],
        }),
        invoice({
          bankId: 'a',
          bankName: 'Banco A',
          status: InvoiceStatus.OPEN,
          closeDate: [2026, 9, 20],
          dueDate: [2026, 9, 27],
        }),
      ],
      3,
    );

    expect(items).toHaveLength(1);
    expect(items[0].status).toBe(InvoiceStatus.OPEN);
  });

  it('§17: invoice zerada no mesmo banco de uma actionable não pode ganhar a representação', () => {
    const items = selectActionableInvoices(
      [
        invoice({
          bankId: 'a',
          bankName: 'Banco A',
          status: InvoiceStatus.OVERDUE,
          closeDate: [2026, 8, 1],
          dueDate: [2026, 8, 5],
          totalAmount: money('0'),
        }),
        invoice({
          bankId: 'a',
          bankName: 'Banco A',
          status: InvoiceStatus.CLOSED,
          closeDate: [2026, 9, 3],
          dueDate: [2026, 9, 15],
          totalAmount: money('200'),
        }),
      ],
      3,
    );

    expect(items).toHaveLength(1);
    expect(items[0].status).toBe(InvoiceStatus.CLOSED);
  });

  it('parity fixture: mesmo banco tie completo (status e actionDate iguais) ainda produz 1 representante', () => {
    const mesmasDatas: InvoiceOverrides = {
      bankId: 'a',
      bankName: 'Banco A',
      status: InvoiceStatus.OPEN,
      closeDate: [2026, 9, 10],
      dueDate: [2026, 9, 17],
    };
    const items = selectActionableInvoices(
      [invoice(mesmasDatas), invoice(mesmasDatas)],
      3,
    );
    expect(items).toHaveLength(1);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * M5A.2 — empate determinístico, independente da ordem de entrada
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Duas invoices do MESMO banco podem legitimamente empatar em `status` e
 * `actionDate` — nada no schema impede isso. Quando acontece, `bankName`
 * (terceiro critério histórico) TAMBÉM empata, porque é o mesmo banco. Sem
 * um desempate intra-banco, a representante escolhida dependia da ordem do
 * array recebido — que no service vem de uma query SEM `orderBy`.
 */
describe('M5A.2 — desempate determinístico (§11-§18)', () => {
  it('§11: input revertido produz a MESMA representante (mesmo status, mesma actionDate, competências diferentes)', () => {
    const invoiceX = invoice({
      bankId: 'bank-1',
      bankName: 'Nubank',
      status: InvoiceStatus.OVERDUE,
      closeDate: [2026, 8, 3],
      dueDate: [2026, 8, 10], // mesma actionDate (OVERDUE usa dueDate)
      year: 2026,
      month: 8,
    });
    const invoiceY = invoice({
      bankId: 'bank-1',
      bankName: 'Nubank',
      status: InvoiceStatus.OVERDUE,
      closeDate: [2026, 6, 3],
      dueDate: [2026, 8, 10], // MESMA actionDate que X
      year: 2026,
      month: 6, // competência mais antiga — deve vencer
    });

    const ordem1 = selectActionableInvoices([invoiceX, invoiceY], 3);
    const ordem2 = selectActionableInvoices([invoiceY, invoiceX], 3);

    expect(ordem1).toHaveLength(1);
    expect(ordem2).toHaveLength(1);
    // A representante é a mesma nas duas ordens de entrada.
    expect(ordem1[0].closeDate).toBe(ordem2[0].closeDate);
    expect(ordem1[0].dueDate).toBe(ordem2[0].dueDate);
  });

  it('§12: mesmo banco, mesmo status/actionDate, competências diferentes — a mais antiga vence', () => {
    const invoiceAntiga = invoice({
      bankId: 'bank-1',
      bankName: 'Nubank',
      status: InvoiceStatus.CLOSED,
      closeDate: [2026, 8, 3],
      dueDate: [2026, 9, 1],
      year: 2026,
      month: 8,
      // invoiceId PROPOSITALMENTE maior que o da invoice nova: se o
      // comparador ignorasse competência e caísse direto no fallback por id,
      // a NOVA venceria (id menor) — o oposto do esperado. Só um comparador
      // que realmente olha year/month antes do id escolhe a antiga aqui.
      invoiceId: 'zzzz-antiga',
    });
    const invoiceNova = invoice({
      bankId: 'bank-1',
      bankName: 'Nubank',
      status: InvoiceStatus.CLOSED,
      closeDate: [2026, 9, 3],
      dueDate: [2026, 9, 1], // MESMA actionDate
      year: 2026,
      month: 9,
      invoiceId: 'aaaa-nova',
    });

    const items = selectActionableInvoices([invoiceNova, invoiceAntiga], 3);

    expect(items).toHaveLength(1);
    // A representante é a de competência mais antiga (agosto) — reconhecível
    // pelo seu closeDate distinto (03/08, não 03/09).
    expect(items[0].closeDate).toBe('2026-08-03');
  });

  it('§13: virada de ano — 2025/12 vence sobre 2026/1, mesmo status/actionDate', () => {
    const invoiceDezembro = invoice({
      bankId: 'bank-1',
      bankName: 'Nubank',
      status: InvoiceStatus.CLOSED,
      closeDate: [2025, 12, 3],
      dueDate: [2026, 1, 15],
      year: 2025,
      month: 12,
      // id lexicalmente MAIOR que o de janeiro — mesma proteção do §12: só
      // year decidindo antes do fallback por id escolhe dezembro aqui.
      invoiceId: 'zzzz-dezembro',
    });
    const invoiceJaneiro = invoice({
      bankId: 'bank-1',
      bankName: 'Nubank',
      status: InvoiceStatus.CLOSED,
      closeDate: [2026, 1, 3],
      dueDate: [2026, 1, 15], // MESMA actionDate
      year: 2026,
      month: 1,
      invoiceId: 'aaaa-janeiro',
    });

    const itemsOrdemA = selectActionableInvoices([invoiceJaneiro, invoiceDezembro], 3);
    const itemsOrdemB = selectActionableInvoices([invoiceDezembro, invoiceJaneiro], 3);

    // 2025/12 vence — reconhecível pelo closeDate de dezembro.
    expect(itemsOrdemA[0].closeDate).toBe('2025-12-03');
    expect(itemsOrdemB[0].closeDate).toBe('2025-12-03');
  });

  it('§14: mesma competência, mesmo status/actionDate — o invoiceId lexicalmente menor vence, em qualquer ordem de entrada', () => {
    /*
      `totalAmount` DIFERENTE entre A e B é o que torna o teste discriminante:
      sem isso, as duas invoices produziriam o MESMO `ownAmountCents` e a
      troca de qual delas "vence" internamente (por causa da ordem de entrada,
      na ausência do fallback por invoiceId) não apareceria no resultado —
      `invoiceId` nunca é exposto, então dois resultados idênticos por fora
      não provam que a MESMA invoice interna venceu nas duas ordens.
    */
    const invoiceA = invoice({
      bankId: 'bank-1',
      bankName: 'Nubank',
      status: InvoiceStatus.OPEN,
      closeDate: [2026, 9, 20],
      dueDate: [2026, 9, 27],
      year: 2026,
      month: 9,
      invoiceId: 'aaaa-0001', // menor lexicalmente — deve vencer
      totalAmount: money('100'),
    });
    const invoiceB = invoice({
      bankId: 'bank-1',
      bankName: 'Nubank',
      status: InvoiceStatus.OPEN,
      closeDate: [2026, 9, 20], // MESMA actionDate (closeDate, status OPEN)
      dueDate: [2026, 9, 27],
      year: 2026, // MESMA competência
      month: 9,
      invoiceId: 'bbbb-0002',
      totalAmount: money('999'), // valor DIFERENTE — torna a escolha observável
    });

    const ordem1 = selectActionableInvoices([invoiceA, invoiceB], 3);
    const ordem2 = selectActionableInvoices([invoiceB, invoiceA], 3);

    expect(ordem1).toHaveLength(1);
    expect(ordem2).toHaveLength(1);
    // 'aaaa-0001' < 'bbbb-0002' lexicalmente — A vence nas duas ordens,
    // reconhecível pelo ownAmountCents de A (10000), nunca o de B (99900).
    expect(ordem1[0].ownAmountCents).toBe(10000);
    expect(ordem2[0].ownAmountCents).toBe(10000);
    expect(ordem1).toEqual(ordem2);
    // invoiceId nunca aparece no output público.
    expect(ordem1[0]).not.toHaveProperty('invoiceId');
  });

  it('§15: createdAt não influencia o desempate (ausente do candidate)', () => {
    /*
      Estrutural: `ActionableInvoiceCandidate` não declara `createdAt` como
      propriedade — não há como o comparador usá-lo, mesmo por engano. O
      helper CITA `createdAt` em prosa (explicando por que competência é
      preferível a ele), então o teste procura por um campo/acesso real
      (`.createdAt`, `createdAt:`), não pela palavra solta.
    */
    const source: string = require('node:fs').readFileSync(
      require('node:path').join(__dirname, 'actionable-invoices.helper.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/\.createdAt\b/);
    expect(source).not.toMatch(/\bcreatedAt\s*:/);
  });

  it('§16: dois bancos homônimos com mesma urgência — determinístico por bankId, em qualquer ordem', () => {
    const bancoX = invoice({
      bankId: 'id-real-x',
      bankName: 'Nubank',
      status: InvoiceStatus.OVERDUE,
      closeDate: [2026, 8, 3],
      dueDate: [2026, 8, 10],
    });
    const bancoY = invoice({
      bankId: 'id-real-y',
      bankName: 'Nubank', // MESMO nome
      status: InvoiceStatus.OVERDUE, // MESMO status
      closeDate: [2026, 9, 3],
      dueDate: [2026, 8, 10], // MESMA actionDate
    });

    const ordem1 = selectActionableInvoices([bancoX, bancoY], 3).map((i) => i.closeDate);
    const ordem2 = selectActionableInvoices([bancoY, bancoX], 3).map((i) => i.closeDate);

    expect(ordem1).toHaveLength(2);
    expect(ordem2).toHaveLength(2);
    // Ambos presentes (nomes iguais não se fundem) e mesma ordem nas duas entradas.
    expect(ordem1).toEqual(ordem2);
  });

  it('§17: limit com empate visível — mesmos bancos, mesma ordem, com entrada invertida', () => {
    const bancoA = invoice({
      bankId: 'a',
      bankName: 'Alfa',
      status: InvoiceStatus.OVERDUE,
      closeDate: [2026, 8, 3],
      dueDate: [2026, 8, 10],
    });
    const bancoB = invoice({
      bankId: 'b',
      bankName: 'Beta',
      status: InvoiceStatus.OVERDUE,
      closeDate: [2026, 8, 3],
      dueDate: [2026, 8, 10], // empatado com A em status+actionDate
    });
    const bancoC = invoice({
      bankId: 'c',
      bankName: 'Gama',
      status: InvoiceStatus.OPEN,
      closeDate: [2026, 9, 20],
      dueDate: [2026, 9, 27],
    });

    const ordem1 = selectActionableInvoices([bancoA, bancoB, bancoC], 2).map((i) => i.bankName);
    const ordem2 = selectActionableInvoices([bancoC, bancoB, bancoA], 2).map((i) => i.bankName);

    expect(ordem1).toEqual(['Alfa', 'Beta']); // desempate por bankName
    expect(ordem2).toEqual(ordem1);
  });

  it('§18: permutações — múltiplos bancos, múltiplas invoices, ties completos, mesma seleção e ordem em toda permutação', () => {
    const candidates = [
      invoice({
        bankId: 'bank-1',
        bankName: 'Nubank',
        status: InvoiceStatus.OVERDUE,
        closeDate: [2026, 8, 3],
        dueDate: [2026, 9, 1],
        year: 2026,
        month: 8,
      }),
      invoice({
        // MESMO banco, mesmo status/actionDate, competência mais nova.
        bankId: 'bank-1',
        bankName: 'Nubank',
        status: InvoiceStatus.OVERDUE,
        closeDate: [2026, 9, 3],
        dueDate: [2026, 9, 1],
        year: 2026,
        month: 9,
      }),
      invoice({
        bankId: 'bank-2',
        bankName: 'Itaú',
        status: InvoiceStatus.OPEN,
        closeDate: [2026, 9, 20],
        dueDate: [2026, 9, 27],
      }),
    ];

    // Enumera as 3! = 6 permutações de um array pequeno.
    function permutations<T>(arr: T[]): T[][] {
      if (arr.length <= 1) return [arr];
      const result: T[][] = [];
      for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const perm of permutations(rest)) {
          result.push([arr[i], ...perm]);
        }
      }
      return result;
    }

    const referencia = selectActionableInvoices(candidates, 3);
    for (const perm of permutations(candidates)) {
      expect(selectActionableInvoices(perm, 3)).toEqual(referencia);
    }
  });
});
