import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { AppScheduler } from './app.scheduler';

/**
 * TZ6.2 §2/P11 — o cron precisa ser ANCORADO em minuto 00 de toda hora
 * (`00:00, 01:00, 02:00, ...`), nunca relativo ao horário em que o processo
 * subiu (o que produziria `00:30, 01:30, ...` dependendo de quando o backend
 * iniciou).
 *
 * A prova lê a metadata REAL que `@Cron` grava via `SetMetadata` — não
 * confia em inspeção visual do código-fonte, que poderia divergir da
 * configuração que o Nest realmente registra em runtime.
 */

const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

describe('AppScheduler.syncInvoiceStatus — âncora estrutural do cron (TZ6.2 §2/P11)', () => {
  it('a cron expression usa minuto fixo 00 em todas as horas — nunca relativo ao startup', () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      AppScheduler.prototype.syncInvoiceStatus,
    );

    expect(options).toBeDefined();
    expect(options.cronTime).toBe('0 0-23/1 * * *');

    const [minuteField, hourField] = options.cronTime.split(' ');
    expect(minuteField).toBe('0');
    expect(hourField).toBe('0-23/1');
  });

  it('a timezone do cron é America/Fortaleza — decide só QUANDO o job roda, nunca a regra de negócio', () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      AppScheduler.prototype.syncInvoiceStatus,
    );

    expect(options.timeZone).toBe('America/Fortaleza');
  });
});
