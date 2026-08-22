-- Arquivamento de banco.
--
-- Aditiva e segura: a coluna entra com DEFAULT false, então todo banco
-- existente permanece ativo e nenhum fluxo muda de comportamento até que
-- alguém arquive explicitamente.
--
-- Sem índice em (userId, isArchived) de propósito: a listagem já filtra por
-- userId e o volume por usuário é de poucas linhas, então o índice custaria
-- escrita sem devolver leitura.
ALTER TABLE "Bank" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
