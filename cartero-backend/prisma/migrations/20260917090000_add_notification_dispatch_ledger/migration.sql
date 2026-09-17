-- Durable notification occurrence and per-subscription delivery ledger.
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

CREATE TABLE "NotificationOccurrence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "civilDay" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOccurrence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "pushSubscriptionId" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationOccurrence_userId_type_civilDay_key"
    ON "NotificationOccurrence"("userId", "type", "civilDay");
CREATE INDEX "NotificationOccurrence_userId_createdAt_idx"
    ON "NotificationOccurrence"("userId", "createdAt");
CREATE UNIQUE INDEX "NotificationDelivery_occurrenceId_pushSubscriptionId_key"
    ON "NotificationDelivery"("occurrenceId", "pushSubscriptionId");
CREATE INDEX "NotificationDelivery_status_leaseUntil_idx"
    ON "NotificationDelivery"("status", "leaseUntil");

ALTER TABLE "NotificationOccurrence"
    ADD CONSTRAINT "NotificationOccurrence_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery"
    ADD CONSTRAINT "NotificationDelivery_occurrenceId_fkey"
    FOREIGN KEY ("occurrenceId") REFERENCES "NotificationOccurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery"
    ADD CONSTRAINT "NotificationDelivery_pushSubscriptionId_fkey"
    FOREIGN KEY ("pushSubscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
