import { describe, expect, it } from 'vitest';
import {
  parseDateFilterEnd,
  parseDateFilterStart,
  parseDateOnly,
} from './date-only.helper';

/**
 * Campos de data no app representam um DIA de calendário, não um instante.
 * A âncora de meio-dia UTC existe para que Fortaleza (UTC-3) nunca renderize
 * o dia anterior — é a proteção contra o clássico bug de "a compra apareceu
 * um dia antes".
 */

describe('parseDateOnly', () => {
  it('ancora o dia ao meio-dia UTC', () => {
    const date = parseDateOnly('2026-08-19');
    expect(date.toISOString()).toBe('2026-08-19T12:00:00.000Z');
  });

  it('preserva o dia quando lido em UTC-3', () => {
    // A razão de existir da âncora: 12h UTC é 9h em Fortaleza, mesmo dia.
    const date = parseDateOnly('2026-08-19');
    const fortalezaDay = new Date(date.getTime() - 3 * 60 * 60 * 1000);
    expect(fortalezaDay.getUTCDate()).toBe(19);
  });

  it('aceita um timestamp ISO completo e ignora a parte de hora', () => {
    // `dueDate` às vezes chega do banco como ISO completo; o slice(0,10)
    // garante que só o dia importa.
    expect(parseDateOnly('2026-08-19T23:45:00.000Z').toISOString()).toBe(
      '2026-08-19T12:00:00.000Z',
    );
  });

  it('lida com o primeiro e o último dia do ano', () => {
    expect(parseDateOnly('2026-01-01').getUTCMonth() + 1).toBe(1);
    expect(parseDateOnly('2026-12-31').getUTCDate()).toBe(31);
  });

  it('lida com 29 de fevereiro em ano bissexto', () => {
    const date = parseDateOnly('2028-02-29');
    expect(date.getUTCMonth() + 1).toBe(2);
    expect(date.getUTCDate()).toBe(29);
  });
});

describe('parseDateFilterStart / parseDateFilterEnd', () => {
  it('início do filtro é a meia-noite do dia', () => {
    expect(parseDateFilterStart('2026-08-01').toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('fim do filtro é o último milissegundo do dia', () => {
    expect(parseDateFilterEnd('2026-08-31').toISOString()).toBe(
      '2026-08-31T23:59:59.999Z',
    );
  });

  it('a janela cobre integralmente uma data ancorada ao meio-dia', () => {
    // Garante que um lançamento criado via parseDateOnly cai dentro de um
    // filtro do mesmo dia — start/end e a âncora precisam ser coerentes.
    const record = parseDateOnly('2026-08-19');
    const start = parseDateFilterStart('2026-08-19');
    const end = parseDateFilterEnd('2026-08-19');

    expect(record >= start).toBe(true);
    expect(record <= end).toBe(true);
  });

  it('a janela de um mês inteiro cobre o primeiro e o último dia', () => {
    const start = parseDateFilterStart('2026-08-01');
    const end = parseDateFilterEnd('2026-08-31');

    expect(parseDateOnly('2026-08-01') >= start).toBe(true);
    expect(parseDateOnly('2026-08-31') <= end).toBe(true);
    expect(parseDateOnly('2026-07-31') >= start).toBe(false);
    expect(parseDateOnly('2026-09-01') <= end).toBe(false);
  });
});
