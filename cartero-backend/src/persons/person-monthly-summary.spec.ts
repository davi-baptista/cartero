import { describe, expect, it, vi } from 'vitest';
import { PersonsService } from './persons.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID, money } from 'src/common/testing/fixtures';
import { belongsToCompetence } from 'src/common/helpers/person-settlement-month';
import { buildPersonSummary } from 'src/common/helpers/person-consolidated';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Saldo mensal de Pessoas, em lote
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A lista de Pessoas passou a mostrar o saldo de cada contato no mês. O risco
 * dessa tela não é visual — é DIVERGIR do detalhe.
 *
 * Se a lista dissesse R$ 300 e o drawer R$ 250 para a mesma pessoa no mesmo
 * mês, nenhum dos dois seria obviamente o errado, e o usuário não teria como
 * decidir em quem confiar. Por isso `monthlySummary` não reimplementa a
 * regra: chama `belongsToCompetence` e `buildPersonSummary`, os mesmos que
 * `getStatement` usa.
 *
 * Este arquivo prova três coisas: que os números batem com os helpers
 * canônicos, que o sinal do saldo tem o significado esperado, e que a busca é
 * em LOTE — o custo não pode crescer com o número de contatos.
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
  paidAt: null,
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
  paidAt: null,
  parentId: null,
  transactionId: transaction ? 'tx-1' : null,
  transaction,
});

interface Cenario {
  persons?: ReturnType<typeof pessoa>[];
  debts?: ReturnType<typeof divida>[];
  receivables?: ReturnType<typeof cobranca>[];
}

function build({ persons = [], debts = [], receivables = [] }: Cenario) {
  const personFind = vi.fn().mockResolvedValue(persons);
  const debtFind = vi.fn().mockResolvedValue(debts);
  const receivableFind = vi.fn().mockResolvedValue(receivables);

  const prisma = {
    person: { findMany: personFind },
    debt: { findMany: debtFind },
    receivable: { findMany: receivableFind },
  } as unknown as PrismaService;

  const service = new PersonsService(
    prisma,
    {} as unknown as EntityValidationService,
  );

  return { service, personFind, debtFind, receivableFind };
}

describe('itens 6 e 34: a lista concorda com o detalhe', () => {
  it('o saldo é o mesmo que os helpers canônicos produzem', async () => {
    /*
      Não recalculamos à mão: o esperado sai dos MESMOS helpers. Se a regra
      mudar, os dois lados mudam juntos — e o teste continua provando o
      acordo em vez de congelar um número.
    */
    const d = divida('d1', 'p1', 50, '2026-08-10');
    const r = cobranca('r1', 'p1', 350, '2026-08-20');

    const esperado = buildPersonSummary([r], [d]);

    const { service } = build({
      persons: [pessoa('p1', 'Mariana Souza')],
      debts: [d],
      receivables: [r],
    });

    const [linha] = await service.monthlySummary(USER_ID, COMPETENCIA);

    expect(linha.netBalance).toBe(esperado.netBalance);
    expect(linha.receivablePending).toBe(esperado.receivablePending);
    expect(linha.debtPending).toBe(esperado.debtPending);
    expect(linha.netBalance).toBe(300);
  });

  it('a elegibilidade usa `belongsToCompetence`, não uma cópia', () => {
    /*
      Vence em setembro e ainda não venceu: fora de agosto. É a regra do
      helper — o teste a afirma diretamente para deixar explícito qual
      comportamento a listagem herda.
    */
    const setembro = divida('d2', 'p1', 90, '2026-09-15');
    expect(belongsToCompetence(setembro, COMPETENCIA)).toBe(false);
  });

  it('item 35: item de mês anterior JÁ vencido continua contando (carry)', async () => {
    const atrasada = divida('d3', 'p1', 120, '2026-07-05');

    const { service } = build({
      persons: [pessoa('p1', 'Mariana Souza')],
      debts: [atrasada],
    });

    const [linha] = await service.monthlySummary(USER_ID, COMPETENCIA);

    // Negativo: você deve.
    expect(linha.netBalance).toBe(-120);
    expect(linha.debtPending).toBe(120);
  });

  it('item 37: recebível automático segue o VENCIMENTO, como no detalhe', async () => {
    /*
      Cuidado com a intuição aqui: a competência do saldo é o VENCIMENTO,
      mesmo no recebível automático.

      `referenceMonthOf` — que usa a data da compra — existe para ARQUIVAR o
      item no histórico. Quem decide se ele está em aberto num mês é
      `belongsToCompetence`, e essa usa `dueMonthOf`. A ponte por origem foi
      removida de propósito: "com o vencimento como regra única, todo item da
      competência vence nela".

      Compra em 16/08, vence com a fatura em 10/09 → pertence a SETEMBRO.
    */
    const automatico = cobranca('r2', 'p1', 200, '2026-09-10', {
      date: new Date('2026-08-16'),
    });

    const { service, receivableFind } = build({
      persons: [pessoa('p1', 'Mariana Souza')],
      receivables: [automatico],
    });

    const agosto = await service.monthlySummary(USER_ID, COMPETENCIA);
    expect(agosto[0].netBalance).toBe(0);

    const setembro = await service.monthlySummary(USER_ID, {
      year: 2026,
      month: 9,
    });
    expect(setembro[0].netBalance).toBe(200);

    /*
      A relação continua sendo pedida na query. Ela alimenta
      `referenceMonthOf` no detalhe, e carregá-la aqui mantém as duas
      superfícies com exatamente o mesmo material — se a regra voltar a
      considerar a origem, a lista acompanha sem virar um caso à parte.
    */
    expect(receivableFind.mock.calls[0][0].include).toEqual({
      transaction: { select: { date: true } },
    });
  });
});

describe('itens 8, 11 e 12: sinal e contatos sem movimento', () => {
  it('positivo = a pessoa te deve; negativo = você deve', async () => {
    const { service } = build({
      persons: [pessoa('p1', 'Mariana'), pessoa('p2', 'Rafael')],
      receivables: [cobranca('r1', 'p1', 300, '2026-08-20')],
      debts: [divida('d1', 'p2', 50, '2026-08-12')],
    });

    const linhas = await service.monthlySummary(USER_ID, COMPETENCIA);
    const porNome = Object.fromEntries(
      linhas.map((l) => [l.name, l.netBalance]),
    );

    expect(porNome['Mariana']).toBe(300);
    expect(porNome['Rafael']).toBe(-50);
  });

  it('contato sem movimento aparece com saldo zero', async () => {
    /*
      A página também é lista de contatos. Sumir com alguém porque não deve
      nada neste mês esconderia justamente quem está em dia — e o usuário
      concluiria que o cadastro foi perdido.
    */
    const { service } = build({
      persons: [pessoa('p1', 'Mariana'), pessoa('p3', 'Sem movimento')],
      receivables: [cobranca('r1', 'p1', 300, '2026-08-20')],
    });

    const linhas = await service.monthlySummary(USER_ID, COMPETENCIA);

    expect(linhas).toHaveLength(2);
    expect(linhas.find((l) => l.name === 'Sem movimento')).toMatchObject({
      netBalance: 0,
      receivablePending: 0,
      debtPending: 0,
    });
  });

  it('item 36: item órfão (sem pessoa) não entra em nenhuma linha', async () => {
    /*
      A FK é `ON DELETE SET NULL`: excluir o contato deixa o registro vivo com
      `personId` nulo. Ele não pertence a ninguém nesta tela — e não pode
      derrubar a listagem procurando um balde que não existe.
    */
    const orfa = { ...divida('d9', 'p-removida', 999, '2026-08-01') };

    const { service } = build({
      persons: [pessoa('p1', 'Mariana')],
      debts: [orfa],
    });

    const linhas = await service.monthlySummary(USER_ID, COMPETENCIA);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].netBalance).toBe(0);
  });
});

describe('itens 31 e 55: sem N+1', () => {
  it('o custo NÃO cresce com o número de contatos', async () => {
    /*
      Uma query por tabela, sempre. A alternativa óbvia — chamar o extrato por
      pessoa — seria N+1 numa tela criada justamente para evitar abrir pessoa
      por pessoa.
    */
    const muitos = Array.from({ length: 40 }, (_, i) =>
      pessoa(`p${i}`, `Contato ${i}`),
    );

    const { service, personFind, debtFind, receivableFind } = build({
      persons: muitos,
      receivables: [cobranca('r1', 'p3', 100, '2026-08-20')],
    });

    const linhas = await service.monthlySummary(USER_ID, COMPETENCIA);

    expect(linhas).toHaveLength(40);
    expect(personFind).toHaveBeenCalledTimes(1);
    expect(debtFind).toHaveBeenCalledTimes(1);
    expect(receivableFind).toHaveBeenCalledTimes(1);
  });

  it('só o que está em aberto é carregado', async () => {
    /*
      `isPaid: false` no `where`, não um filtro depois: item quitado nunca
      compõe saldo em aberto, e trazê-lo do banco para descartar em memória
      seria custo puro.
    */
    const { debtFind, receivableFind, service } = build({
      persons: [pessoa('p1', 'Mariana')],
    });

    await service.monthlySummary(USER_ID, COMPETENCIA);

    for (const consulta of [debtFind, receivableFind]) {
      expect(consulta.mock.calls[0][0].where).toMatchObject({
        userId: USER_ID,
        isPaid: false,
        personId: { not: null },
      });
    }
  });
});
