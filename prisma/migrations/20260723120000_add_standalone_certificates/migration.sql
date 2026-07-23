CREATE TABLE "StandaloneCertificate" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'issued',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "snapshotFirstName" TEXT NOT NULL,
    "snapshotLastName" TEXT NOT NULL,
    "snapshotBirthDate" TIMESTAMP(3) NOT NULL,
    "snapshotPosition" TEXT NOT NULL DEFAULT '',
    "snapshotCompany" TEXT NOT NULL DEFAULT '',
    "snapshotPhotoUrl" TEXT NOT NULL DEFAULT '',
    "snapshotCourseTitle" TEXT NOT NULL,
    "snapshotCertificateTemplateHtml" TEXT NOT NULL,
    "certificateHtml" TEXT NOT NULL,
    "createdById" TEXT NOT NULL DEFAULT '',
    "createdByEmail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandaloneCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StandaloneCertificate_certificateNumber_key"
ON "StandaloneCertificate"("certificateNumber");

CREATE INDEX "StandaloneCertificate_courseId_idx"
ON "StandaloneCertificate"("courseId");

CREATE INDEX "StandaloneCertificate_status_idx"
ON "StandaloneCertificate"("status");

CREATE INDEX "StandaloneCertificate_issuedAt_idx"
ON "StandaloneCertificate"("issuedAt");
