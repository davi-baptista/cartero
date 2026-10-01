-- Canonicalize the persisted system category in place. Category IDs and their
-- Transaction/Subscription references remain unchanged.
-- Abort before writing if a user already has the destination name; do not merge.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Category" AS legacy
    INNER JOIN "Category" AS canonical
      ON canonical."userId" = legacy."userId"
     AND canonical."name" = 'A receber pago'
    WHERE legacy."name" = 'Receita recebida'
      AND legacy."isSystem" = TRUE
  ) THEN
    RAISE EXCEPTION
      'Cannot rename system category: a user already has a category named "A receber pago". Resolve the conflict explicitly and retry.';
  END IF;

  UPDATE "Category"
  SET "name" = 'A receber pago', "updatedAt" = CURRENT_TIMESTAMP
  WHERE "name" = 'Receita recebida'
    AND "isSystem" = TRUE;
END $$;
