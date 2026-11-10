-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FORGOTTEN_CHECKOUT', 'FORGOTTEN_CHECKOUT_ESCALATION', 'FORGOTTEN_CHECKOUT_EXPLANATION');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'SENT', 'NOT_CONFIGURED', 'FAILED');

-- CreateEnum
CREATE TYPE "ForgottenCheckoutStatus" AS ENUM ('AWAITING_CHECKOUT', 'REMINDER_SENT', 'ESCALATED', 'REQUIRES_HR_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ForgottenCheckoutResolution" AS ENUM ('CHECKED_OUT', 'CORRECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ForgottenCheckoutEventType" AS ENUM ('CREATED', 'REMINDER', 'MANAGER_NOTIFIED', 'HR_NOTIFIED', 'MANUAL_REMINDER', 'ESCALATED_TO_HR', 'EXPLANATION', 'RESOLVED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'HR';

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "emailStatus" "EmailStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "emailAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgottenCheckoutSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "alertAfterMinutes" INTEGER NOT NULL DEFAULT 15,
    "repeatReminders" BOOLEAN NOT NULL DEFAULT true,
    "reminderIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "maxReminders" INTEGER NOT NULL DEFAULT 3,
    "notifyEmployee" BOOLEAN NOT NULL DEFAULT true,
    "notifyManager" BOOLEAN NOT NULL DEFAULT true,
    "managerAfterMinutes" INTEGER NOT NULL DEFAULT 60,
    "notifyHr" BOOLEAN NOT NULL DEFAULT true,
    "hrAfterMinutes" INTEGER NOT NULL DEFAULT 240,
    "sendEmail" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ForgottenCheckoutSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgottenCheckoutAlert" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scheduledEndAt" TIMESTAMP(3) NOT NULL,
    "status" "ForgottenCheckoutStatus" NOT NULL DEFAULT 'AWAITING_CHECKOUT',
    "alertCount" INTEGER NOT NULL DEFAULT 0,
    "lastAlertAt" TIMESTAMP(3),
    "managerNotifiedAt" TIMESTAMP(3),
    "hrNotifiedAt" TIMESTAMP(3),
    "explanation" TEXT,
    "explainedAt" TIMESTAMP(3),
    "resolution" "ForgottenCheckoutResolution",
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForgottenCheckoutAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgottenCheckoutEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "type" "ForgottenCheckoutEventType" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForgottenCheckoutEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "name" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastSummary" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_emailStatus_idx" ON "Notification"("emailStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ForgottenCheckoutAlert_attendanceId_key" ON "ForgottenCheckoutAlert"("attendanceId");

-- CreateIndex
CREATE INDEX "ForgottenCheckoutAlert_userId_idx" ON "ForgottenCheckoutAlert"("userId");

-- CreateIndex
CREATE INDEX "ForgottenCheckoutAlert_status_idx" ON "ForgottenCheckoutAlert"("status");

-- CreateIndex
CREATE INDEX "ForgottenCheckoutAlert_date_idx" ON "ForgottenCheckoutAlert"("date");

-- CreateIndex
CREATE INDEX "ForgottenCheckoutEvent_alertId_idx" ON "ForgottenCheckoutEvent"("alertId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgottenCheckoutSettings" ADD CONSTRAINT "ForgottenCheckoutSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgottenCheckoutAlert" ADD CONSTRAINT "ForgottenCheckoutAlert_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgottenCheckoutAlert" ADD CONSTRAINT "ForgottenCheckoutAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgottenCheckoutEvent" ADD CONSTRAINT "ForgottenCheckoutEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "ForgottenCheckoutAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgottenCheckoutEvent" ADD CONSTRAINT "ForgottenCheckoutEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

