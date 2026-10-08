ALTER TABLE "RecurringExpenseRule"
  ADD COLUMN "description" TEXT,
  DROP COLUMN "creditorName";
