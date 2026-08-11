-- AlterTable: new accounts default to NOT auto-creating payment transactions
-- when a debt/receivable is marked paid — opt-in instead of opt-out. Existing
-- rows keep their current value; only the column default changes.
ALTER TABLE "User" ALTER COLUMN "createIncomeOnReceivablePaid" SET DEFAULT false;
ALTER TABLE "User" ALTER COLUMN "createExpenseOnDebtPaid" SET DEFAULT false;
