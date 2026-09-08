-- CreateTable
CREATE TABLE "RateTier" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RateTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateVersion" (
    "id" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "hourlyRateCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateTier_jobId_updatedAt_idx" ON "RateTier"("jobId", "updatedAt");

-- CreateIndex
CREATE INDEX "RateVersion_tierId_effectiveFrom_idx" ON "RateVersion"("tierId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "RateTier" ADD CONSTRAINT "RateTier_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateVersion" ADD CONSTRAINT "RateVersion_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "RateTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add the new overtime columns first, leaving hourlyRateCents in place until
-- the backfill below has had a chance to read it.
ALTER TABLE "Job" ADD COLUMN "overtimeMultiplier" DOUBLE PRECISION,
                  ADD COLUMN "overtimeWeeklyThresholdHours" DOUBLE PRECISION;

-- Data migration: every job that had a flat hourlyRateCents gets a default "Standard"
-- rate tier with one rate version, effective from the job's own creation date. This is
-- what lets hourlyRateCents be dropped below without losing existing pay data — a shift
-- that happened before this migration still resolves to the rate that was actually in
-- effect at the time (see docs/data-model.md and app/src/lib/pay.ts).
DO $$
DECLARE
  job_record RECORD;
  new_tier_id TEXT;
BEGIN
  FOR job_record IN SELECT "id", "hourlyRateCents", "createdAt" FROM "Job" WHERE "hourlyRateCents" IS NOT NULL LOOP
    new_tier_id := (md5(random()::text || clock_timestamp()::text))::uuid::text;
    INSERT INTO "RateTier" ("id", "jobId", "name", "isDefault", "archived", "updatedAt")
      VALUES (new_tier_id, job_record."id", 'Standard', true, false, now());
    INSERT INTO "RateVersion" ("id", "tierId", "hourlyRateCents", "effectiveFrom", "updatedAt")
      VALUES ((md5(random()::text || clock_timestamp()::text))::uuid::text, new_tier_id, job_record."hourlyRateCents", job_record."createdAt", now());
  END LOOP;
END $$;

-- AlterTable
ALTER TABLE "Job" DROP COLUMN "hourlyRateCents";

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN "rateTierId" TEXT;

-- CreateIndex
CREATE INDEX "Shift_rateTierId_idx" ON "Shift"("rateTierId");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_rateTierId_fkey" FOREIGN KEY ("rateTierId") REFERENCES "RateTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
