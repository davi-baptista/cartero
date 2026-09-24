-- B4.1B/B4.2/B4.3: additive recurring-income foundation.
-- Existing Receivables remain valid: new classification/provenance fields are nullable.

CREATE TYPE "RecurringIncomeFrequency" AS ENUM ('MONTHLY');
CREATE TYPE "IncomeClassification" AS ENUM ('INCOME', 'OTHER');

CREATE TABLE "RecurringIncomeRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "frequency" "RecurringIncomeFrequency" NOT NULL DEFAULT 'MONTHLY',
    "dayOfMonth" INTEGER NOT NULL,
    "firstOccurrence" TEXT NOT NULL,
    "counterpartyName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringIncomeRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecurringIncomeRule_dayOfMonth_check" CHECK ("dayOfMonth" BETWEEN 1 AND 31),
    CONSTRAINT "RecurringIncomeRule_firstOccurrence_check" CHECK ("firstOccurrence" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE INDEX "RecurringIncomeRule_userId_isActive_idx"
  ON "RecurringIncomeRule"("userId", "isActive");

ALTER TABLE "Receivable"
  ADD COLUMN "recurringIncomeRuleId" TEXT,
  ADD COLUMN "recurringMonth" TEXT,
  ADD COLUMN "incomeClassification" "IncomeClassification";

CREATE UNIQUE INDEX "Receivable_recurringIncomeRuleId_recurringMonth_key"
  ON "Receivable"("recurringIncomeRuleId", "recurringMonth");

CREATE INDEX "Receivable_userId_recurringMonth_idx"
  ON "Receivable"("userId", "recurringMonth");

ALTER TABLE "Receivable"
  ADD CONSTRAINT "Receivable_recurring_provenance_pair_check"
  CHECK (("recurringIncomeRuleId" IS NULL AND "recurringMonth" IS NULL)
      OR ("recurringIncomeRuleId" IS NOT NULL AND "recurringMonth" IS NOT NULL)),
  ADD CONSTRAINT "Receivable_recurringMonth_format_check"
  CHECK ("recurringMonth" IS NULL OR "recurringMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "Receivable_recurringIncomeRuleId_fkey"
  FOREIGN KEY ("recurringIncomeRuleId") REFERENCES "RecurringIncomeRule"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecurringIncomeRule"
  ADD CONSTRAINT "RecurringIncomeRule_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
