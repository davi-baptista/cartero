import { describe, expect, it } from 'vitest';
import { buildPersonSummary } from 'src/common/helpers/person-consolidated';
import { money } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Consolidado da Person — totais e saldo (Fase 8B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O resumo é ALL-TIME. Antes era filtrado pelo mês do seletor e rotulado
 * "no total": uma dívida vencida em junho e ainda aberta simplesmente não
 * entrava na conta de agosto.
 *
 * O caso que dá nome à regra é o saldo zero COM pendências: R$ 500 dos dois
 * lados somam zero, e ainda assim há duas obrigações abertas. Nenhuma tela
 * pode dizer "tudo acertado" ali.
 */

const item = (amount: number) => ({ amount: money(amount) });

describe('Totais do consolidado', () => {
  it('somente cobranças: 500 / 0 / +500', () => {
    const summary = buildPersonSummary([item(500)], []);

    expect(summary.receivablePending).toBe(500);
    expect(summary.debtPending).toBe(0);
    expect(summary.netBalance).toBe(500);
    expect(summary.isFullySettled).toBe(false);
  });

  it('somente dívidas: 0 / 500 / -500', () => {
    const summary = buildPersonSummary([], [item(500)]);

    expect(summary.receivablePending).toBe(0);
    expect(summary.debtPending).toBe(500);
    expect(summary.netBalance).toBe(-500);
  });

  it('os dois lados: 500 / 200 / +300', () => {
    const summary = buildPersonSummary([item(500)], [item(200)]);

    expect(summary.netBalance).toBe(300);
    expect(summary.pendingReceivablesCount).toBe(1);
    expect(summary.pendingDebtsCount).toBe(1);
  });

  it('nada pendente: 0 / 0 / 0 e quitado', () => {
    const summary = buildPersonSummary([], []);

    expect(summary.netBalance).toBe(0);
    expect(summary.isFullySettled).toBe(true);
  });
});

describe('Saldo líquido zero NÃO é quitação', () => {
  const summary = buildPersonSummary([item(500)], [item(500)]);

  it('o saldo é zero', () => {
    expect(summary.netBalance).toBe(0);
  });

  it('mas as duas pendências continuam abertas', () => {
    expect(summary.pendingReceivablesCount).toBe(1);
    expect(summary.pendingDebtsCount).toBe(1);
  });

  it('e a composição não desaparece no saldo', () => {
    // O saldo sozinho é indistinguível de "não há nada". Os dois lados
    // precisam continuar visíveis para a UI poder dizer a verdade.
    expect(summary.receivablePending).toBe(500);
    expect(summary.debtPending).toBe(500);
  });

  it('NÃO está totalmente quitado', () => {
    /**
     * A propriedade que este arquivo existe para vigiar.
     *
     * `isFullySettled` olha as CONTAGENS, não o saldo. Se algum dia alguém
     * reescrever isso como `netBalance === 0`, o WhatsApp volta a dizer
     * "estamos quites" para quem tem R$ 500 a receber.
     */
    expect(summary.isFullySettled).toBe(false);
  });
});

describe('Decimais', () => {
  it('soma centavos sem erro de ponto flutuante', () => {
    const summary = buildPersonSummary([item(0.1), item(0.2)], [item(0.3)]);

    // 0.1 + 0.2 === 0.30000000000000004 em float puro; `money` usa Decimal.
    expect(summary.receivablePending).toBeCloseTo(0.3, 10);
    expect(summary.netBalance).toBeCloseTo(0, 10);
    expect(summary.isFullySettled).toBe(false);
  });
});
