CREATE TABLE "InvoiceSettlement" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "bankId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceSettlement_invoiceId_key" ON "InvoiceSettlement"("invoiceId");
CREATE INDEX "InvoiceSettlement_bankId_paidAt_idx" ON "InvoiceSettlement"("bankId", "paidAt");
ALTER TABLE "InvoiceSettlement" ADD CONSTRAINT "InvoiceSettlement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceSettlement" ADD CONSTRAINT "InvoiceSettlement_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
