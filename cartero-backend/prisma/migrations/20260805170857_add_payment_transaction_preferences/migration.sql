-- AlterTable
ALTER TABLE "User" ADD COLUMN     "createExpenseOnDebtPaid" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createIncomeOnReceivablePaid" BOOLEAN NOT NULL DEFAULT true;
