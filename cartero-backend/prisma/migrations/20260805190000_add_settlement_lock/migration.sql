-- AlterTable
ALTER TABLE "Debt" ADD COLUMN "settledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN "settledAt" TIMESTAMP(3);
