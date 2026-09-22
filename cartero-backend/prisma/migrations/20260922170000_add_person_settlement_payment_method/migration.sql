-- CM1C extension: payment method and structural net credit artifact.
ALTER TABLE "PersonSettlementGroup"
ADD COLUMN "paymentType" "TransactionType";

ALTER TABLE "Transaction"
ADD COLUMN "personSettlementGroupId" TEXT;

CREATE UNIQUE INDEX "Transaction_personSettlementGroupId_key"
ON "Transaction"("personSettlementGroupId");

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_personSettlementGroupId_fkey"
FOREIGN KEY ("personSettlementGroupId") REFERENCES "PersonSettlementGroup"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
