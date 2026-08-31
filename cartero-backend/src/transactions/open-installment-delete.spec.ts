import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TransactionsService } from './transactions.service';
import type {
  TransactionDeletePreview,
  TransactionDeleteResult,
} from './transaction-delete-preview.types';
import type { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import {
  USER_ID,
  makeInvoice,
  makeReceivable,
  makeTransaction,
  money,
  utcDate,
} from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Excluir parcelas em aberto — integração
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A política pura tem spec própria. Aqui se prova o que só o service pode
 * provar: que prévia e execução enxergam o MESMO plano, que a escrita respeita
 * a partição, e que a série continua resolvível depois.
 */

interface Parcela {
  id: string;
  numero: number;
  total: number;
  invoiceId: string | null;
  amount?: number;
  /** `null` na raiz da série. */
  parentId: string | null;
}

interface Cenario {
  parcelas: Parcela[];
  faturasPagas?: string[];
  /** Totais por fatura; ausente = soma das parcelas daquela fatura. */
  totaisFatura?: Record<string, number>;
  receivables?: {
    transactionId: string;
    isPaid: boolean;
  }[];
  /** Transações que comprovam a quitação de uma dívida. */
  comprovantesDeDivida?: string[];
}

function montar(cenario: Cenario) {
  const transactions = cenario.parcelas.map((p) =>
    makeTransaction({
      id: p.id,
      title: `Notebook ${p.numero}/${p.total}`,
      parentId: p.parentId,
      invoiceId: p.invoiceId,
      amount: money(p.amount ?? 100),
      date: utcDate(2026, 1, 10),
    }),
  );

  const idsFatura = [
    ...new Set(cenario.parcelas.map((p) => p.invoiceId).filter(Boolean)),
  ] as string[];

  const invoices = idsFatura.map((id) => {
    const somaDasParcelas = cenario.parcelas
      .filter((p) => p.invoiceId === id)
      .reduce((t, p) => t + (p.amount ?? 100), 0);
    return makeInvoice({
      id,
      status: cenario.faturasPagas?.includes(id) ? 'PAID' : 'OPEN',
      totalAmount: money(cenario.totaisFatura?.[id] ?? somaDasParcelas),
    });
  });

  const receivables = (cenario.receivables ?? []).map((r, i) =>
    makeReceivable({
      id: `rec-${i}`,
      transactionId: r.transactionId,
      isPaid: r.isPaid,
    }),
  );

  const state = { transactions, invoices, receivables };
  const deletes = {
    transactions: [] as string[],
    receivables: [] as string[],
    invoices: [] as string[],
  };

  /** Erro injetado para provar o rollback. */
  let falharNoDeleteDe: string | null = null;

  const client = {
    transaction: {
      findMany: vi.fn(async ({ where }: any) =>
        state.transactions.filter((tx) =>
          where.OR
            ? where.OR.some(
                (c: any) =>
                  (c.id !== undefined && tx.id === c.id) ||
                  (c.parentId !== undefined && tx.parentId === c.parentId),
              )
            : true,
        ),
      ),
      findFirst: vi.fn(
        async ({ where }: any) =>
          state.transactions.find((tx) => tx.parentId === where.parentId) ??
          null,
      ),
      delete: vi.fn(async ({ where }: any) => {
        if (falharNoDeleteDe === where.id) {
          throw new Error('falha simulada no meio da operação');
        }
        deletes.transactions.push(where.id);
        state.transactions = state.transactions.filter(
          (t) => t.id !== where.id,
        );
        return {};
      }),
    },
    invoice: {
      findMany: vi.fn(async ({ where }: any) =>
        state.invoices.filter((i) => where.id?.in?.includes(i.id) ?? true),
      ),
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.id?.in) {
          return (
            state.invoices.find(
              (i) =>
                where.id.in.includes(i.id) &&
                (where.status === undefined || i.status === where.status),
            ) ?? null
          );
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const invoice = state.invoices.find((i) => i.id === where.id)!;
        if (data.totalAmount?.decrement !== undefined) {
          invoice.totalAmount = invoice.totalAmount.minus(
            data.totalAmount.decrement,
          );
        }
        return invoice;
      }),
      delete: vi.fn(async ({ where }: any) => {
        deletes.invoices.push(where.id);
        state.invoices = state.invoices.filter((i) => i.id !== where.id);
        return {};
      }),
    },
    receivable: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where.paymentTransactionId?.in) return [];
        const ids: string[] = where.transactionId?.in ?? [];
        return state.receivables.filter((r) =>
          ids.includes(r.transactionId as string),
        );
      }),
      findFirst: vi.fn(async () => null),
      deleteMany: vi.fn(async ({ where }: any) => {
        const alvo = state.receivables.filter(
          (r) => r.transactionId === where.transactionId,
        );
        deletes.receivables.push(...alvo.map((r) => r.id));
        state.receivables = state.receivables.filter(
          (r) => r.transactionId !== where.transactionId,
        );
        return { count: alvo.length };
      }),
    },
    debt: {
      findMany: vi.fn(async ({ where }: any) => {
        const ids: string[] = where.paymentTransactionId?.in ?? [];
        return (cenario.comprovantesDeDivida ?? [])
          .filter((id) => ids.includes(id))
          .map((id) => ({ paymentTransactionId: id }));
      }),
      findFirst: vi.fn(async () => null),
    },
  };

  const prisma = {
    ...client,
    $transaction: vi.fn(async (fn: any) => {
      /*
        Snapshot antes de entrar: o Postgres desfaz a transação inteira num
        erro, e o duplo precisa fazer o mesmo, senão o teste de atomicidade
        passaria com metade das parcelas apagadas.
      */
      const antes = {
        transactions: [...state.transactions],
        invoices: state.invoices.map((i) => ({ ...i })),
        receivables: [...state.receivables],
      };
      try {
        return await fn(client);
      } catch (erro) {
        state.transactions = antes.transactions;
        state.invoices = antes.invoices;
        state.receivables = antes.receivables;
        deletes.transactions.length = 0;
        deletes.receivables.length = 0;
        deletes.invoices.length = 0;
        throw erro;
      }
    }),
  } as unknown as PrismaService;

  const entityValidation = {
    validateTransaction: vi.fn(async (id: string) => {
      const tx = state.transactions.find((t) => t.id === id);
      if (!tx) throw new Error(`Transação não encontrada: ${id}`);
      return tx;
    }),
  } as unknown as EntityValidationService;

  const service = new TransactionsService(prisma, entityValidation);

  /**
   * `remove` com `OPEN` sempre devolve o resultado — os escopos legados é que
   * retornam vazio. O narrowing fica aqui para não poluir cada asserção.
   */
  const removeOpen = async (id: string, expected?: string[]) =>
    (await service.remove(
      id,
      USER_ID,
      'OPEN',
      expected,
    )) as TransactionDeleteResult;

  return {
    service,
    removeOpen,
    state,
    deletes,
    /** Exposto para contar consultas — prova que o plano não é recalculado. */
    client,
    falhar: (id: string) => {
      falharNoDeleteDe = id;
    },
  };
}

/** Série de N parcelas: a primeira é raiz (`parentId: null`). */
const serie = (total: number, invoicePorParcela = true): Parcela[] =>
  Array.from({ length: total }, (_, i) => ({
    id: `t${i + 1}`,
    numero: i + 1,
    total,
    parentId: i === 0 ? null : 't1',
    invoiceId: invoicePorParcela ? `inv${i + 1}` : null,
  }));

describe('preview de exclusão', () => {
  it('S2: descreve 4 deletáveis e 6 preservadas', async () => {
    const { service } = montar({
      parcelas: serie(10),
      faturasPagas: ['inv1', 'inv2', 'inv3', 'inv4', 'inv5', 'inv6'],
    });

    const preview = await service.previewDelete('t7', USER_ID);

    expect(preview.isInstallment).toBe(true);
    expect(preview.seriesTotal).toBe(10);
    expect(preview.deletableCount).toBe(4);
    expect(preview.preservedCount).toBe(6);
    expect(preview.deletableTotal).toBe(400);
    expect(preview.deletable.map((d) => d.installmentNumber)).toEqual([
      7, 8, 9, 10,
    ]);
    expect(preview.preserved[0].reason).toBe('PAID_INVOICE');
    expect(preview.preserved[0].message).toContain('já foi paga');
  });

  it('a série é a mesma seja qual for a parcela usada para perguntar', async () => {
    /*
      C1: a ação opera sobre a série inteira. Perguntar pela 10ª não pode
      devolver menos do que perguntar pela 7ª — isso seria `NEXT` disfarçado.
    */
    const cenario = {
      parcelas: serie(10),
      faturasPagas: ['inv1', 'inv2', 'inv3', 'inv4', 'inv5', 'inv6'],
    };

    const daSetima = await montar(cenario).service.previewDelete('t7', USER_ID);
    const daDecima = await montar(cenario).service.previewDelete('t10', USER_ID);
    const daPrimeira = await montar(cenario).service.previewDelete(
      't1',
      USER_ID,
    );

    expect(daSetima.deletableCount).toBe(4);
    expect(daDecima.deletableCount).toBe(4);
    expect(daPrimeira.deletableCount).toBe(4);
  });

  it('S3: série inteiramente paga não tem nada a excluir', async () => {
    const { service } = montar({
      parcelas: serie(3),
      faturasPagas: ['inv1', 'inv2', 'inv3'],
    });

    const preview = await service.previewDelete('t1', USER_ID);

    expect(preview.deletableCount).toBe(0);
    expect(preview.preservedCount).toBe(3);
  });

  it('S10: compra à vista responde isInstallment=false em vez de erro', async () => {
    const { service } = montar({
      parcelas: [
        { id: 'avulsa', numero: 1, total: 1, parentId: null, invoiceId: 'inv1' },
      ],
    });

    const preview = await service.previewDelete('avulsa', USER_ID);

    expect(preview.isInstallment).toBe(false);
  });

  it('S5: conta a cobrança pendente que sairá junto', async () => {
    const { service } = montar({
      parcelas: serie(3),
      receivables: [{ transactionId: 't2', isPaid: false }],
    });

    const preview = await service.previewDelete('t1', USER_ID);

    expect(preview.receivablesRemoved).toBe(1);
  });

  it('S6: cobrança recebida protege a parcela', async () => {
    const { service } = montar({
      parcelas: serie(3),
      receivables: [{ transactionId: 't2', isPaid: true }],
    });

    const preview = await service.previewDelete('t1', USER_ID);

    const protegida = preview.preserved.find((p) => p.id === 't2');
    expect(protegida?.reason).toBe('RECEIVABLE_ALREADY_PAID');
    expect(preview.receivablesRemoved).toBe(0);
  });

  it('parcela que comprova quitação de dívida é preservada', async () => {
    const { service } = montar({
      parcelas: serie(3),
      comprovantesDeDivida: ['t2'],
    });

    const preview = await service.previewDelete('t1', USER_ID);

    expect(preview.preserved.find((p) => p.id === 't2')?.reason).toBe(
      'PAYMENT_TRANSACTION_LINKED',
    );
  });

  it('a prévia NÃO grava nada', async () => {
    const { service, state, deletes } = montar({
      parcelas: serie(4),
      faturasPagas: ['inv1'],
    });

    await service.previewDelete('t2', USER_ID);

    expect(state.transactions).toHaveLength(4);
    expect(deletes.transactions).toHaveLength(0);
    expect(deletes.receivables).toHaveLength(0);
    expect(deletes.invoices).toHaveLength(0);
  });
});

describe('execução com escopo OPEN', () => {
  it('S2: remove 7–10 e preserva 1–6', async () => {
    const { removeOpen, state, deletes } = montar({
      parcelas: serie(10),
      faturasPagas: ['inv1', 'inv2', 'inv3', 'inv4', 'inv5', 'inv6'],
    });

    const resultado = await removeOpen('t7');

    expect(resultado.deletedIds).toEqual(['t7', 't8', 't9', 't10']);
    expect(resultado.deletedCount).toBe(4);
    expect(resultado.preservedIds).toEqual([
      't1',
      't2',
      't3',
      't4',
      't5',
      't6',
    ]);
    expect(deletes.transactions).toEqual(['t7', 't8', 't9', 't10']);

    /* O histórico permanece — e com a numeração original. */
    expect(state.transactions.map((t) => t.title)).toEqual([
      'Notebook 1/10',
      'Notebook 2/10',
      'Notebook 3/10',
      'Notebook 4/10',
      'Notebook 5/10',
      'Notebook 6/10',
    ]);
  });

  it('uma parcela protegida NÃO bloqueia as outras', async () => {
    const { removeOpen } = montar({
      parcelas: serie(4),
      receivables: [{ transactionId: 't2', isPaid: true }],
    });

    const resultado = await removeOpen('t1');

    expect(resultado.deletedIds).toEqual(['t1', 't3', 't4']);
    expect(resultado.preservedIds).toEqual(['t2']);
  });

  it('S1: série inteiramente aberta desaparece', async () => {
    const { removeOpen, state } = montar({ parcelas: serie(3) });

    const resultado = await removeOpen('t2');

    expect(resultado.deletedCount).toBe(3);
    expect(state.transactions).toHaveLength(0);
  });

  it('S3: zero deletáveis recusa em vez de fingir sucesso', async () => {
    const { removeOpen, deletes } = montar({
      parcelas: serie(3),
      faturasPagas: ['inv1', 'inv2', 'inv3'],
    });

    await expect(removeOpen('t1')).rejects.toThrow(
      ConflictException,
    );
    expect(deletes.transactions).toHaveLength(0);
  });

  it('a cobrança pendente sai com a compra', async () => {
    const { removeOpen, deletes } = montar({
      parcelas: serie(2),
      receivables: [{ transactionId: 't1', isPaid: false }],
    });

    const resultado = await removeOpen('t1');

    expect(resultado.receivablesRemoved).toBe(1);
    expect(deletes.receivables).toHaveLength(1);
  });

  it('a cobrança RECEBIDA não é apagada nem desmarcada', async () => {
    const { removeOpen, state, deletes } = montar({
      parcelas: serie(3),
      receivables: [{ transactionId: 't2', isPaid: true }],
    });

    await removeOpen('t1');

    expect(deletes.receivables).toHaveLength(0);
    expect(state.receivables).toHaveLength(1);
    expect(state.receivables[0].isPaid).toBe(true);
  });

  it('a fatura que fica vazia é removida; a que tem outras compras não', async () => {
    const { removeOpen, deletes } = montar({
      parcelas: [
        { id: 't1', numero: 1, total: 2, parentId: null, invoiceId: 'invA' },
        { id: 't2', numero: 2, total: 2, parentId: 't1', invoiceId: 'invB' },
      ],
      /* invB carrega outras compras além desta parcela. */
      totaisFatura: { invA: 100, invB: 500 },
    });

    const resultado = await removeOpen('t1');

    expect(deletes.invoices).toEqual(['invA']);
    expect(resultado.invoicesEmptied).toBe(1);
  });

  it('compra à vista recusa OPEN em vez de apagar como ONE', async () => {
    const { removeOpen, deletes } = montar({
      parcelas: [
        { id: 'avulsa', numero: 1, total: 1, parentId: null, invoiceId: 'inv1' },
      ],
    });

    await expect(removeOpen('avulsa')).rejects.toThrow(
      BadRequestException,
    );
    expect(deletes.transactions).toHaveLength(0);
  });
});

describe('o 409 carrega o plano que o causou', () => {
  /*
    Sem o plano embutido o cliente precisaria de uma segunda requisição para
    saber o que mudou — e essa leitura poderia devolver um TERCEIRO estado,
    explicando a recusa por algo que não a causou.
  */

  /** O corpo estruturado que o Nest devolve, já tipado. */
  const corpoDo = (erro: unknown) =>
    (erro as ConflictException).getResponse() as {
      code: string;
      message: string;
      preview?: TransactionDeletePreview;
    };

  it('B1/B2: DELETE_SET_CHANGED traz a prévia do plano recalculado', async () => {
    const { removeOpen } = montar({
      parcelas: serie(4),
      faturasPagas: ['inv1'],
    });

    /* O cliente confirmou t1..t4; t1 já está protegida. */
    const erro = await removeOpen('t2', ['t1', 't2', 't3', 't4']).catch(
      (e: unknown) => e,
    );

    const corpo = corpoDo(erro);
    expect(corpo.code).toBe('DELETE_SET_CHANGED');
    expect(corpo.preview).toBeDefined();

    /* A prévia descreve exatamente o estado que causou a recusa. */
    expect(corpo.preview!.deletable.map((d) => d.id)).toEqual([
      't2',
      't3',
      't4',
    ]);
    expect(corpo.preview!.preserved.map((p) => p.id)).toEqual(['t1']);
    expect(corpo.preview!.deletableCount).toBe(3);
  });

  it('B3/B5: NO_DELETABLE traz a prévia com os motivos reais', async () => {
    const { removeOpen } = montar({
      parcelas: serie(3),
      faturasPagas: ['inv1', 'inv2'],
      receivables: [{ transactionId: 't3', isPaid: true }],
    });

    const erro = await removeOpen('t1').catch((e: unknown) => e);
    const corpo = corpoDo(erro);

    expect(corpo.code).toBe('NO_DELETABLE_INSTALLMENTS');
    expect(corpo.preview!.deletableCount).toBe(0);

    const motivos = Object.fromEntries(
      corpo.preview!.preserved.map((p) => [p.id, p.reason]),
    );
    expect(motivos.t1).toBe('PAID_INVOICE');
    expect(motivos.t3).toBe('RECEIVABLE_ALREADY_PAID');

    /* A frase acompanha o código — a tela não precisa traduzir. */
    expect(corpo.preview!.preserved[0].message).toBeTruthy();
  });

  it('B4: nenhuma das duas recusas grava nada', async () => {
    /*
      Observa as CHAMADAS de escrita, não só o estado final.

      O duplo desfaz o estado no rollback, como o Postgres faria — então
      conferir apenas `state` e `deletes` diria "nada mudou" mesmo se a
      operação tivesse tentado escrever antes de recusar. A recusa tem de
      acontecer ANTES de qualquer escrita, não ser desfeita depois.
    */
    const semEscrita = (h: ReturnType<typeof montar>, nome: string) => {
      expect(h.client.transaction.delete, nome).not.toHaveBeenCalled();
      expect(h.client.receivable.deleteMany, nome).not.toHaveBeenCalled();
      expect(h.client.invoice.update, nome).not.toHaveBeenCalled();
      expect(h.client.invoice.delete, nome).not.toHaveBeenCalled();
    };

    const semDeletavel = montar({
      parcelas: serie(2),
      faturasPagas: ['inv1', 'inv2'],
    });
    await semDeletavel.removeOpen('t1').catch(() => undefined);
    expect(semDeletavel.state.transactions).toHaveLength(2);
    semEscrita(semDeletavel, 'NO_DELETABLE_INSTALLMENTS');

    const conjuntoMudou = montar({
      parcelas: serie(3),
      faturasPagas: ['inv1'],
    });
    await conjuntoMudou
      .removeOpen('t2', ['t1', 't2', 't3'])
      .catch(() => undefined);
    expect(conjuntoMudou.state.transactions).toHaveLength(3);
    semEscrita(conjuntoMudou, 'DELETE_SET_CHANGED');
  });

  it('B6: o conjunto da prévia devolvida executa na segunda tentativa', async () => {
    const cenario = { parcelas: serie(4), faturasPagas: ['inv1'] };
    const { removeOpen } = montar(cenario);

    const erro = await removeOpen('t2', ['t1', 't2', 't3', 't4']).catch(
      (e: unknown) => e,
    );
    const idsAtualizados = corpoDo(erro).preview!.deletable.map((d) => d.id);

    /* Segunda confirmação, agora com o conjunto que o 409 informou. */
    const outra = montar(cenario);
    const resultado = await outra.removeOpen('t2', idsAtualizados);

    expect(resultado.deletedIds).toEqual(idsAtualizados);
  });

  it('a prévia embutida NÃO é recalculada por uma segunda leitura', async () => {
    /*
      Duas resoluções poderiam discordar. Contar as consultas de série prova
      que o corpo do erro reusa o plano já calculado.
    */
    const { removeOpen, client } = montar({
      parcelas: serie(3),
      faturasPagas: ['inv1'],
    });

    await removeOpen('t2', ['t1', 't2', 't3']).catch(() => undefined);

    const buscasDeSerie = client.transaction.findMany.mock.calls.filter(
      ([args]: [{ where?: { OR?: unknown } }]) => Boolean(args?.where?.OR),
    );
    expect(buscasDeSerie).toHaveLength(1);
  });
});

describe('conjunto obsoleto entre prévia e confirmação', () => {
  it('recusa quando o que pode ser excluído mudou', async () => {
    const { removeOpen, deletes } = montar({
      parcelas: serie(4),
      faturasPagas: ['inv1'],
    });

    /* O cliente confirmou um conjunto que já não é o atual. */
    await expect(
      removeOpen('t2', ['t1', 't2', 't3', 't4']),
    ).rejects.toThrow(ConflictException);

    expect(deletes.transactions).toHaveLength(0);
  });

  it('executa quando o conjunto confirmado ainda vale', async () => {
    const { removeOpen } = montar({ parcelas: serie(3), faturasPagas: ['inv1'] });

    const resultado = await removeOpen('t2', ['t2', 't3']);

    expect(resultado.deletedIds).toEqual(['t2', 't3']);
  });

  it('a ordem do conjunto confirmado não importa', async () => {
    const { removeOpen } = montar({ parcelas: serie(3), faturasPagas: ['inv1'] });

    const resultado = await removeOpen('t2', ['t3', 't2']);

    expect(resultado.deletedCount).toBe(2);
  });
});

describe('integridade da série', () => {
  it('R2: a raiz sai e o filho protegido continua resolvível', async () => {
    const { service, removeOpen, state } = montar({
      parcelas: serie(3),
      receivables: [{ transactionId: 't3', isPaid: true }],
    });

    await removeOpen('t1');

    /* A raiz foi removida; o filho preservado permanece. */
    expect(state.transactions.map((t) => t.id)).toEqual(['t3']);

    /*
      `parentId` continua apontando para a raiz ausente — e é justamente isso
      que mantém a série resolvível: `getInstallmentSeries` casa pelo ramo
      `{parentId: rootId}`. Reparentear reescreveria a história.
    */
    expect(state.transactions[0].parentId).toBe('t1');

    const preview = await service.previewDelete('t3', USER_ID);
    expect(preview.seriesTotal).toBe(1);
    expect(preview.preserved[0].installmentNumber).toBe(3);
  });

  it('R3: a raiz protegida fica e os filhos deletáveis saem', async () => {
    const { removeOpen, state } = montar({
      parcelas: serie(3),
      faturasPagas: ['inv1'],
    });

    const resultado = await removeOpen('t2');

    expect(resultado.deletedIds).toEqual(['t2', 't3']);
    expect(state.transactions.map((t) => t.id)).toEqual(['t1']);
  });

  it('R4: a série é alcançável a partir de um filho quando a raiz já sumiu', async () => {
    const { service } = montar({
      parcelas: [
        { id: 't2', numero: 2, total: 3, parentId: 't1', invoiceId: 'inv2' },
        { id: 't3', numero: 3, total: 3, parentId: 't1', invoiceId: 'inv3' },
      ],
    });

    const preview = await service.previewDelete('t2', USER_ID);

    expect(preview.seriesTotal).toBe(2);
    expect(preview.deletableCount).toBe(2);
  });

  it('nenhuma parcela é renumerada ou reparenteada', async () => {
    const { removeOpen, state } = montar({
      parcelas: serie(5),
      faturasPagas: ['inv1', 'inv2'],
    });

    await removeOpen('t3');

    expect(state.transactions.map((t) => t.title)).toEqual([
      'Notebook 1/5',
      'Notebook 2/5',
    ]);
    expect(state.transactions.map((t) => t.parentId)).toEqual([null, 't1']);
  });
});

describe('atomicidade', () => {
  it('erro no meio não deixa metade das parcelas apagada', async () => {
    const { removeOpen, state, deletes, falhar } = montar({
      parcelas: serie(4),
    });

    falhar('t3');

    await expect(removeOpen('t1')).rejects.toThrow(
      'falha simulada',
    );

    expect(state.transactions).toHaveLength(4);
    expect(deletes.transactions).toHaveLength(0);
    expect(deletes.receivables).toHaveLength(0);
    expect(deletes.invoices).toHaveLength(0);
  });
});

describe('isolamento do escopo OPEN', () => {
  it('o update recusa OPEN em vez de tratá-lo como ONE', async () => {
    /*
      O `normalizeScope` cai em `ONE` para qualquer valor desconhecido. Sem
      esta recusa, pedir "exclua as parcelas em aberto" na edição alteraria UMA
      parcela e devolveria sucesso — outra operação, apresentada como a pedida.
    */
    const { service } = montar({ parcelas: serie(3) });

    await expect(
      service.update('t1', USER_ID, { amount: 50 } as never, 'OPEN'),
    ).rejects.toThrow(BadRequestException);
  });

  it('os escopos legados continuam aceitos', async () => {
    const { service } = montar({ parcelas: serie(3) });

    /* ONE apaga só a parcela escolhida — comportamento inalterado. */
    await service.remove('t2', USER_ID, 'ONE');
  });
});
