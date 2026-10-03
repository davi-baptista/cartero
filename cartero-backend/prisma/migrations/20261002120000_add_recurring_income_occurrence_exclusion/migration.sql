-- R6B1: persist user intent to exclude an individual recurring competence.
-- Existing rules and receivables are left untouched; no backfill is possible.

CREATE UNIQUE INDEX "RecurringIncomeRule_id_userId_key"
  ON "RecurringIncomeRule"("id", "userId");

CREATE TABLE "RecurringIncomeOccurrenceExclusion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recurringIncomeRuleId" TEXT NOT NULL,
    "recurringMonth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringIncomeOccurrenceExclusion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecurringIncomeOccurrenceExclusion_recurringMonth_check"
      CHECK ("recurringMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "RecurringIncomeOccurrenceExclusion_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecurringIncomeOccurrenceExclusion_rule_user_fkey"
      FOREIGN KEY ("recurringIncomeRuleId", "userId")
      REFERENCES "RecurringIncomeRule"("id", "userId")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RecurringIncomeOccurrenceExclusion_recurringIncomeRuleId_recurringMonth_key"
  ON "RecurringIncomeOccurrenceExclusion"("recurringIncomeRuleId", "recurringMonth");
