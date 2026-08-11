-- AlterTable: add occurredAt as nullable first so existing rows can be backfilled
ALTER TABLE "Debt" ADD COLUMN     "occurredAt" TIMESTAMP(3);
ALTER TABLE "Receivable" ADD COLUMN     "occurredAt" TIMESTAMP(3);

-- Backfill: existing rows have no occurrence date recorded, so use dueDate as the
-- best available approximation.
UPDATE "Debt" SET "occurredAt" = "dueDate" WHERE "occurredAt" IS NULL;
UPDATE "Receivable" SET "occurredAt" = "dueDate" WHERE "occurredAt" IS NULL;

-- AlterTable: now that every row has a value, enforce NOT NULL
ALTER TABLE "Debt" ALTER COLUMN "occurredAt" SET NOT NULL;
ALTER TABLE "Receivable" ALTER COLUMN "occurredAt" SET NOT NULL;
