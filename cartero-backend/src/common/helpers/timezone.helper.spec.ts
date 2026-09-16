import { describe, expect, it } from 'vitest';
import { isValidIanaTimeZone, resolveIanaTimeZone } from './timezone.helper';

describe('isValidIanaTimeZone', () => {
  it('N2/N3/N4: aceita identificadores IANA reais do produto', () => {
    expect(isValidIanaTimeZone('America/Fortaleza')).toBe(true);
    expect(isValidIanaTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidIanaTimeZone('America/Manaus')).toBe(true);
    expect(isValidIanaTimeZone('Europe/Lisbon')).toBe(true);
    expect(isValidIanaTimeZone('Asia/Tokyo')).toBe(true);
  });

  it('N5/N6: rejeita offsets — NUNCA aceita como timezone financeira persistida', () => {
    // `Intl.DateTimeFormat` sozinho ACEITA offsets (testado manualmente:
    // resolvedOptions().timeZone devolve '-03:00' sem lançar). A validação
    // real precisa passar pela lista de `supportedValuesOf('timeZone')`, que
    // nunca contém um offset — é isso que este teste prova.
    expect(isValidIanaTimeZone('-03:00')).toBe(false);
    expect(isValidIanaTimeZone('UTC-3')).toBe(false);
    expect(isValidIanaTimeZone('GMT-3')).toBe(false);
  });

  it('N5: rejeita timezone inválida/inexistente', () => {
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false);
    expect(isValidIanaTimeZone('')).toBe(false);
    expect(isValidIanaTimeZone('America/Nowhere')).toBe(false);
  });

  it('rejeita variantes case-sensitive incorretas', () => {
    // A lista IANA é case-sensitive; um valor com capitalização errada não é
    // silenciosamente aceito.
    expect(isValidIanaTimeZone('america/fortaleza')).toBe(false);
  });
});

describe('resolveIanaTimeZone (TZ1.0.1: validate + canonicalize num só passo)', () => {
  /*
    ── Sobre alias determinístico (TZ1.0.1 §6) ──

    Investigado no runtime Node real do projeto: `Brazil/East` é um alias
    IANA reconhecido por `Intl.DateTimeFormat`, que o resolve
    deterministicamente para `America/Sao_Paulo`
    (`Intl.DateTimeFormat(undefined, { timeZone: 'Brazil/East' })
    .resolvedOptions().timeZone === 'America/Sao_Paulo'`). Mesmo padrão para
    `US/Eastern → America/New_York`, `PRC → Asia/Shanghai`, etc.

    Porém `Brazil/East` NÃO aparece em `Intl.supportedValuesOf('timeZone')`
    — só identificadores JÁ canônicos estão nessa lista. Como
    `isValidIanaTimeZone` (e portanto `resolveIanaTimeZone`) valida contra
    essa lista, `Brazil/East` é REJEITADO como inválido antes de chegar à
    canonicalização — decisão deliberada desta rodada, para não expandir o
    contrato de entrada além do aprovado em TZ1 (aceitar só identificadores
    já-canônicos, nunca aliases regionais nem abreviações como GMT/UTC).

    Portanto não existe, dentro do contrato atual, um alias que sobreviva à
    validação e canonicalize para outro valor — testar isso seria fabricar
    um teste que nunca poderia passar. O teste abaixo prova o contrato
    validate→canonicalize→persist com um valor JÁ canônico (identidade),
    que é o único caminho real que `resolveIanaTimeZone` percorre hoje.
  */
  it('C2/C4: identificador já canônico é devolvido como está', () => {
    expect(resolveIanaTimeZone('America/Fortaleza')).toBe('America/Fortaleza');
    expect(resolveIanaTimeZone('America/Sao_Paulo')).toBe('America/Sao_Paulo');
    expect(resolveIanaTimeZone('Europe/Lisbon')).toBe('Europe/Lisbon');
  });

  it('C6: timezone inválida devolve null, nunca lança', () => {
    expect(resolveIanaTimeZone('-03:00')).toBeNull();
    expect(resolveIanaTimeZone('GMT-3')).toBeNull();
    expect(resolveIanaTimeZone('Not/AZone')).toBeNull();
    expect(resolveIanaTimeZone('Brazil/East')).toBeNull();
  });
});
