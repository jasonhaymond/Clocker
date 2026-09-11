-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "expectedHoursWeekStartDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "expectedWeeklyHours" DOUBLE PRECISION;
