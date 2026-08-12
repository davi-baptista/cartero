-- Older versions assigned the first row of each installment series as its
-- own parent. Restore those rows as the series roots.
UPDATE "Transaction"
SET "parentId" = NULL
WHERE "parentId" = "id";

UPDATE "Receivable"
SET "parentId" = NULL
WHERE "parentId" = "id";
