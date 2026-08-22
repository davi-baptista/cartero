import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertAutomaticReceivableNotDeleted,
  assertDebtNotPaid,
  assertNotAutomaticReceivable,
  assertReceivableNotReceived,
  changesSettlementFacts,
} from './settlement.guard';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Integridade de quitação e de cobrança derivada (Fase 8A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A auditoria encontrou proteção cuidadosa num sentido — editar a compra com
 * recebível pago era bloqueado — e nada no inverso: editar o recebível
 * automático, editar o recebível já recebido, editar a dívida já paga, tudo
 * passava.
 *
 * O dano do lado aberto era pior que o do lado protegido, porque silencioso:
 * `syncLinkedReceivable` sobrescreve a edição do usuário depois, sem aviso.
 */

const base = {
  amount: 500,
  personId: 'person-1' as string | null,
  dueDate: new Date(Date.UTC(2026, 8, 10, 12)),
  occurredAt: new Date(Date.UTC(2026, 7, 1, 12)),
};

describe('changesSettlementFacts', () => {
  it('valor diferente conta como fato financeiro', () => {
    expect(changesSettlementFacts({ amount: 100 }, base)).toBe(true);
  });

  it('mesmo valor não conta', () => {
    expect(changesSettlementFacts({ amount: 500 }, base)).toBe(false);
  });

  it('trocar a pessoa conta', () => {
    expect(changesSettlementFacts({ personId: 'person-2' }, base)).toBe(true);
  });

  it('remover a pessoa conta', () => {
    expect(changesSettlementFacts({ personId: null }, base)).toBe(true);
  });

  it('mudar o vencimento conta', () => {
    expect(changesSettlementFacts({ dueDate: '2026-09-20' }, base)).toBe(true);
  });

  it('reenviar o mesmo vencimento não conta', () => {
    // O formulário devolve todos os campos; reenviar o valor atual não é
    // alteração, e tratá-lo como tal bloquearia editar só a descrição.
    expect(changesSettlementFacts({ dueDate: '2026-09-10' }, base)).toBe(false);
  });

  it('mudar a data da ocorrência conta', () => {
    expect(changesSettlementFacts({ occurredAt: '2026-07-15' }, base)).toBe(
      true,
    );
  });

  it('trocar a contraparte por nome livre conta', () => {
    expect(changesSettlementFacts({ creditorName: 'Enel' }, base)).toBe(true);
    expect(changesSettlementFacts({ debtorName: 'Eva' }, base)).toBe(true);
  });

  it('título e descrição NÃO são fato financeiro', () => {
    // Não aparecem em `SettlementFacts`, então um payload só com eles passa.
    expect(changesSettlementFacts({}, base)).toBe(false);
  });
});

describe('assertDebtNotPaid', () => {
  it('dívida pendente aceita qualquer alteração', () => {
    expect(() =>
      assertDebtNotPaid({ isPaid: false }, { amount: 100 }, base),
    ).not.toThrow();
  });

  it('dívida paga recusa mudança de valor', () => {
    expect(() =>
      assertDebtNotPaid({ isPaid: true }, { amount: 100 }, base),
    ).toThrow(ConflictException);
  });

  it('a mensagem orienta desfazer o pagamento', () => {
    try {
      assertDebtNotPaid({ isPaid: true }, { amount: 100 }, base);
      expect.unreachable('deveria ter lançado');
    } catch (error: any) {
      expect(error.response.code).toBe('PAID_DEBT_EDIT_BLOCKED');
      expect(error.response.message).toMatch(/[Dd]esfaça o pagamento/);
    }
  });

  it('dívida paga aceita alteração puramente descritiva', () => {
    // Corrigir um título não contradiz o pagamento.
    expect(() => assertDebtNotPaid({ isPaid: true }, {}, base)).not.toThrow();
  });
});

describe('assertReceivableNotReceived', () => {
  it('cobrança pendente aceita alteração', () => {
    expect(() =>
      assertReceivableNotReceived({ isPaid: false }, { amount: 1 }, base),
    ).not.toThrow();
  });

  it('cobrança recebida recusa mudança de valor', () => {
    /**
     * Sem esta guarda, um `PATCH { amount: 999 }` numa cobrança recebida
     * gravava o novo valor enquanto a transação INCOME do recebimento ficava
     * com o antigo — extrato e cobrança divergentes para sempre.
     */
    expect(() =>
      assertReceivableNotReceived({ isPaid: true }, { amount: 999 }, base),
    ).toThrow(ConflictException);
  });

  it('a mensagem orienta desfazer o recebimento', () => {
    try {
      assertReceivableNotReceived({ isPaid: true }, { amount: 999 }, base);
      expect.unreachable('deveria ter lançado');
    } catch (error: any) {
      expect(error.response.code).toBe('PAID_RECEIVABLE_EDIT_BLOCKED');
      expect(error.response.message).toMatch(/[Dd]esfaça o recebimento/);
    }
  });
});

describe('assertNotAutomaticReceivable', () => {
  const automatic = { transactionId: 'tx-1' };
  const manual = { transactionId: null };

  it('cobrança manual aceita alteração financeira', () => {
    expect(() =>
      assertNotAutomaticReceivable(manual, { amount: 100 }, base),
    ).not.toThrow();
  });

  it('cobrança automática recusa mudança de valor', () => {
    expect(() =>
      assertNotAutomaticReceivable(automatic, { amount: 100 }, base),
    ).toThrow(ConflictException);
  });

  it('recusa trocar a pessoa da cobrança automática', () => {
    // Quem deve vem da compra; trocar aqui divergiria do `personId` dela.
    expect(() =>
      assertNotAutomaticReceivable(automatic, { personId: 'person-2' }, base),
    ).toThrow(ConflictException);
  });

  it('recusa mudar o vencimento da cobrança automática', () => {
    // O vencimento acompanha a fatura da compra.
    expect(() =>
      assertNotAutomaticReceivable(automatic, { dueDate: '2026-10-01' }, base),
    ).toThrow(ConflictException);
  });

  it('a mensagem aponta para a compra de origem', () => {
    try {
      assertNotAutomaticReceivable(automatic, { amount: 100 }, base);
      expect.unreachable('deveria ter lançado');
    } catch (error: any) {
      expect(error.response.code).toBe(
        'AUTOMATIC_RECEIVABLE_MANAGED_BY_TRANSACTION',
      );
      expect(error.response.message).toMatch(/compra/i);
    }
  });

  it('cobrança automática aceita alteração descritiva', () => {
    /**
     * Descrição não é sincronizada pela compra, então editá-la não cria
     * divergência nem será sobrescrita. Bloquear tudo por conveniência
     * tiraria do usuário a única coisa que ele pode ajustar aqui.
     */
    expect(() =>
      assertNotAutomaticReceivable(automatic, {}, base),
    ).not.toThrow();
  });
});

describe('assertAutomaticReceivableNotDeleted', () => {
  it('cobrança manual pode ser excluída', () => {
    expect(() =>
      assertAutomaticReceivableNotDeleted({ transactionId: null }),
    ).not.toThrow();
  });

  it('cobrança automática recusa exclusão direta', () => {
    /**
     * Excluir a cobrança sem tocar a compra deixaria a transação com
     * `personId` preenchido e nenhuma cobrança — a automação quebrada, sem
     * nada que a reconstrua.
     */
    expect(() =>
      assertAutomaticReceivableNotDeleted({ transactionId: 'tx-1' }),
    ).toThrow(ConflictException);
  });

  it('a mensagem indica o caminho válido', () => {
    try {
      assertAutomaticReceivableNotDeleted({ transactionId: 'tx-1' });
      expect.unreachable('deveria ter lançado');
    } catch (error: any) {
      expect(error.response.message).toMatch(/compra de origem/i);
    }
  });
});
