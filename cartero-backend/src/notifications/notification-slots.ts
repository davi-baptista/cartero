export const PRODUCT_NOTIFICATION_SLOTS = [
  '08:00',
  '12:00',
  '18:00',
  '22:00',
] as const;

export type ProductNotificationSlot = (typeof PRODUCT_NOTIFICATION_SLOTS)[number];

export interface DueNotificationSlot {
  slot: ProductNotificationSlot;
  civilDay: string;
}

export interface SlotCatchupPolicy {
  /** Semi-open upper bound: exactly 120 minutes is stale. */
  maxAgeMinutes: number;
}

const DEFAULT_CATCHUP_POLICY: SlotCatchupPolicy = { maxAgeMinutes: 120 };

/**
 * Resolves local product slots that are due at `now`.
 *
 * The interval is [slot start, slot start + maxAgeMinutes), so an hourly
 * trigger is healthy (<1h), one missed tick is recoverable (<2h), and an old
 * outage cannot burst every historical slot. Civil components come from the
 * IANA timezone; no UTC offset arithmetic is involved.
 */
export function resolveDueNotificationSlots(input: {
  now: Date;
  timeZone: string;
  slots?: readonly string[];
  catchupPolicy?: SlotCatchupPolicy;
}): DueNotificationSlot[] {
  const policy = input.catchupPolicy ?? DEFAULT_CATCHUP_POLICY;
  if (policy.maxAgeMinutes <= 0) return [];

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: input.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(input.now);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const localMinutes = value('hour') * 60 + value('minute');
  const civilDay = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return (input.slots ?? PRODUCT_NOTIFICATION_SLOTS)
    .filter((slot): slot is ProductNotificationSlot =>
      (PRODUCT_NOTIFICATION_SLOTS as readonly string[]).includes(slot),
    )
    .filter((slot) => {
      const [hour, minute] = slot.split(':').map(Number);
      const elapsed = localMinutes - (hour * 60 + minute);
      return elapsed >= 0 && elapsed < policy.maxAgeMinutes;
    })
    .map((slot) => ({ slot, civilDay }));
}
