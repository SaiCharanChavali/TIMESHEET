-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "correctedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "requestedCheckInAt" TIMESTAMP(3) NOT NULL,
    "requestedCheckOutAt" TIMESTAMP(3) NOT NULL,
    "requestedBreakMinutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "originalCheckInAt" TIMESTAMP(3),
    "originalCheckOutAt" TIMESTAMP(3),
    "originalBreakMinutes" INTEGER,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "status" "TimesheetStatus" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "workedMinutes" INTEGER NOT NULL,
    "overtimeMinutes" INTEGER NOT NULL,
    "statuses" JSONB NOT NULL,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorrectionRequest_userId_date_idx" ON "CorrectionRequest"("userId", "date");

-- CreateIndex
CREATE INDEX "CorrectionRequest_status_idx" ON "CorrectionRequest"("status");

-- CreateIndex
CREATE INDEX "Timesheet_status_idx" ON "Timesheet"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_userId_periodStart_key" ON "Timesheet"("userId", "periodStart");

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
