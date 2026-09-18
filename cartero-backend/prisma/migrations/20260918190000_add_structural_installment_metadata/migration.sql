-- Structural installment metadata is additive. `parentId` intentionally
-- remains an opaque historical anchor: it must not become a foreign key.
ALTER TABLE "Transaction"
  ADD COLUMN "installmentIndex" INTEGER,
  ADD COLUMN "installmentCount" INTEGER;

CREATE INDEX "Transaction_userId_parentId_idx"
  ON "Transaction"("userId", "parentId");

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_installment_metadata_pair_check"
  CHECK (
    ("installmentIndex" IS NULL AND "installmentCount" IS NULL)
    OR
    ("installmentIndex" IS NOT NULL AND "installmentCount" IS NOT NULL)
  ),
  ADD CONSTRAINT "Transaction_installment_index_positive_check"
  CHECK ("installmentIndex" IS NULL OR "installmentIndex" >= 1),
  ADD CONSTRAINT "Transaction_installment_count_check"
  CHECK ("installmentCount" IS NULL OR "installmentCount" >= 2),
  ADD CONSTRAINT "Transaction_installment_index_within_count_check"
  CHECK (
    "installmentIndex" IS NULL
    OR "installmentIndex" <= "installmentCount"
  ),
  ADD CONSTRAINT "Transaction_installment_root_check"
  CHECK ("installmentIndex" <> 1 OR "parentId" IS NULL),
  ADD CONSTRAINT "Transaction_installment_child_parent_check"
  CHECK (
    "installmentIndex" IS NULL
    OR "installmentIndex" <= 1
    OR "parentId" IS NOT NULL
  );

-- Backfill only groups already proven by parentId lineage. The title is used
-- only to populate index/count inside those groups; it never creates a group.
WITH parsed AS (
  SELECT
    t.id,
    t."parentId",
    t."userId",
    t.title,
    NULLIF(substring(t.title from ' ([0-9]+)/[0-9]+$'), '')::integer AS idx,
    NULLIF(substring(t.title from ' [0-9]+/([0-9]+)$'), '')::integer AS total
  FROM "Transaction" t
), grouped AS (
  SELECT
    COALESCE("parentId", id) AS anchor,
    COUNT(*) AS row_count,
    COUNT(*) FILTER (WHERE idx IS NULL OR total IS NULL) AS invalid_rows,
    COUNT(DISTINCT "userId") AS user_count,
    COUNT(DISTINCT idx) AS index_count,
    MIN(idx) AS min_idx,
    MAX(idx) AS max_idx,
    MIN(total) AS min_total,
    MAX(total) AS max_total,
    COUNT(DISTINCT total) AS total_count,
    COUNT(*) FILTER (WHERE id = COALESCE("parentId", id)) AS anchor_rows
  FROM parsed
  GROUP BY COALESCE("parentId", id)
), eligible AS (
  SELECT g.anchor
  FROM grouped g
  WHERE g.row_count >= 2
    AND g.invalid_rows = 0
    AND g.user_count = 1
    AND g.index_count = g.row_count
    AND g.min_total >= 2
    AND g.min_total = g.max_total
    AND g.total_count = 1
    AND g.max_idx = g.min_total
    AND (
      (g.anchor_rows = 1 AND g.min_idx = 1)
      OR
      (g.anchor_rows = 0 AND g.min_idx >= 2)
    )
)
UPDATE "Transaction" t
SET
  "installmentIndex" = p.idx,
  "installmentCount" = p.total
FROM parsed p
JOIN eligible e ON e.anchor = COALESCE(p."parentId", p.id)
WHERE t.id = p.id;
