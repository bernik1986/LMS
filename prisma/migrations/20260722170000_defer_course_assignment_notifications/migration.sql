ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'deferred';

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "courseNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "User"
SET "courseNotificationsEnabled" = false
WHERE "mustChangePassword" = true;

ALTER TABLE "Notification"
ADD COLUMN IF NOT EXISTS "assignmentId" TEXT NOT NULL DEFAULT '';
