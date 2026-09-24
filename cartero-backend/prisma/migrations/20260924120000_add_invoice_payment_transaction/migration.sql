-- Additive canonical transaction support for new invoice settlements.
ALTER TYPE "TransactionType" ADD VALUE 'INVOICE_PAYMENT';

ALTER TABLE "InvoiceSettlement"
ADD COLUMN "transactionId" TEXT;

CREATE UNIQUE INDEX "InvoiceSettlement_transactionId_key"
ON "InvoiceSettlement"("transactionId");

ALTER TABLE "InvoiceSettlement"
ADD CONSTRAINT "InvoiceSettlement_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
