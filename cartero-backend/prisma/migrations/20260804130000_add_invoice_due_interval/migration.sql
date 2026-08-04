ALTER TABLE "Bank" ADD COLUMN "invoiceDueDaysAfterClose" INTEGER NOT NULL DEFAULT 7;

-- Preserve the current behavior for existing banks by deriving the interval
-- from their configured close/due days on a 31-day cycle.
UPDATE "Bank"
SET "invoiceDueDaysAfterClose" = GREATEST(
  1,
  CASE
    WHEN "invoiceDueDate" >= "invoiceCloseDate"
      THEN "invoiceDueDate" - "invoiceCloseDate"
    ELSE 31 - "invoiceCloseDate" + "invoiceDueDate"
  END
);
