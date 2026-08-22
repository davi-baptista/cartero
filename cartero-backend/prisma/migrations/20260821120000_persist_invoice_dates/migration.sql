-- Persistência de closeDate/dueDate em Invoice.
--
-- ─── Por quê ──────────────────────────────────────────────────────────────
-- Até aqui as datas de fechamento e vencimento eram derivadas da configuração
-- ATUAL do banco a cada leitura. Alterar o dia de vencimento de um cartão
-- reescrevia as datas exibidas de TODAS as faturas, inclusive as já pagas —
-- o histórico mudava retroativamente.
--
-- ─── Limitação do backfill (importante) ───────────────────────────────────
-- Não existe histórico das configurações anteriores do banco. Se o usuário já
-- alterou o vencimento em algum momento, as datas originais daquelas faturas
-- são IRRECUPERÁVEIS.
--
-- Portanto este backfill NÃO reconstrói datas históricas: ele congela o que o
-- Cartero calcula HOJE, com a configuração vigente. Para uma fatura antiga de
-- um cartão cuja configuração mudou, a data gravada é a que o app vinha
-- exibindo — não necessariamente a que constava na fatura real do banco.
--
-- O ganho é interromper a deriva: a partir daqui as datas param de mudar.
--
-- ─── Clamp: a parte delicada ──────────────────────────────────────────────
-- O SQL precisa reproduzir exatamente `dateForDayUtc` + `addDays` do
-- `invoice.helper.ts`, senão migration e aplicação divergem:
--
--   1. Dia do vencimento é limitado ao último dia do mês da competência.
--      Dia 31 em fevereiro/2026 → 28; em 2024 (bissexto) → 29.
--   2. `closeDate = dueDate - N dias`, com N = MAX(1, invoiceDueDaysAfterClose).
--      É aritmética de dias corridos: atravessa fronteira de mês e de ano.
--      Vencimento 05/01 com intervalo 7 → fechamento 29/12 do ano anterior.
--   3. Âncora de 3h UTC, a mesma de `dateForDayUtc`. Não é decorativa: o app
--      compara datas por dia civil justamente para neutralizar a diferença
--      entre esta âncora e as 12h de `parseDateOnly`.
--
-- ─── Estratégia em 3 passos ───────────────────────────────────────────────
-- Adicionar nullable, preencher, e só então exigir NOT NULL. Adicionar já
-- como NOT NULL falharia com faturas existentes, e um DEFAULT arbitrário
-- gravaria data errada em silêncio.

-- 1. Colunas nullable.
ALTER TABLE "Invoice" ADD COLUMN "closeDate" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "dueDate" TIMESTAMP(3);

-- 2. Backfill a partir do banco vinculado.
--
-- `make_date(year, month, 1) + INTERVAL '1 month - 1 day'` dá o último dia do
-- mês da competência, e `date_part('day', ...)` extrai esse número — é assim
-- que o `LEAST` abaixo reproduz o clamp sem hardcodar tabela de meses, e
-- acerta ano bissexto porque o próprio Postgres resolve o calendário.
--
-- A data é montada num CTE, não num LATERAL: `UPDATE ... FROM x, LATERAL (...)`
-- NÃO pode referenciar a tabela-alvo dentro
-- do LATERAL: o Postgres só permite referência lateral a entradas ANTERIORES
-- do FROM, e a tabela do UPDATE não é uma delas (erro 42P10). Um CTE que já
-- resolve a data por fatura resolve isso e mantém o clamp num único lugar.
WITH computed AS (
  SELECT
    inv."id" AS invoice_id,
    (
      make_date(
        inv."year",
        inv."month",
        LEAST(
          b."invoiceDueDate",
          date_part(
            'day',
            (make_date(inv."year", inv."month", 1) + INTERVAL '1 month - 1 day')
          )::int
        )
      )::timestamp + INTERVAL '3 hours'
    ) AS due_value,
    GREATEST(1, COALESCE(b."invoiceDueDaysAfterClose", 7)) AS close_offset
  FROM "Invoice" AS inv
  JOIN "Bank" AS b ON b."id" = inv."bankId"
  WHERE inv."dueDate" IS NULL
)
UPDATE "Invoice" AS inv
SET
  "dueDate" = computed.due_value,
  "closeDate" = computed.due_value - (computed.close_offset * INTERVAL '1 day')
FROM computed
WHERE computed.invoice_id = inv."id";

-- 3. Guarda: se alguma fatura ficou sem data, o banco vinculado não existe e
-- há inconsistência referencial. Falhar aqui é melhor que aceitar NULL numa
-- coluna que a aplicação vai tratar como sempre presente.
DO $$
DECLARE
  orphans INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphans FROM "Invoice" WHERE "dueDate" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION
      'Backfill incompleto: % fatura(s) sem banco vinculado. Investigue antes de prosseguir.',
      orphans;
  END IF;
END $$;

-- 4. Agora as colunas podem exigir presença.
ALTER TABLE "Invoice" ALTER COLUMN "closeDate" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "dueDate" SET NOT NULL;

-- Nota: nenhum InvoiceStatus é reclassificado aqui. O backfill só adiciona
-- datas; o estado continua sob responsabilidade da aplicação e do scheduler.
