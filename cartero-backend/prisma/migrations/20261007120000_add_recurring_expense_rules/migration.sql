-- Recorrentes V1: additive manual-expense rules and a resume floor for income.
ALTER TABLE "RecurringIncomeRule" ADD COLUMN "activeSince" TEXT;
ALTER TABLE "RecurringIncomeRule"
  ADD CONSTRAINT "RecurringIncomeRule_activeSince_check"
  CHECK ("activeSince" IS NULL OR "activeSince" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

CREATE TYPE "RecurringExpenseFrequency" AS ENUM ('MONTHLY');

CREATE TABLE "RecurringExpenseRule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "personId" TEXT,
  "title" TEXT NOT NULL,
  "amount" DECIMAL NOT NULL,
  "frequency" "RecurringExpenseFrequency" NOT NULL DEFAULT 'MONTHLY',
  "dayOfMonth" INTEGER NOT NULL,
  "firstOccurrence" TEXT NOT NULL,
  "activeSince" TEXT,
  "creditorName" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringExpenseRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecurringExpenseRule_dayOfMonth_check" CHECK ("dayOfMonth" BETWEEN 1 AND 31),
  CONSTRAINT "RecurringExpenseRule_firstOccurrence_check" CHECK ("firstOccurrence" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "RecurringExpenseRule_activeSince_check" CHECK ("activeSince" IS NULL OR "activeSince" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE UNIQUE INDEX "RecurringExpenseRule_id_userId_key" ON "RecurringExpenseRule"("id", "userId");
CREATE INDEX "RecurringExpenseRule_userId_isActive_deletedAt_idx" ON "RecurringExpenseRule"("userId", "isActive", "deletedAt");
ALTER TABLE "RecurringExpenseRule"
  ADD CONSTRAINT "RecurringExpenseRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RecurringExpenseRule_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "RecurringExpenseOccurrenceExclusion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recurringExpenseRuleId" TEXT NOT NULL,
  "recurringMonth" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringExpenseOccurrenceExclusion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecurringExpenseOccurrenceExclusion_recurringMonth_check" CHECK ("recurringMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE UNIQUE INDEX "RecurringExpenseOccurrenceExclusion_recurringExpenseRuleId_recurringMonth_key"
  ON "RecurringExpenseOccurrenceExclusion"("recurringExpenseRuleId", "recurringMonth");
ALTER TABLE "RecurringExpenseOccurrenceExclusion"
  ADD CONSTRAINT "RecurringExpenseOccurrenceExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RecurringExpenseOccurrenceExclusion_rule_user_fkey" FOREIGN KEY ("recurringExpenseRuleId", "userId") REFERENCES "RecurringExpenseRule"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Debt"
  ADD COLUMN "recurringExpenseRuleId" TEXT,
  ADD COLUMN "recurringMonth" TEXT,
  ADD CONSTRAINT "Debt_recurring_provenance_pair_check"
    CHECK (("recurringExpenseRuleId" IS NULL AND "recurringMonth" IS NULL) OR ("recurringExpenseRuleId" IS NOT NULL AND "recurringMonth" IS NOT NULL)),
  ADD CONSTRAINT "Debt_recurringMonth_format_check"
    CHECK ("recurringMonth" IS NULL OR "recurringMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
CREATE UNIQUE INDEX "Debt_recurringExpenseRuleId_recurringMonth_key" ON "Debt"("recurringExpenseRuleId", "recurringMonth");
CREATE INDEX "Debt_userId_recurringMonth_idx" ON "Debt"("userId", "recurringMonth");
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_recurringExpenseRuleId_userId_fkey"
  FOREIGN KEY ("recurringExpenseRuleId", "userId") REFERENCES "RecurringExpenseRule"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
