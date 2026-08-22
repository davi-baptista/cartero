import { describe, expect, it, vi } from 'vitest';
import { TransactionsService } from './transactions.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Competência de fatura em `GET /transactions?invoicePeriod=true` (Fase 9C)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A Visão Geral pergunta "o que pesa neste mês", e a resposta para crédito é a
 * fatura em que a compra caiu — não a data da compra. Uma compra de 27/02 que
 * entra na fatura de abril pesa em abril: é quando o dinheiro sai.
 *
 * O Extrato usa a outra perspectiva (data da Transaction) de propósito, e por
 * isso este filtro é OPT-IN. Os dois convivem.
 *
 * Este arquivo fixa o contrato do filtro, que é a base temporal de todos os
 * números da Visão Geral.
 */

function buildHarness() {
  /** O `where` com que o serviço consultou. */
  const seen: any[] = [];

  const prisma: any = {
    transaction: {
      findMany: vi.fn(async ({ where }: any) => {
        seen.push(where);
        return [];
      }),
    },
  };

  const validation = new EntityValidationService(prisma as PrismaService);

  return {
    service: new TransactionsService(prisma as PrismaService, validation),
    seen,
  };
}

const AGOSTO = { startDate: '2026-08-01', endDate: '2026-08-31' };

describe('Com invoicePeriod, crédito segue a fatura', () => {
  it('filtra pela competência da Invoice, não pela data', async () => {
    const harness = buildHarness();

    await harness.service.findAll(USER_ID, {
      ...AGOSTO,
      invoicePeriod: true,
    } as any);

    const where = harness.seen[0];
    /*
      O ramo de crédito casa por `invoice: { year, month }` — a relação REAL e
      persistida. Derivar a competência pelo Bank aqui reintroduziria o defeito
      que a Fase 6B corrigiu: mudar o vencimento do cartão reescreveria a
      competência de todo o histórico.
    */
    expect(where.OR[0].invoice.OR).toEqual(
      expect.arrayContaining([{ year: 2026, month: 8 }]),
    );
  });

  it('lançamentos sem fatura seguem a própria data', async () => {
    // Débito, PIX e boleto não têm fatura: a data da Transaction é o recorte.
    const harness = buildHarness();

    await harness.service.findAll(USER_ID, {
      ...AGOSTO,
      invoicePeriod: true,
    } as any);

    const semFatura = harness.seen[0].OR[1];
    expect(semFatura.invoiceId).toBeNull();
    expect(semFatura.date.gte).toBeInstanceOf(Date);
    expect(semFatura.date.lte).toBeInstanceOf(Date);
  });

  it('os dois ramos são alternativos, não cumulativos', async () => {
    /**
     * `OR` com `invoiceId: null` no segundo ramo é o que evita contagem dupla:
     * uma transação de crédito casa só pelo primeiro, e uma de PIX só pelo
     * segundo. Sem o `invoiceId: null`, uma compra de crédito feita em agosto
     * e faturada em agosto casaria nos dois.
     */
    const harness = buildHarness();

    await harness.service.findAll(USER_ID, {
      ...AGOSTO,
      invoicePeriod: true,
    } as any);

    expect(harness.seen[0].OR).toHaveLength(2);
    expect(harness.seen[0].OR[1]).toHaveProperty('invoiceId', null);
  });

  it('atravessa a virada de ano', async () => {
    // Janeiro pede a competência 2027-01, não 2026-01.
    const harness = buildHarness();

    await harness.service.findAll(USER_ID, {
      startDate: '2027-01-01',
      endDate: '2027-01-31',
      invoicePeriod: true,
    } as any);

    expect(harness.seen[0].OR[0].invoice.OR).toEqual(
      expect.arrayContaining([{ year: 2027, month: 1 }]),
    );
  });
});

describe('Sem invoicePeriod, tudo segue a data', () => {
  it('o Extrato mantém a perspectiva de data', async () => {
    /**
     * A perspectiva do Extrato é "o que aconteceu": a compra de 27/02 aparece
     * em fevereiro, quando ela de fato ocorreu. As duas telas divergirem no
     * mesmo mês é correto — elas respondem perguntas diferentes.
     */
    const harness = buildHarness();

    await harness.service.findAll(USER_ID, AGOSTO as any);

    expect(harness.seen[0]).not.toHaveProperty('OR');
    expect(harness.seen[0].date.gte).toBeInstanceOf(Date);
  });
});

describe('Parcelas', () => {
  it('cada parcela é uma Transaction própria, sem média', async () => {
    /**
     * O filtro não agrega nem divide nada: devolve as Transactions que existem,
     * cada uma com o `amount` persistido. Os centavos distribuídos na Fase 5A
     * (33,34 / 33,33 / 33,33) continuam íntegros porque ninguém recalcula
     * `total / parcelas` no caminho.
     */
    const harness = buildHarness();

    await harness.service.findAll(USER_ID, {
      ...AGOSTO,
      invoicePeriod: true,
    } as any);

    // Nenhuma agregação na consulta: sem groupBy, sem _sum, sem _avg.
    const call = (harness.service as any).prisma.transaction.findMany.mock
      .calls[0][0];
    expect(call).not.toHaveProperty('_sum');
    expect(call).not.toHaveProperty('_avg');
  });
});
