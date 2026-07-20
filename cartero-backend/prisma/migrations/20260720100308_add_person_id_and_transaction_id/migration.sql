-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "transactionId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "personId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_transactionId_key" ON "Receivable"("transactionId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
