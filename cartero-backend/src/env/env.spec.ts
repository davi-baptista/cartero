import { describe, expect, it } from 'vitest';
import { envSchema } from './env';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Validação de configuração (Fase 7C)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `CRON_SECRET: z.string()` aceitava `""`: a aplicação subia normalmente e o
 * `CronSecretGuard` recusava 100% das chamadas com 401 — um cron
 * inevitavelmente quebrado, sem nada apontando a causa.
 *
 * Falhar no boot troca erro silencioso por erro imediato.
 */

const valid = {
  DATABASE_URL: 'postgresql://localhost:5432/cartero',
  JWT_SECRET: 'jwt',
  REFRESH_TOKEN_SECRET: 'refresh',
  CRON_SECRET: 'um-segredo',
  VAPID_PUBLIC_KEY: 'pub',
  VAPID_PRIVATE_KEY: 'priv',
  VAPID_SUBJECT: 'mailto:a@b.c',
};

describe('envSchema — CRON_SECRET', () => {
  it('aceita um segredo preenchido', () => {
    const result = envSchema.parse(valid);

    expect(result.CRON_SECRET).toBe('um-segredo');
  });

  it('recusa string vazia', () => {
    expect(() => envSchema.parse({ ...valid, CRON_SECRET: '' })).toThrow(
      /CRON_SECRET/,
    );
  });

  it('recusa apenas espaços', () => {
    // O `trim` roda antes da validação, então espaços não contam como valor.
    expect(() => envSchema.parse({ ...valid, CRON_SECRET: '   ' })).toThrow(
      /CRON_SECRET/,
    );
  });

  it('recusa ausência da variável', () => {
    const { CRON_SECRET: _omitted, ...withoutSecret } = valid;
    void _omitted;

    expect(() => envSchema.parse(withoutSecret)).toThrow();
  });

  it('remove espaços em volta do valor', () => {
    /**
     * O guard compara com `!==`, então um espaço acidental no painel do cron
     * causaria 401 em toda chamada. Normalizar aqui evita um erro de
     * configuração que seria muito difícil de enxergar.
     */
    const result = envSchema.parse({ ...valid, CRON_SECRET: '  abc  ' });

    expect(result.CRON_SECRET).toBe('abc');
  });

  it('a mensagem de erro não revela o valor tentado', () => {
    // Nomear a variável ajuda; ecoar o conteúdo vazaria segredo em log.
    try {
      envSchema.parse({ ...valid, CRON_SECRET: '' });
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      const message = String(error);
      expect(message).toContain('CRON_SECRET');
      expect(message).not.toContain('um-segredo');
    }
  });
});
