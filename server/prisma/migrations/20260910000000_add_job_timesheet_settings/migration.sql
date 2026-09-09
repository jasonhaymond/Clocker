-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "timesheetBiweeklyAnchor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "timesheetFormat" TEXT NOT NULL DEFAULT 'both',
ADD COLUMN     "timesheetIncludeEarnings" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "timesheetIncludeNotes" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "timesheetIncludeTimes" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "timesheetMonthlyStartDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "timesheetPeriodType" TEXT NOT NULL DEFAULT 'weekly',
ADD COLUMN     "timesheetWeekStartDay" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "JobManager" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "JobManager_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobManager_jobId_updatedAt_idx" ON "JobManager"("jobId", "updatedAt");

-- CreateIndex
CREATE INDEX "JobManager_managerId_idx" ON "JobManager"("managerId");

-- AddForeignKey
ALTER TABLE "JobManager" ADD CONSTRAINT "JobManager_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobManager" ADD CONSTRAINT "JobManager_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE CASCADE ON UPDATE CASCADE;

