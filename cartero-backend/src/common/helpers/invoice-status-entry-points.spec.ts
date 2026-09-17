import { describe, expect, it } from 'vitest';
import { deriveStatusFromInvoiceDates } from './invoice.helper';
import { planBillingConfigUpdate } from 'src/banks/billing-config-plan.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * TZ6.1 §7/§14 — consistência entre entry points de Invoice status
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Para uma conta com `User.timeZone` configurado, TODO entry point que
 * recalcula `Invoice.status` (scheduler, reopen/reopenAllPaid,
 * billing-config-plan) precisa usar a MESMA authority — nunca UTC para um e
 * a timezone da conta para outro. `reopen`/`reopenAllPaid` chamam
 * `deriveStatusFromInvoiceDates` diretamente (mesma função já coberta em
 * `invoice-status-timezone.spec.ts`); este arquivo cobre a superfície
 * própria de `billing-config-plan.helper.ts` (`isEffectivelyOpen`), que
 * decide elegibilidade a partir da MESMA authority.
 */

// dueDate = 17/09, closeDate = 17/09 (fecha hoje). Fortaleza (UTC-3), no
// instante 16/09 23:30 UTC, ainda é 16/09 20h30 — closeDate ainda não
// chegou (OPEN). Tóquio (UTC+9), no MESMO instante, já é 17/09 08h30 —
// closeDate já chegou (CLOSED). Boundary genuíno entre as duas contas.
const instant = new Date('2026-09-16T23:30:00.000Z');
const closesToday = {
  closeDate: new Date('2026-09-17T03:00:00.000Z'),
  dueDate: new Date('2026-09-20T03:00:00.000Z'),
};

describe('deriveStatusFromInvoiceDates — boundary usado pelos dois entry points', () => {
  it('Fortaleza: closeDate ainda não chegou — OPEN', () => {
    expect(deriveStatusFromInvoiceDates(closesToday, instant, 'America/Fortaleza')).toBe(
      'OPEN',
    );
  });

  it('Tokyo: closeDate já chegou — CLOSED', () => {
    expect(deriveStatusFromInvoiceDates(closesToday, instant, 'Asia/Tokyo')).toBe(
      'CLOSED',
    );
  });
});

describe('planBillingConfigUpdate — isEffectivelyOpen usa a MESMA authority', () => {
  const invoice = {
    id: 'inv-1',
    year: 2026,
    month: 9,
    status: 'OPEN' as const,
    ...closesToday,
  };
  const schedule = {
    current: { invoiceDueDate: 20, invoiceDueDaysAfterClose: 3 },
    next: { invoiceDueDate: 25, invoiceDueDaysAfterClose: 3 },
  };

  it('Fortaleza: fatura ainda efetivamente aberta — elegível para o novo ciclo', () => {
    const plan = planBillingConfigUpdate({
      ...schedule,
      invoices: [invoice],
      today: instant,
      timeZone: 'America/Fortaleza',
    });

    expect(plan.skipped).toHaveLength(0);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].invoiceId).toBe('inv-1');
  });

  it('Tokyo: fatura já efetivamente fechada — NÃO elegível (mesma conclusão do scheduler)', () => {
    const plan = planBillingConfigUpdate({
      ...schedule,
      invoices: [invoice],
      today: instant,
      timeZone: 'Asia/Tokyo',
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped).toEqual([
      { invoiceId: 'inv-1', year: 2026, month: 9, reason: 'EFFECTIVELY_CLOSED' },
    ]);
  });

  it('legacy null preserva a derivação UTC exata (nem Fortaleza, nem Tokyo)', () => {
    // UTC-dia do instant ainda é 16/09 — closeDate (17/09) ainda não chegou.
    const plan = planBillingConfigUpdate({
      ...schedule,
      invoices: [invoice],
      today: instant,
      timeZone: null,
    });

    expect(plan.skipped).toHaveLength(0);
    expect(plan.changes).toHaveLength(1);
  });

  it('P4 (mutação real): timeZone ausente do input cai em null, não em Fortaleza/UTC escondido', () => {
    // Omitir `timeZone` do input inteiramente deve produzir o MESMO
    // resultado que passá-lo como `null` explicitamente — nunca um default
    // diferente escondido dentro de planBillingConfigUpdate.
    const withNull = planBillingConfigUpdate({
      ...schedule,
      invoices: [invoice],
      today: instant,
      timeZone: null,
    });
    const omitted = planBillingConfigUpdate({
      ...schedule,
      invoices: [invoice],
      today: instant,
    });

    expect(omitted).toEqual(withNull);
  });
});
