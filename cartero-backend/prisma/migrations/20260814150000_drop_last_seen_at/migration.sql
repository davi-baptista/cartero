-- A coluna foi criada para um marcador de "novo" no extrato que acabou não
-- sendo implementado: o badge de assinatura já identifica a origem do
-- lançamento. Nada lia nem escrevia nela.

-- AlterTable
ALTER TABLE "User" DROP COLUMN "lastSeenAt";
