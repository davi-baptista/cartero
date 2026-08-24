import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  correctSettlementDate,
  resolveSettlementDate,
} from './settlement.core';
import type { Prisma } from '@prisma/client';
import { USER_ID } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Data real do acerto
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `paidAt` significa "quando o dinheiro se moveu de fato", não "quando cliquei
 * em Pago no Cartero".
 *
 * A distinção importa porque o Budget reconstrói o histórico por `paidAt`: uma
 * dívida de dezembro registrada como paga em agosto (regularização tardia)
 * aparecia como pendência anterior em janeiro, fevereiro, março e adiante —
 * matematicamente correto para o dado armazenado, temporalmente falso sobre o
 * mundo.
 */

/** 24/08/2026, meio-dia em Fortaleza. */
const HOJE = new Date(Date.UTC(2026, 7, 24, 15));

describe('resolveSettlementDate', () => {
  it('item 48: sem data explícita, usa hoje', () => {
    // Fallback para o consumidor que ainda não envia o campo.
    expect(resolveSettlementDate(undefined, HOJE)).toBe(HOJE);
  });

  it('item 49: aceita data histórica', () => {
    // O caso que motivou tudo: regularizar em agosto um pagamento de dezembro.
    const data = resolveSettlementDate('2025-12-20', HOJE);

    expect(data.toISOString().slice(0, 10)).toBe('2025-12-20');
  });

  it('item 51: pagamento ANTECIPADO é válido', () => {
    // Pagar antes do vencimento é normal, não é erro.
    expect(() => resolveSettlementDate('2026-08-10', HOJE)).not.toThrow();
  });

  it('item 52: data futura é recusada', () => {
    expect(() => resolveSettlementDate('2026-08-25', HOJE)).toThrow(
      BadRequestException,
    );
  });

  it('o PRÓPRIO dia é aceito', () => {
    // Hoje não é futuro: há o dia inteiro para registrar.
    expect(() => resolveSettlementDate('2026-08-24', HOJE)).not.toThrow();
  });

  it('item 7: não desloca o dia por fuso', () => {
    /*
      Servidor em UTC: às 22h de 24/08 em Fortaleza já é 25/08 em UTC.
      Comparar instantes recusaria uma data legítima na virada do dia.
    */
    const noiteDeFortaleza = new Date(Date.UTC(2026, 7, 25, 1));
    expect(() =>
      resolveSettlementDate('2026-08-24', noiteDeFortaleza),
    ).not.toThrow();

    expect(
      resolveSettlementDate('2026-08-24', HOJE).toISOString().slice(0, 10),
    ).toBe('2026-08-24');
  });

  it('atravessa a virada de ano', () => {
    expect(
      resolveSettlementDate('2025-12-31', HOJE).toISOString().slice(0, 10),
    ).toBe('2025-12-31');
  });
});

/** Duplo que honra `userId` — sem isso o teste de ownership não prova nada. */
function buildTx(row: {
  isPaid: boolean;
  paymentTransactionId: string | null;
  userId?: string;
}) {
  const found = {
    isPaid: row.isPaid,
    paymentTransactionId: row.paymentTransactionId,
  };
  const owner = row.userId ?? USER_ID;

  const tx = {
    debt: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.userId === owner ? found : null,
      ),
      update: vi.fn(async () => ({})),
    },
    receivable: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.userId === owner ? found : null,
      ),
      update: vi.fn(async () => ({})),
    },
    transaction: { update: vi.fn(async () => ({})) },
  };

  return tx as unknown as Prisma.TransactionClient & typeof tx;
}

describe('correctSettlementDate', () => {
  const NOVA = new Date(Date.UTC(2025, 11, 20, 12));

  it('item 53: atualiza paidAt e a Transaction-espelho', async () => {
    const tx = buildTx({ isPaid: true, paymentTransactionId: 'tx-1' });

    await correctSettlementDate(tx, {
      kind: 'debt',
      id: 'd-1',
      userId: USER_ID,
      paidAt: NOVA,
    });

    expect(tx.debt.update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { paidAt: NOVA },
    });
    // As duas datas descrevem o mesmo fato: andam juntas.
    expect(tx.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { date: NOVA },
    });
  });

  it('item 17: não toca valor, vencimento nem contraparte', async () => {
    const tx = buildTx({ isPaid: true, paymentTransactionId: 'tx-1' });

    await correctSettlementDate(tx, {
      kind: 'debt',
      id: 'd-1',
      userId: USER_ID,
      paidAt: NOVA,
    });

    const [{ data }] = tx.debt.update.mock.calls.map((call: any[]) => call[0]);
    expect(Object.keys(data)).toEqual(['paidAt']);

    const [{ data: txData }] = tx.transaction.update.mock.calls.map(
      (call: any[]) => call[0],
    );
    expect(Object.keys(txData)).toEqual(['date']);
  });

  it('item 54: item ainda aberto é recusado', async () => {
    const tx = buildTx({ isPaid: false, paymentTransactionId: null });

    await expect(
      correctSettlementDate(tx, {
        kind: 'debt',
        id: 'd-1',
        userId: USER_ID,
        paidAt: NOVA,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Nenhum `paidAt` solto em item aberto.
    expect(tx.debt.update).not.toHaveBeenCalled();
  });

  it('item 55: não corrige item de outro usuário', async () => {
    const tx = buildTx({
      isPaid: true,
      paymentTransactionId: 'tx-1',
      userId: 'outro-usuario',
    });

    await expect(
      correctSettlementDate(tx, {
        kind: 'debt',
        id: 'd-1',
        userId: USER_ID,
        paidAt: NOVA,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(tx.debt.update).not.toHaveBeenCalled();
    expect(tx.transaction.update).not.toHaveBeenCalled();
  });

  it('item 20: resolvido SEM Transaction vinculada funciona', async () => {
    /*
      Caso legítimo: `createExpenseOnDebtPaid` desligado. A correção segue
      possível e nenhuma Transaction é inventada.
    */
    const tx = buildTx({ isPaid: true, paymentTransactionId: null });

    await correctSettlementDate(tx, {
      kind: 'debt',
      id: 'd-1',
      userId: USER_ID,
      paidAt: NOVA,
    });

    expect(tx.debt.update).toHaveBeenCalled();
    expect(tx.transaction.update).not.toHaveBeenCalled();
  });

  it('item 21: legado com paidAt null pode ser corrigido', async () => {
    // `isPaid: true` sem data: a correção preenche em vez de deixar indefinido.
    const tx = buildTx({ isPaid: true, paymentTransactionId: null });

    await correctSettlementDate(tx, {
      kind: 'receivable',
      id: 'r-1',
      userId: USER_ID,
      paidAt: NOVA,
    });

    expect(tx.receivable.update).toHaveBeenCalledWith({
      where: { id: 'r-1' },
      data: { paidAt: NOVA },
    });
  });

  it('funciona para cobrança do mesmo modo', async () => {
    const tx = buildTx({ isPaid: true, paymentTransactionId: 'tx-9' });

    await correctSettlementDate(tx, {
      kind: 'receivable',
      id: 'r-1',
      userId: USER_ID,
      paidAt: NOVA,
    });

    expect(tx.receivable.update).toHaveBeenCalled();
    expect(tx.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-9' },
      data: { date: NOVA },
    });
  });
});
