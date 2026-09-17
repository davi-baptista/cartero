-- V2.1.1: preserve the four existing product reminder slots.
--
-- V2.1 was not applied in the audited local database. If another environment
-- already has rows, the only compatible classification available from the old
-- schema is the legacy first slot; this does not touch financial data and is
-- intentionally documented rather than silently inferred at runtime.
ALTER TABLE "NotificationOccurrence"
    ADD COLUMN "deliverySlot" TEXT NOT NULL DEFAULT '08:00';

DROP INDEX "NotificationOccurrence_userId_type_civilDay_key";

CREATE UNIQUE INDEX "NotificationOccurrence_userId_type_civilDay_deliverySlot_key"
    ON "NotificationOccurrence"("userId", "type", "civilDay", "deliverySlot");
