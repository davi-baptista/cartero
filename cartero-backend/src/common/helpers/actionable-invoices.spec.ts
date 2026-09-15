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
}

function invoice(over: InvoiceOverrides): ActionableInvoiceCandidate {
  return {
    bankName: over.bankName,
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
      ['actionDate', 'bankName', 'closeDate', 'dueDate', 'ownAmountCents', 'status'].sort(),
    );
  });

  it('não expõe id, userId, bankId, bank inteiro ou totalAmount bruto', () => {
    // reimbursable > 0 garante que o bruto (999.99 → "99999" em cents) e o
    // ownAmountCents divergem textualmente — sem isso a ausência do campo
    // `totalAmount` não seria distinguível de coincidência numérica.
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

    expect(items[0]).not.toHaveProperty('totalAmount');
    expect(items[0]).not.toHaveProperty('id');
    expect(items[0]).not.toHaveProperty('userId');
    expect(items[0]).not.toHaveProperty('bankId');
    expect(items[0]).not.toHaveProperty('bank');
    expect(items[0].ownAmountCents).toBe(89999); // 999.99 − 100, nunca o bruto
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
