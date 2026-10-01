# Runbook — canonical category for paid receivables

This runbook applies the data-only migration
`20261001120000_rename_receivable_received_category` in production. It does
not include credentials. Run commands from `cartero-backend` on the approved
production deploy host, where `DATABASE_URL` is already configured.

## Change and compatibility

The migration renames system `Category` rows in place. It preserves each
category ID, `userId`, `isSystem`, icon, color, and all foreign-key links. It
aborts before updating if a user has both the legacy system row and any
category with the destination name. It does not merge categories or relink
transactions.

Old application code looks up the legacy name; new code looks up the canonical
name. Neither release order alone is safe while receivable settlements are
allowed: new code deployed first can create a second category, while old code
running after the rename can recreate the legacy category. Use a coordinated
release with receivable-settlement writes paused. Reads can remain available;
the settlement action is briefly unavailable.

## 1. Confirm target and preflight — read only

```sh
cd cartero-backend
: "${DATABASE_URL:?DATABASE_URL must be configured by the production platform}"
npx prisma migrate status
```

Confirm the datasource reported by Prisma is the intended production database.
Do not print or paste `DATABASE_URL`. Then run the read-only SQL and retain its
output with the change record:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
BEGIN READ ONLY;
SELECT current_database() AS database,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port;

SELECT c.id, c."userId", c.name, c."isSystem",
       count(t.id) AS linked_transactions
FROM "Category" c
LEFT JOIN "Transaction" t ON t."categoryId" = c.id
WHERE c.name IN ('Receita recebida', 'A receber pago')
GROUP BY c.id, c."userId", c.name, c."isSystem"
ORDER BY c."userId", c.name;

SELECT count(*) AS legacy_system_categories
FROM "Category"
WHERE name = 'Receita recebida' AND "isSystem" = TRUE;

SELECT count(*) AS canonical_categories
FROM "Category"
WHERE name = 'A receber pago';

SELECT legacy."userId", legacy.id AS legacy_id,
       canonical.id AS canonical_id, canonical."isSystem" AS canonical_is_system
FROM "Category" legacy
JOIN "Category" canonical ON canonical."userId" = legacy."userId"
WHERE legacy.name = 'Receita recebida'
  AND legacy."isSystem" = TRUE
  AND canonical.name = 'A receber pago';
ROLLBACK;
SQL
```

Stop before deployment if the target identity is uncertain, if the conflict
query returns any rows, or if category ownership/system flags differ from the
approved plan. Review non-system legacy-name categories separately: the
migration deliberately leaves user-owned categories untouched.

Record each legacy system category's `id`, `userId`, `isSystem`, and linked
transaction count from the query. This is the before-snapshot for comparison.

## 2. Coordinated deployment

1. Pause/disable only receivable settlement mutations in the API/UI. Ensure
   old backend instances cannot process a settlement; do not rely only on the
   new frontend being hidden.
2. Take/confirm the platform's normal database backup or restore point.
3. Apply the versioned migration from `cartero-backend`:

   ```sh
   npx prisma migrate deploy
   ```

4. Deploy the release containing the canonical `A receber pago` category
   constant. Drain all old backend instances before restoring settlement
   writes. The frontend receives the category name from the Category read
   model; it must not map the old label locally.
5. Complete the post-checks below, then re-enable receivable settlements.

Do not use `prisma migrate dev`, `prisma db push`, `prisma migrate reset`, or
manual ad-hoc updates in production.

## 3. Post-migration checks — read only

First confirm the migration is recorded and deploy is idempotent:

```sh
npx prisma migrate status
npx prisma migrate deploy
```

Then rerun the SQL from preflight and compare against the saved snapshot:

- legacy **system** category count is zero;
- canonical category count increased by the number of legacy system rows
  renamed (pre-existing destination rows for those users are disallowed by
  the preflight);
- category IDs, `userId`, `isSystem`, icon, and color match the snapshot;
- linked transaction counts match exactly; no `Transaction.categoryId` was
  updated;
- no per-user duplicate/conflict is returned.

Also verify the deployed health endpoint returns HTTP 200, then inspect an
already-settled receivable in Extrato, Budget detail, and
`TransactionDetailsDrawer`. These are read-only checks; they should naturally
show `A receber pago` from the category record. Do not create a production
settlement as a smoke test.

## 4. Rollback plan — do not perform during deployment

If application rollback is needed, pause receivable settlement writes again.
Do not simply roll back code: old code expects the old category name.

Prepare a **new forward-only data migration** (never edit the applied
migration) that first checks for per-user conflicts where a system
`A receber pago` row and any `Receita recebida` row coexist, aborts on any
conflict, then renames the same system category row back in place. Apply that
rollback migration with `npx prisma migrate deploy`, verify IDs and links,
deploy the old application release, drain new backend instances, and only
then restore settlement writes.

New transactions created after the forward migration keep their
`categoryId` through an in-place rollback rename. If any user has created or
otherwise acquired a conflicting old-name category, stop; do not merge or
relink silently. Resolve that conflict explicitly before preparing the
rollback migration.
