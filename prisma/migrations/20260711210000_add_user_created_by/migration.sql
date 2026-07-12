ALTER TABLE "User" ADD COLUMN "createdById" TEXT NOT NULL DEFAULT '';

CREATE INDEX "User_createdById_idx" ON "User"("createdById");
