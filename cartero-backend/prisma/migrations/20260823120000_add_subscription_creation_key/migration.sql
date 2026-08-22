-- Chave de idempotência da criação de assinatura.
--
-- ─── Por quê ──────────────────────────────────────────────────────────────
-- A criação persiste a assinatura e SÓ DEPOIS gera os lançamentos, um ciclo
-- por transação. Essa granularidade é desejável — se o ciclo 7 de uma criação
-- retroativa falha, os 6 anteriores continuam válidos e a próxima execução
-- retoma do marcador.
--
-- O problema era outro: a falha na geração devolvia erro ao cliente com a
-- assinatura JÁ criada. O usuário reenviava o formulário e ganhava uma
-- segunda assinatura.
--
-- ─── Por que não uma chave natural ────────────────────────────────────────
-- Não existe. O usuário pode legitimamente ter duas "Netflix", no mesmo
-- banco, com o mesmo valor — o mesmo serviço em dois cartões, ou dois planos.
-- Qualquer unique sobre (userId, title) ou (userId, title, bankId) recusaria
-- cadastros válidos. A chave identifica uma TENTATIVA de requisição, não a
-- assinatura.
--
-- ─── Múltiplos NULL ──────────────────────────────────────────────────────
-- No Postgres, UNIQUE trata NULL como distinto de qualquer outro NULL, então
-- várias linhas com `creationKey IS NULL` coexistem sem violar a constraint.
-- Isso é o que permite:
--   · registros anteriores a esta coluna continuarem válidos;
--   · criações sem chave (cliente antigo, chamada direta) seguirem aceitas.
--
-- É o comportamento padrão do SQL, não uma particularidade do Prisma. A
-- alternativa `NULLS NOT DISTINCT` (Postgres 15+) faria o oposto e quebraria
-- os registros existentes — por isso não é usada.
ALTER TABLE "Subscription" ADD COLUMN "creationKey" TEXT;

-- A unicidade é por usuário: dois usuários podem gerar o mesmo UUID sem que
-- um bloqueie o outro.
CREATE UNIQUE INDEX "Subscription_userId_creationKey_key"
  ON "Subscription"("userId", "creationKey");
