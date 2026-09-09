-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "roundingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "roundingIncrementMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "roundingMode" TEXT NOT NULL DEFAULT 'nearest';

