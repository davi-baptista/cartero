import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import { USER_ID } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * `Debt.isAlertEnabled` precisa ser respeitado (Fase 8A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O campo estava completo em todo lugar menos onde importava: existe no
 * schema, é gravável por `CreateDebtDto` e `UpdateDebtDto`, tem um switch
 * rotulado "Exibir alerta no dia do vencimento" no formulário e um sino
 * cortado na linha da lista quando está desligado.
 *
 * Nenhum leitor o consultava. Desligar o alerta não desligava nada — e a
 * interface afirmava, com um ícone dedicado, que havia desligado.
 *
 * Este teste vigia a cláusula da query, não a mensagem: o defeito não era um
 * texto errado, era um filtro ausente.
 */

function buildHarness() {
  const debtWhere: any[] = [];

  const prisma: any = {
    debt: {
      findMany: vi.fn(async ({ where }: any) => {
        debtWhere.push(where);
        return [];
      }),
    },
    receivable: { findMany: vi.fn(async () => []) },
    invoice: { findMany: vi.fn(async () => []) },
  };

  const config: any = { get: vi.fn(() => undefined) };

  const service = new NotificationsService(
    prisma as PrismaService,
    config as ConfigService,
  );

  return { service, prisma, debtWhere };
}

describe('Alerta de vencimento de dívida', () => {
  it('a busca exige isAlertEnabled', async () => {
    const harness = buildHarness();

    await (harness.service as any).findUpcomingItems(USER_ID, 0);

    expect(harness.debtWhere).toHaveLength(1);
    expect(harness.debtWhere[0]).toMatchObject({ isAlertEnabled: true });
  });

  it('continua excluindo dívidas já pagas', async () => {
    // A cláusula nova não pode ter substituído a antiga.
    const harness = buildHarness();

    await (harness.service as any).findUpcomingItems(USER_ID, 0);

    expect(harness.debtWhere[0]).toMatchObject({ isPaid: false });
  });

  it('recebíveis NÃO têm essa preferência', async () => {
    /**
     * `Receivable` não tem `isAlertEnabled` — nem no schema, nem na interface.
     * Filtrar por um campo inexistente aqui seria erro de Prisma em runtime, e
     * inventar a preferência só por simetria criaria um controle que a UI não
     * oferece.
     */
    const harness = buildHarness();

    await (harness.service as any).findUpcomingItems(USER_ID, 0);

    const call = harness.prisma.receivable.findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty('isAlertEnabled');
  });
});
