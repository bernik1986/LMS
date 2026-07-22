ALTER TABLE "Notification" ADD COLUMN "certificateId" TEXT NOT NULL DEFAULT '';

CREATE INDEX "Notification_certificateId_idx" ON "Notification"("certificateId");
