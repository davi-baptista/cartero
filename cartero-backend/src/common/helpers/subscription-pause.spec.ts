import { describe, expect, it } from 'vitest';
import {
  formatCycle,
  nextChargeDate,
  pendingCycles,
  resumeCycle,
} from './subscription.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Pausa e reativação de assinatura (Fase 7A)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O defeito que esta fase corrige: `isActive + startedAt + lastGeneratedFor`
 * não distinguiam "mês pendente porque o cron ficou fora do ar" (deve gerar)
 * de "mês em que a assinatura estava pausada" (não deve). Pausar três meses e
 * reativar produzia as três cobranças de uma vez — como se a pausa fosse
 * apenas o cron desligado.
 *
 * `activeSince` marca o primeiro ciclo que a ATIVAÇÃO ATUAL pode gerar.
 * `startedAt` continua significando "assinando desde" e não é tocado.
 */

const at = (iso: string) => new Date(iso);
const cycles = (list: ReturnType<typeof pendingCycles>) =>
  list.map(formatCycle);

describe('resumeCycle — primeiro ciclo após reativar', () => {
  it('dia ainda não passou: o mês corrente conta', () => {
    // Reativa em 10/08, cobrança dia 25.
    expect(formatCycle(resumeCycle(25, at('2026-08-10T12:00:00Z')))).toBe(
      '2026-08',
    );
  });

  it('dia já passou: começa no mês seguinte', () => {
    // Reativa em 20/08, cobrança dia 12 — não cria cobrança retroativa.
    expect(formatCycle(resumeCycle(12, at('2026-08-20T12:00:00Z')))).toBe(
      '2026-09',
    );
  });

  it('reativar no PRÓPRIO dia da cobrança inclui o mês corrente', () => {
    // O dia da cobrança pertence ao ciclo que cobra nele — mesma convenção
    // que `pendingCycles` usa para o ciclo corrente.
    expect(formatCycle(resumeCycle(20, at('2026-08-20T12:00:00Z')))).toBe(
      '2026-08',
    );
  });

  it('a hora da reativação não decide nada — comparação por dia civil', () => {
    const early = formatCycle(resumeCycle(20, at('2026-08-20T00:30:00Z')));
    const late = formatCycle(resumeCycle(20, at('2026-08-20T23:30:00Z')));
    expect(early).toBe(late);
    expect(early).toBe('2026-08');
  });

  it('dezembro vira janeiro do ano seguinte', () => {
    expect(formatCycle(resumeCycle(5, at('2026-12-20T12:00:00Z')))).toBe(
      '2027-01',
    );
  });

  it('dia 31 em mês curto: o clamp decide se o mês ainda conta', () => {
    // Fevereiro de 2026 termina em 28; em 27/02 a cobrança (28) não passou.
    expect(formatCycle(resumeCycle(31, at('2026-02-27T12:00:00Z')))).toBe(
      '2026-02',
    );
    // Em 28/02 é o próprio dia da cobrança — ainda conta.
    expect(formatCycle(resumeCycle(31, at('2026-02-28T12:00:00Z')))).toBe(
      '2026-02',
    );
  });
});

describe('pendingCycles — pausa não gera catch-up', () => {
  it('sem activeSince o comportamento anterior é preservado', () => {
    // Assinatura que nunca foi pausada: nada muda para ela.
    expect(
      cycles(
        pendingCycles('2026-06', '2026-06', 12, at('2026-08-20T12:00:00Z')),
      ),
    ).toEqual(['2026-07', '2026-08']);
  });

  it('três meses pausada: nenhum dos meses da pausa é gerado', () => {
    /**
     * O caso central. Gerou até maio, ficou pausada jun/jul, reativou em
     * agosto. Antes: gerava 06, 07 e 08. Agora o marco corta a pausa.
     */
    expect(
      cycles(
        pendingCycles(
          '2026-01',
          '2026-05',
          12,
          at('2026-08-20T12:00:00Z'),
          '2026-09', // reativada em 20/08 com dia 12 já passado
        ),
      ),
    ).toEqual([]);
  });

  it('reativada antes do dia: o mês da reativação é elegível', () => {
    expect(
      cycles(
        pendingCycles(
          '2026-01',
          '2026-05',
          25,
          at('2026-08-26T12:00:00Z'),
          '2026-08',
        ),
      ),
    ).toEqual(['2026-08']);
  });

  it('o marco não ressuscita ciclo já gerado', () => {
    // `activeSince` no passado não pode reabrir meses que já lançaram.
    expect(
      cycles(
        pendingCycles(
          '2026-01',
          '2026-07',
          12,
          at('2026-08-20T12:00:00Z'),
          '2026-02',
        ),
      ),
    ).toEqual(['2026-08']);
  });

  it('o marco não é anulado por lastGeneratedFor antigo', () => {
    // Prevalece o mais restritivo: aqui, o marco de reativação.
    expect(
      cycles(
        pendingCycles(
          '2026-01',
          '2026-02',
          12,
          at('2026-08-20T12:00:00Z'),
          '2026-08',
        ),
      ),
    ).toEqual(['2026-08']);
  });

  it('segunda janela de pausa também funciona', () => {
    // Pausou, reativou em março, gerou até maio, pausou de novo, reativou em
    // setembro. Junho a agosto não devem existir.
    expect(
      cycles(
        pendingCycles(
          '2026-01',
          '2026-05',
          10,
          at('2026-09-15T12:00:00Z'),
          '2026-10',
        ),
      ),
    ).toEqual([]);
  });

  it('cron fora do ar continua recuperando os meses perdidos', () => {
    /**
     * A distinção que justifica o campo: aqui NÃO houve pausa, o sistema
     * apenas não rodou. Esses meses devem ser gerados — é o oposto do caso
     * da pausa, e sem `activeSince` os dois eram indistinguíveis.
     */
    expect(
      cycles(
        pendingCycles(
          '2026-01',
          '2026-05',
          12,
          at('2026-08-20T12:00:00Z'),
          null,
        ),
      ),
    ).toEqual(['2026-06', '2026-07', '2026-08']);
  });
});

describe('nextChargeDate — fonte única da próxima cobrança', () => {
  const base = {
    startedAt: '2026-01',
    lastGeneratedFor: '2026-08' as string | null,
    activeSince: null as string | null,
    dayOfMonth: 12,
    isActive: true,
  };

  it('pausada não tem próxima cobrança', () => {
    expect(
      nextChargeDate({ ...base, isActive: false }, at('2026-08-20T12:00:00Z')),
    ).toBeNull();
  });

  it('gerou o mês corrente: a próxima é no mês seguinte', () => {
    const next = nextChargeDate(base, at('2026-08-20T12:00:00Z'));
    expect(next?.toISOString().slice(0, 10)).toBe('2026-09-12');
  });

  it('dia ainda não chegou: a próxima é neste mês', () => {
    const next = nextChargeDate(
      { ...base, lastGeneratedFor: '2026-07' },
      at('2026-08-05T12:00:00Z'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-08-12');
  });

  it('ciclo pendente aparece como próxima cobrança', () => {
    // Cron atrasado: julho venceu e não gerou. É o que acontece a seguir.
    const next = nextChargeDate(
      { ...base, lastGeneratedFor: '2026-06' },
      at('2026-08-20T12:00:00Z'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-07-12');
  });

  it('reativada com o dia já passado: próxima no mês seguinte', () => {
    const next = nextChargeDate(
      { ...base, lastGeneratedFor: '2026-05', activeSince: '2026-09' },
      at('2026-08-20T12:00:00Z'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-09-12');
  });

  it('aplica o clamp de mês curto', () => {
    const next = nextChargeDate(
      { ...base, dayOfMonth: 31, lastGeneratedFor: '2026-01' },
      at('2026-02-05T12:00:00Z'),
    );
    expect(next?.toISOString().slice(0, 10)).toBe('2026-02-28');
  });
});
