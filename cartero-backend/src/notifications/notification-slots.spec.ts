import { describe, expect, it } from 'vitest';
import {
  PRODUCT_NOTIFICATION_SLOTS,
  resolveDueNotificationSlots,
} from './notification-slots';

const at = (iso: string, timeZone: string) =>
  resolveDueNotificationSlots({ now: new Date(iso), timeZone });

describe('resolveDueNotificationSlots', () => {
  it('returns a healthy Fortaleza slot and no other slot', () => {
    expect(at('2026-09-17T11:30:00.000Z', 'America/Fortaleza')).toEqual([
      { slot: '08:00', civilDay: '2026-09-17' },
    ]);
  });

  it('recovers one missed hourly tick but excludes the exact 2h boundary', () => {
    expect(at('2026-09-17T12:59:00.000Z', 'America/Fortaleza')).toEqual([
      { slot: '08:00', civilDay: '2026-09-17' },
    ]);
    expect(at('2026-09-17T13:00:00.000Z', 'America/Fortaleza')).toEqual([]);
  });

  it('does not burst stale slots after a long outage', () => {
    expect(at('2026-09-17T21:00:00.000Z', 'America/Fortaleza')).toEqual([
      { slot: '18:00', civilDay: '2026-09-17' },
    ]);
  });

  it('uses account-local clock and civil day across UTC midnight', () => {
    expect(at('2026-09-17T23:30:00.000Z', 'Asia/Tokyo')).toEqual([
      { slot: '08:00', civilDay: '2026-09-18' },
    ]);
  });

  it('supports :30 and :45 zones without minute-zero matching', () => {
    expect(at('2026-09-18T03:30:00.000Z', 'Asia/Kolkata')).toEqual([
      { slot: '08:00', civilDay: '2026-09-18' },
    ]);
    expect(at('2026-09-18T02:45:00.000Z', 'Asia/Kathmandu')).toEqual([
      { slot: '08:00', civilDay: '2026-09-18' },
    ]);
  });

  it('uses IANA DST rules rather than a fixed offset', () => {
    expect(at('2026-03-29T07:30:00.000Z', 'Europe/Lisbon')).toEqual([
      { slot: '08:00', civilDay: '2026-03-29' },
    ]);
    expect(at('2026-10-25T08:30:00.000Z', 'Europe/Lisbon')).toEqual([
      { slot: '08:00', civilDay: '2026-10-25' },
    ]);
  });

  it('keeps the canonical product slot set', () => {
    expect(PRODUCT_NOTIFICATION_SLOTS).toEqual([
      '08:00',
      '12:00',
      '18:00',
      '22:00',
    ]);
  });
});
