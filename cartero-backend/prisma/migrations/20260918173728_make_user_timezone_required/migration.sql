-- User.timeZone is already backfilled locally and has no default by design.
ALTER TABLE "User" ALTER COLUMN "timeZone" SET NOT NULL;
