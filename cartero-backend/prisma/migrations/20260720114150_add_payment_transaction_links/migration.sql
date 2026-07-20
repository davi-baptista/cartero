-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "paymentTransactionId" TEXT;

-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "paymentTransactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Debt_paymentTransactionId_key" ON "Debt"("paymentTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_paymentTransactionId_key" ON "Receivable"("paymentTransactionId");

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
