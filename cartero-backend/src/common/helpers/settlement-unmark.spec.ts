import { describe, expect, it } from 'vitest';
import {
  assertDebtNotPaid,
  assertReceivableNotReceived,
} from './settlement.guard';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A guarda não pode trancar a própria saída
 * ══════════════════════════════════════════════════════════════════════════
 *
 * As guardas de "já pago / já recebido" rodam em TODO update, inclusive no que
 * desfaz a quitação. Se elas barrassem o desfazer, o registro ficaria preso:
 * não poderia ser corrigido (está pago) nem reaberto (a guarda recusa).
 *
 * O que salva é a condição ser `changesSettlementFacts`, não `isPaid`: o
 * payload de desfazer carrega apenas `isPaid: false`, que não é fato
 * financeiro.
 *
 * Estes testes existem porque essa propriedade é fácil de perder numa
 * refatoração — bastaria a guarda passar a olhar `isPaid` em vez dos campos.
 */

const paid = {
  amount: 500,
  personId: 'person-1' as string | null,
  dueDate: new Date(Date.UTC(2026, 8, 10, 12)),
  occurredAt: new Date(Date.UTC(2026, 7, 1, 12)),
};

describe('desfazer quitação continua possível', () => {
  it('dívida paga aceita `isPaid: false`', () => {
    expect(() => assertDebtNotPaid({ isPaid: true }, {}, paid)).not.toThrow();
  });

  it('cobrança recebida aceita `isPaid: false`', () => {
    expect(() =>
      assertReceivableNotReceived({ isPaid: true }, {}, paid),
    ).not.toThrow();
  });

  it('desfazer reenviando os MESMOS valores continua passando', () => {
    /**
     * O formulário costuma devolver o objeto inteiro. Como a comparação é por
     * valor — e não pela presença da chave —, reenviar o que já está lá não
     * conta como alteração e o desfazer passa.
     */
    expect(() =>
      assertDebtNotPaid(
        { isPaid: true },
        {
          amount: 500,
          personId: 'person-1',
          dueDate: '2026-09-10',
          occurredAt: '2026-08-01',
        },
        paid,
      ),
    ).not.toThrow();
  });

  it('mas desfazer JUNTO com mudança de valor é recusado', () => {
    /**
     * Aqui a recusa é correta e deliberada: desfazer e corrigir na mesma
     * requisição esconderia qual valor foi efetivamente pago. São dois passos
     * porque são duas decisões.
     */
    expect(() =>
      assertDebtNotPaid({ isPaid: true }, { amount: 100 }, paid),
    ).toThrow();
  });

  it('registro pendente nunca é barrado, com qualquer payload', () => {
    expect(() =>
      assertDebtNotPaid(
        { isPaid: false },
        { amount: 1, personId: null, dueDate: '2020-01-01' },
        paid,
      ),
    ).not.toThrow();
  });
});
