-- AlterTable: settledAt is no longer used — "Quitar tudo" now creates one
-- payment transaction per debt/receivable, same as marking each item paid
-- individually, so reversal works normally without an aggregated record.
ALTER TABLE "Debt" DROP COLUMN "settledAt";
ALTER TABLE "Receivable" DROP COLUMN "settledAt";
