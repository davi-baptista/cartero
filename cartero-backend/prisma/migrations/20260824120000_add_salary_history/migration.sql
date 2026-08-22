-- SalaryHistory: renda mensal recorrente ao longo do tempo.
--
-- Antes existia apenas `User.salary` — o valor ATUAL — e o Orçamento o usava
-- para calcular qualquer mês. Consequência: alterar a renda hoje reescrevia
-- retroativamente a sobra e o percentual comprometido de todo o histórico.
--
-- A competência é (year, month) inteiros, como em `Invoice`. Guardar um
-- `DateTime` exigiria normalizar o dia em toda escrita e comparação, com risco
-- de virada de fuso em cada ponto; o app é America/Fortaleza (UTC-3).

CREATE TABLE "SalaryHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryHistory_pkey" PRIMARY KEY ("id")
);

-- Uma competência, um valor: é o que torna o upsert idempotente.
CREATE UNIQUE INDEX "SalaryHistory_userId_year_month_key"
    ON "SalaryHistory"("userId", "year", "month");

-- O resolver busca a última entrada <= competência pedida.
CREATE INDEX "SalaryHistory_userId_year_month_idx"
    ON "SalaryHistory"("userId", "year", "month");

ALTER TABLE "SalaryHistory" ADD CONSTRAINT "SalaryHistory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Baseline conservadora ────────────────────────────────────────────────────
--
-- Sabemos o valor ATUAL de cada usuário, mas NÃO desde quando ele é verdadeiro.
-- Afirmar que ele valia "desde a criação da conta" ou "desde janeiro" seria
-- inventar fatos financeiros: quem ganhou aumento em maio veria a renda nova
-- aplicada a março.
--
-- Por isso a baseline começa no mês local em que a migration é ADOTADA, e nada antes
-- recebe valor. Meses anteriores resolvem como DESCONHECIDOS — o contrato
-- distingue isso de renda zero, e a UI diz "não registrada" em vez de R$ 0,00.
--
-- A competência é o MÊS LOCAL DA ADOÇÃO, derivado no momento da execução.
--
-- Uma data fixa (ex.: 2026-08) seria determinística mas passaria a mentir se o
-- deploy escorregasse: aplicada em outubro, gravaria o salário de outubro como
-- se valesse desde agosto — exatamente o histórico inventado que esta política
-- existe para evitar. O que precisa ser estável é a semântica ("a partir da
-- adoção"), não o número.
--
-- `AT TIME ZONE 'America/Fortaleza'` é obrigatório: em 31/08 às 22h locais o
-- UTC já virou 01/09, e `CURRENT_DATE` cru gravaria setembro, deixando agosto
-- sem baseline. O Postgres resolve o fuso pelo tzdata, incluindo histórico de
-- horário de verão.
--
-- O id é derivado do userId em vez de `gen_random_uuid()`: essa função é
-- built-in só a partir do Postgres 13 e depende de pgcrypto antes disso.
-- Nenhuma migration anterior deste projeto gerou ids em SQL, então não há
-- garantia da versão do servidor — e o formato UUID textual satisfaz a coluna.
INSERT INTO "SalaryHistory" ("id", "userId", "month", "year", "amount", "createdAt", "updatedAt")
SELECT
    md5('salary-baseline:' || "id")::uuid,
    "id",
    EXTRACT(MONTH FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Fortaleza'))::int,
    EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Fortaleza'))::int,
    "salary",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User"
WHERE "salary" IS NOT NULL;
