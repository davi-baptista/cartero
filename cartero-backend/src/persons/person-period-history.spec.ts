import { describe, expect, it, vi } from 'vitest';
import { PersonsService } from './persons.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * "Quanto houve" é diferente de "quanto falta"
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Um mês inteiramente resolvido virava R$ 0,00 em todas as linhas de Pessoas,
 * e a lista deixava de dizer quem devia a quem — o usuário tinha de abrir
 * pessoa por pessoa para reconstruir o histórico.
 *
 * A causa não era o cálculo: as consultas filtravam `isPaid: false` na
 * ORIGEM, então um item resolvido nunca chegava ao agregado.
 *
 * É a mesma separação que Invoice já tem: `totalAmount` não vira zero quando a
 * fatura é paga — o STATUS muda. Aqui isso são dois pares de campos:
 *
 *   netBalance / *Pending    o que ainda falta   (muda ao quitar)
 *   period*Total             o que houve no mês  (invariável ao settlement)
 *
 * O risco desta separação é um consumidor ler um par achando que é o outro.
 * Os nomes são distintos por isso, e os casos abaixo fixam a diferença de
 * forma observável.
 */

const COMPETENCIA = { year: 2026, month: 8 };

const pessoa = (id: string, name: string) => ({
  id,
  userId: USER_ID,
  name,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const divida = (
  id: string,
  personId: string,
  amount: number,
  dueDate: string,
) => ({
  id,
  userId: USER_ID,
  personId,
  amount: money(amount),
  dueDate: new Date(dueDate),
  isPaid: false,
  paidAt: null as Date | null,
  parentId: null,
});

const cobranca = (
  id: string,
  personId: string,
  amount: number,
  dueDate: string,
  /** Compra de origem — presente só no recebível automático. */
  transaction: { date: Date } | null = null,
) => ({
  id,
  userId: USER_ID,
  personId,
  amount: money(amount),
  dueDate: new Date(dueDate),
  isPaid: false,
  paidAt: null as Date | null,
  parentId: null,
  transactionId: transaction ? 'tx-1' : null,
  transaction,
});

/** O mesmo item, resolvido — para comparar os dois estados. */
function resolvida<T extends { isPaid: boolean; paidAt: Date | null }>(
  item: T,
): T {
  return { ...item, isPaid: true, paidAt: new Date('2026-08-20T03:00:00Z') };
}

/** Resolvida numa data específica, para os casos de `settledAt`. */
function resolvidaEm<T extends { isPaid: boolean; paidAt: Date | null }>(
  item: T,
  dia: string,
): T {
  return { ...item, isPaid: true, paidAt: new Date(`${dia}T12:00:00.000Z`) };
}

interface Cenario {
  persons?: ReturnType<typeof pessoa>[];
  debts?: ReturnType<typeof divida>[];
  receivables?: ReturnType<typeof cobranca>[];
}

function build({ persons = [], debts = [], receivables = [] }: Cenario) {
  /*
    ── O dublê HONRA o `where` ──

    Um `mockResolvedValue` fixo devolveria os itens resolvidos mesmo com um
    `isPaid: false` no filtro — e então reintroduzir o filtro na origem (a
    causa exata do bug) não faria nenhum teste falhar. Ele passaria a proteger
    a aritmética e nada mais.

    Filtrar aqui é o que torna a origem observável: é o mesmo recurso que
    `budget-temporality.spec.ts` usa para vigiar o `where` do Orçamento.
  */
  const aplicarFiltro = <T extends { isPaid: boolean }>(
    itens: T[],
    args?: { where?: { isPaid?: boolean } },
  ) => {
    const esperado = args?.where?.isPaid;
    if (esperado === undefined) return itens;
    return itens.filter((i) => i.isPaid === esperado);
  };

  const debtFind = vi.fn((args?: never) =>
    Promise.resolve(aplicarFiltro(debts, args)),
  );
  const receivableFind = vi.fn((args?: never) =>
    Promise.resolve(aplicarFiltro(receivables, args)),
  );

  const prisma = {
    person: { findMany: vi.fn().mockResolvedValue(persons) },
    debt: { findMany: debtFind },
    receivable: { findMany: receivableFind },
  } as unknown as PrismaService;

  const service = new PersonsService(
    prisma,
    {} as unknown as EntityValidationService,
  );

  return { service, debtFind, receivableFind };
}

describe('H1-H5: settlement não zera o histórico', () => {
  it('H1/H2: cobrança recebida CONTINUA no total do período', async () => {
    const aberta = cobranca('r1', 'p1', 350, '2026-08-10');

    const [antes] = await build({
      persons: [pessoa('p1', 'Rafael')],
      receivables: [aberta],
    }).service.monthlySummary(USER_ID, COMPETENCIA);

    const [depois] = await build({
      persons: [pessoa('p1', 'Rafael')],
      receivables: [resolvida(aberta)],
    }).service.monthlySummary(USER_ID, COMPETENCIA);

    /* O histórico é o MESMO nos dois estados. */
    expect(antes.periodReceivableTotal).toBe(350);
    expect(depois.periodReceivableTotal).toBe(350);

    /* E o outstanding é o que muda. */
    expect(antes.receivablePending).toBe(350);
    expect(depois.receivablePending).toBe(0);
  });

  it('H3/H4: dívida paga CONTINUA no total do período', async () => {
    const aberta = divida('d1', 'p1', 120, '2026-08-15');

    const [antes] = await build({
      persons: [pessoa('p1', 'Mariana')],
      debts: [aberta],
    }).service.monthlySummary(USER_ID, COMPETENCIA);

    const [depois] = await build({
      persons: [pessoa('p1', 'Mariana')],
      debts: [resolvida(aberta)],
    }).service.monthlySummary(USER_ID, COMPETENCIA);

    expect(antes.periodDebtTotal).toBe(120);
    expect(depois.periodDebtTotal).toBe(120);
    expect(antes.debtPending).toBe(120);
    expect(depois.debtPending).toBe(0);
  });

  it('H5: mês inteiramente resolvido conserva os valores', async () => {
    /*
      Se este caso falhar, a feature inteira falhou: quitar voltou a apagar o
      valor do mês.
    */
    const { service } = build({
      persons: [pessoa('p1', 'Eva')],
      receivables: [resolvida(cobranca('r1', 'p1', 500, '2026-08-05'))],
      debts: [resolvida(divida('d1', 'p1', 200, '2026-08-08'))],
    });

    const [linha] = await service.monthlySummary(USER_ID, COMPETENCIA);

    expect(linha.periodReceivableTotal).toBe(500);
    expect(linha.periodDebtTotal).toBe(200);
    /* Nada em aberto — mas o mês movimentou. */
    expect(linha.netBalance).toBe(0);
    expect(linha.settledReceivablesCount).toBe(1);
    expect(linha.settledDebtsCount).toBe(1);
  });
});

describe('H6-H10: múltiplos itens e competência', () => {
  it('H6/H7: os itens somam, resolvidos incluídos', async () => {
    const { service } = build({
      persons: [pessoa('p1', 'Breno')],
      receivables: [
        resolvida(cobranca('r1', 'p1', 100, '2026-08-05')),
        resolvida(cobranca('r2', 'p1', 250, '2026-08-12')),
      ],
      debts: [
        resolvida(divida('d1', 'p1', 50, '2026-08-06')),
        resolvida(divida('d2', 'p1', 150, '2026-08-20')),
      ],
    });

    const [linha] = await service.monthlySummary(USER_ID, COMPETENCIA);

    /* Não reduzir ao último item nem ao maior. */
    expect(linha.periodReceivableTotal).toBe(350);
    expect(linha.periodDebtTotal).toBe(200);
  });

  it('H8: uma resolvida + uma aberta somam as DUAS', async () => {
    /*
      O histórico inclui tudo que a competência movimentou; o outstanding
      conta só o que resta. Os dois números convivem na mesma linha.
    */
    const { service } = build({
      persons: [pessoa('p1', 'Jorge')],
      receivables: [
        resolvida(cobranca('r1', 'p1', 300, '2026-08-05')),
        cobranca('r2', 'p1', 200, '2026-08-25'),
      ],
    });

    const [linha] = await service.monthlySummary(USER_ID, COMPETENCIA);

    expect(linha.periodReceivableTotal).toBe(500);
    expect(linha.receivablePending).toBe(200);
  });

  it('H9: item resolvido de OUTRO mês não entra', async () => {
    /*
      A competência do histórico é o `dueMonth` exato, sem carry: uma dívida
      de julho paga em agosto pertence a julho — foi lá que ela venceu.
    */
    const { service } = build({
      persons: [pessoa('p1', 'Ana')],
      receivables: [resolvida(cobranca('r1', 'p1', 999, '2026-07-10'))],
    });

    const [linha] = await service.monthlySummary(USER_ID, COMPETENCIA);

    expect(linha.periodReceivableTotal).toBe(0);
    expect(linha.settledReceivablesCount).toBe(0);
  });

  it('H10: trocar a competência troca o histórico', async () => {
    const cenario: Cenario = {
      persons: [pessoa('p1', 'Ana')],
      receivables: [
        resolvida(cobranca('r1', 'p1', 400, '2026-07-10')),
        resolvida(cobranca('r2', 'p1', 700, '2026-08-10')),
      ],
    };

    const [julho] = await build(cenario).service.monthlySummary(USER_ID, {
      year: 2026,
      month: 7,
    });
    const [agosto] = await build(cenario).service.monthlySummary(
      USER_ID,
      COMPETENCIA,
    );

    expect(julho.periodReceivableTotal).toBe(400);
    expect(agosto.periodReceivableTotal).toBe(700);
  });

  it('o recebível automático segue o VENCIMENTO, não a compra', async () => {
    /*
      A competência canônica é uma só: o mês civil de `dueDate`, para todos os
      tipos. A "ponte por origem" existiu e foi REMOVIDA — ela fazia a compra
      de agosto que vence em 10/09 aparecer nos dois meses, como se fossem
      duas obrigações.

      `referenceMonth` continua no contrato como metadado ("No cartão"), sem
      decidir onde o item aparece. O histórico herda essa regra de graça:
      usa a mesma `dueMonthOf` das pendências.
    */
    const auto = cobranca('r1', 'p1', 240, '2026-08-10', {
      date: new Date('2026-07-16T03:00:00Z'),
    });
    const { service } = build({
      persons: [pessoa('p1', 'Eva')],
      receivables: [resolvida(auto)],
    });

    /* Vence em agosto → histórico de agosto, mesmo comprado em julho. */
    const [agosto] = await service.monthlySummary(USER_ID, COMPETENCIA);
    expect(agosto.periodReceivableTotal).toBe(240);

    const [julho] = await build({
      persons: [pessoa('p1', 'Eva')],
      receivables: [resolvida(auto)],
    }).service.monthlySummary(USER_ID, { year: 2026, month: 7 });
    expect(julho.periodReceivableTotal).toBe(0);
  });
});

describe('H11-H16: os dois pares coexistem', () => {
  it('H11-H13: misto preserva os componentes dos dois lados', async () => {
    const { service } = build({
      persons: [pessoa('p1', 'Misto')],
      receivables: [
        resolvida(cobranca('r1', 'p1', 300, '2026-08-05')),
        cobranca('r2', 'p1', 200, '2026-08-25'),
      ],
      debts: [resolvida(divida('d1', 'p1', 100, '2026-08-08'))],
    });

    const [linha] = await service.monthlySummary(USER_ID, COMPETENCIA);

    /* Histórico: tudo que houve. */
    expect(linha.periodReceivableTotal).toBe(500);
    expect(linha.periodDebtTotal).toBe(100);
    /* Outstanding: só o que resta. */
    expect(linha.receivablePending).toBe(200);
    expect(linha.debtPending).toBe(0);
    expect(linha.netBalance).toBe(200);
  });

  it('H15: líquido zero COM movimento não é "nada aconteceu"', async () => {
    /*
      R$ 200 de cada lado, tudo resolvido: o líquido é zero nos dois campos, e
      só as CONTAGENS distinguem este mês de um mês vazio. É a informação que
      a UI usa para não dizer "SEM SALDO" onde houve movimento.
    */
    const { service } = build({
      persons: [pessoa('p1', 'Zerado')],
      receivables: [resolvida(cobranca('r1', 'p1', 200, '2026-08-05'))],
      debts: [resolvida(divida('d1', 'p1', 200, '2026-08-08'))],
    });

    const [linha] = await service.monthlySummary(USER_ID, COMPETENCIA);

    expect(linha.periodReceivableTotal).toBe(200);
    expect(linha.periodDebtTotal).toBe(200);
    expect(linha.netBalance).toBe(0);
    /* O que prova que houve movimento. */
    expect(linha.settledReceivablesCount + linha.settledDebtsCount).toBe(2);
  });

  it('H16: pessoa sem NENHUM movimento fica realmente em zero', async () => {
    const { service } = build({ persons: [pessoa('p1', 'Vazio')] });

    const [linha] = await service.monthlySummary(USER_ID, COMPETENCIA);

    expect(linha.periodReceivableTotal).toBe(0);
    expect(linha.periodDebtTotal).toBe(0);
    expect(linha.settledReceivablesCount).toBe(0);
    expect(linha.settledDebtsCount).toBe(0);
  });

  it('o campo antigo conserva o significado antigo', async () => {
    /*
      Compatibilidade: `netBalance` continua sendo OUTSTANDING. Mudá-lo para
      histórico faria todo consumidor existente — drawer, settle, WhatsApp —
      passar a ler outra coisa em silêncio.
    */
    const { service } = build({
      persons: [pessoa('p1', 'Compat')],
      receivables: [resolvida(cobranca('r1', 'p1', 500, '2026-08-05'))],
    });

    const [linha] = await service.monthlySummary(USER_ID, COMPETENCIA);

    expect(linha.netBalance).toBe(0);
    expect(linha.periodReceivableTotal).toBe(500);
  });

  it('sem N+1: uma consulta por coleção, qualquer que seja o nº de pessoas', async () => {
    const { service, debtFind, receivableFind } = build({
      persons: [
        pessoa('p1', 'A'),
        pessoa('p2', 'B'),
        pessoa('p3', 'C'),
        pessoa('p4', 'D'),
      ],
      receivables: [resolvida(cobranca('r1', 'p1', 100, '2026-08-05'))],
    });

    await service.monthlySummary(USER_ID, COMPETENCIA);

    expect(debtFind).toHaveBeenCalledTimes(1);
    expect(receivableFind).toHaveBeenCalledTimes(1);
  });
});

describe('H17-H21: `settledAt` chega à lista de Pessoas', () => {
  it('H17: competência inteiramente resolvida devolve a MAIOR data', async () => {
    /*
      O que a row afirma ao dizer "Quitado em 18/08": quando o último item
      pendente foi liquidado, e portanto quando a relação daquele mês ficou
      integralmente resolvida.
    */
    const [eva] = await build({
      persons: [pessoa('p1', 'Eva')],
      debts: [
        resolvidaEm(divida('d1', 'p1', 100, '2026-08-05'), '2026-08-11'),
        resolvidaEm(divida('d2', 'p1', 200, '2026-08-07'), '2026-08-18'),
      ],
    }).service.monthlySummary(USER_ID, COMPETENCIA);

    expect(eva.settledAt).toBe('2026-08-18');
  });

  it('H18: pendência aberta zera a data', async () => {
    /*
      Com uma dívida em aberto, a data do que já foi pago não é a conclusão de
      nada — a row cairia em "Quitado em" com obrigação viva na mesa.
    */
    const [eva] = await build({
      persons: [pessoa('p1', 'Eva')],
      debts: [
        resolvidaEm(divida('d1', 'p1', 100, '2026-08-05'), '2026-08-11'),
        divida('d2', 'p1', 200, '2026-08-20'),
      ],
    }).service.monthlySummary(USER_ID, COMPETENCIA);

    expect(eva.settledAt).toBeNull();
  });

  it('H19: os dois lados contam', async () => {
    /*
      Recebível aberto também impede: a relação não terminou porque falta
      alguém pagar VOCÊ.
    */
    const [eva] = await build({
      persons: [pessoa('p1', 'Eva')],
      debts: [resolvidaEm(divida('d1', 'p1', 100, '2026-08-05'), '2026-08-11')],
      receivables: [cobranca('r1', 'p1', 50, '2026-08-22')],
    }).service.monthlySummary(USER_ID, COMPETENCIA);

    expect(eva.settledAt).toBeNull();
  });

  it('H20: resolvido sem `paidAt` não herda a data de outro', async () => {
    const [eva] = await build({
      persons: [pessoa('p1', 'Eva')],
      debts: [
        resolvidaEm(divida('d1', 'p1', 100, '2026-08-05'), '2026-08-18'),
        { ...divida('d2', 'p1', 200, '2026-08-07'), isPaid: true, paidAt: null },
      ],
    }).service.monthlySummary(USER_ID, COMPETENCIA);

    expect(eva.settledAt).toBeNull();
  });

  it('H21: pessoa sem movimento não tem data', async () => {
    const [eva] = await build({
      persons: [pessoa('p1', 'Eva')],
    }).service.monthlySummary(USER_ID, COMPETENCIA);

    expect(eva.settledAt).toBeNull();
  });

  it('o valor histórico continua intacto ao lado da data', async () => {
    /* A fase anterior não regrediu: quitar muda o status, não o valor. */
    const [eva] = await build({
      persons: [pessoa('p1', 'Eva')],
      receivables: [
        resolvidaEm(cobranca('r1', 'p1', 350, '2026-08-10'), '2026-08-14'),
      ],
    }).service.monthlySummary(USER_ID, COMPETENCIA);

    expect(eva.periodReceivableTotal).toBe(350);
    expect(eva.receivablePending).toBe(0);
    expect(eva.settledAt).toBe('2026-08-14');
  });
});
