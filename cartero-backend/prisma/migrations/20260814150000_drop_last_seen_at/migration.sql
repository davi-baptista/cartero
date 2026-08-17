-- A coluna foi criada para um marcador de "novo" no extrato que acabou não
-- sendo implementado: o badge de assinatura já identifica a origem do
-- lançamento. Nada lia nem escrevia nela.

-- IF EXISTS porque a coluna viveu poucas horas: em bancos que nunca
-- receberam a migration que a criou, um DROP simples aborta o lote inteiro
-- e as migrations seguintes nao aplicam.
ALTER TABLE "User" DROP COLUMN IF EXISTS "lastSeenAt";
