ALTER TABLE "RecurringIncomeRule"
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "RecurringIncomeRule_userId_deletedAt_idx"
  ON "RecurringIncomeRule"("userId", "deletedAt");
