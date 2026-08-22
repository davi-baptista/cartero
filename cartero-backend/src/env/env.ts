import { z } from 'zod';

/**
 * Segredo que não pode ser vazio.
 *
 * `z.string()` puro aceita `""` e `"   "`: a aplicação subia normalmente e o
 * `CronSecretGuard` recusava 100% das chamadas com 401 — um cron
 * inevitavelmente quebrado, sem nada indicando a causa. Falhar no boot
 * transforma erro silencioso em erro imediato.
 *
 * O `trim` acontece antes da validação, então espaços em volta não contam como
 * conteúdo. A mensagem nomeia a variável mas nunca o valor.
 */
const requiredSecret = (name: string) =>
  z.string().trim().min(1, `${name} é obrigatório e não pode ser vazio`);

export const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string(),
  REFRESH_TOKEN_SECRET: z.string(),
  /**
   * Segredo COMPARTILHADO pelos dois endpoints de cron:
   * `POST /subscriptions/run-all` e `POST /notifications/run`. Ambos leem esta
   * mesma variável — não há segredo por rota.
   */
  CRON_SECRET: requiredSecret('CRON_SECRET'),
  VAPID_PUBLIC_KEY: z.string(),
  VAPID_PRIVATE_KEY: z.string(),
  VAPID_SUBJECT: z.string(),
});

export type Env = z.infer<typeof envSchema>;
