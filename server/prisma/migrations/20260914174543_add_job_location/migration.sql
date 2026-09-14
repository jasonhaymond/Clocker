-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "autoClockInOutEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationAwarenessEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationLatitude" DOUBLE PRECISION,
ADD COLUMN     "locationLongitude" DOUBLE PRECISION,
ADD COLUMN     "locationRadiusMeters" DOUBLE PRECISION;
