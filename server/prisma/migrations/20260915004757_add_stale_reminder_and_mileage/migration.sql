-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "staleShiftReminderHours" DOUBLE PRECISION DEFAULT 8;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "mileage" DOUBLE PRECISION;
