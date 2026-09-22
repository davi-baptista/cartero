-- CM1C: structural, additive authority for net person settlements.
CREATE TYPE "PersonSettlementDirection" AS ENUM ('INFLOW', 'OUTFLOW', 'NONE');
CREATE TYPE "PersonSettlementStatus" AS ENUM ('ACTIVE', 'REVERSED');

CREATE TABLE "PersonSettlementGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL,
    "direction" "PersonSettlementDirection" NOT NULL,
    "netAmount" DECIMAL NOT NULL,
    "bankId" TEXT,
    "status" "PersonSettlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PersonSettlementGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonSettlementDebt" (
    "groupId" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonSettlementDebt_pkey" PRIMARY KEY ("groupId", "debtId")
);

CREATE TABLE "PersonSettlementReceivable" (
    "groupId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonSettlementReceivable_pkey" PRIMARY KEY ("groupId", "receivableId")
);

CREATE INDEX "PersonSettlementDebt_debtId_idx" ON "PersonSettlementDebt"("debtId");
CREATE INDEX "PersonSettlementReceivable_receivableId_idx" ON "PersonSettlementReceivable"("receivableId");
CREATE INDEX "PersonSettlementGroup_userId_personId_status_idx" ON "PersonSettlementGroup"("userId", "personId", "status");
CREATE INDEX "PersonSettlementGroup_bankId_idx" ON "PersonSettlementGroup"("bankId");
CREATE INDEX "PersonSettlementDebt_groupId_idx" ON "PersonSettlementDebt"("groupId");
CREATE INDEX "PersonSettlementReceivable_groupId_idx" ON "PersonSettlementReceivable"("groupId");

ALTER TABLE "PersonSettlementGroup" ADD CONSTRAINT "PersonSettlementGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonSettlementGroup" ADD CONSTRAINT "PersonSettlementGroup_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonSettlementGroup" ADD CONSTRAINT "PersonSettlementGroup_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonSettlementDebt" ADD CONSTRAINT "PersonSettlementDebt_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PersonSettlementGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonSettlementDebt" ADD CONSTRAINT "PersonSettlementDebt_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonSettlementReceivable" ADD CONSTRAINT "PersonSettlementReceivable_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PersonSettlementGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonSettlementReceivable" ADD CONSTRAINT "PersonSettlementReceivable_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
