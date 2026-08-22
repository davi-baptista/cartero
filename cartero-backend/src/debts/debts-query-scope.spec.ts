import { describe, expect, it, vi } from 'vitest';
import { DebtsService } from './debts.service';
import { ReceivablesService } from '../receivables/receivables.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * `GET /debts` e `GET /receivables` sem filtro devolvem TUDO (Fase 8C)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A Visão Geral depende disso. Ela chama `getDebts()` / `getReceivables()` sem
 * parâmetros e faz o recorte no cliente, porque seus widgets têm recortes
 * DIFERENTES entre si:
 *
 *   - "Atenção agora": janela móvel de 7 dias que precisa incluir o atraso de
 *     meses anteriores — um vencimento de junho ainda em aberto é justamente o
 *     que o painel existe para mostrar;
 *   - Calendário: o mês exibido;
 *   - Gastos por categoria: o mês do seletor.
 *
 * Se estes endpoints passassem a recortar por mês por conta própria, o painel
 * de atenção perderia silenciosamente os itens em atraso — a informação mais
 * urgente da tela. Este arquivo fixa o contrato de origem.
 */

function buildHarness() {
  const seen = { debt: [] as any[], receivable: [] as any[] };

  const prisma: any = {
    debt: {
      findMany: vi.fn(async ({ where }: any) => {
        seen.debt.push(where);
        return [];
      }),
    },
    receivable: {
      findMany: vi.fn(async ({ where }: any) => {
        seen.receivable.push(where);
        return [];
      }),
    },
  };

  const validation = new EntityValidationService(prisma as PrismaService);

  return {
    debts: new DebtsService(prisma as PrismaService, validation),
    receivables: new ReceivablesService(prisma as PrismaService, validation),
    seen,
  };
}

describe('Sem filtro, sem recorte temporal', () => {
  it('GET /debts não impõe intervalo de datas', async () => {
    const harness = buildHarness();

    await harness.debts.findAll(USER_ID, {});

    /*
      `dueDate` pode existir como objeto com `gte`/`lte` undefined — o Prisma
      trata isso como ausência de filtro. O que importa é que nenhum LIMITE
      concreto tenha sido imposto.
    */
    const range = harness.seen.debt[0]?.dueDate;
    expect(range?.gte).toBeUndefined();
    expect(range?.lte).toBeUndefined();
  });

  it('GET /receivables não impõe intervalo de datas', async () => {
    const harness = buildHarness();

    await harness.receivables.findAll(USER_ID, {});

    const range = harness.seen.receivable[0]?.dueDate;
    expect(range?.gte).toBeUndefined();
    expect(range?.lte).toBeUndefined();
  });

  it('nenhum dos dois filtra por isPaid', async () => {
    // O painel de atenção precisa dos pendentes, e as páginas mostram abas de
    // pagos: quem decide é o consumidor, não o endpoint.
    const harness = buildHarness();

    await harness.debts.findAll(USER_ID, {});
    await harness.receivables.findAll(USER_ID, {});

    expect(harness.seen.debt[0]).not.toHaveProperty('isPaid');
    expect(harness.seen.receivable[0]).not.toHaveProperty('isPaid');
  });
});

describe('Com filtro, o recorte é aplicado', () => {
  it('respeita startDate e endDate quando enviados', async () => {
    // A capacidade continua existindo — o Extrato e a navegação a usam.
    const harness = buildHarness();

    await harness.debts.findAll(USER_ID, {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });

    expect(harness.seen.debt[0].dueDate.gte).toBeInstanceOf(Date);
    expect(harness.seen.debt[0].dueDate.lte).toBeInstanceOf(Date);
  });

  it('o recorte é por dueDate, não por paidAt', async () => {
    /**
     * Diferente do histórico da Person, que usa `paidAt`.
     *
     * Aqui a pergunta é "o que vence neste intervalo" — competência, não
     * liquidação. Confundir os dois jogaria uma dívida de junho paga em agosto
     * no mês errado em uma das duas telas.
     */
    const harness = buildHarness();

    await harness.debts.findAll(USER_ID, { startDate: '2026-08-01' });

    expect(harness.seen.debt[0]).toHaveProperty('dueDate');
    expect(harness.seen.debt[0]).not.toHaveProperty('paidAt');
  });
});
