-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'instructor', 'student');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive', 'deleted');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('new', 'contacted', 'accepted', 'rejected', 'converted_to_user');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('not_started', 'in_progress', 'materials_completed', 'test_available', 'test_failed', 'test_passed', 'completed');

-- CreateEnum
CREATE TYPE "MaterialType" AS ENUM ('video', 'audio', 'text', 'pdf', 'image', 'download');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('single_choice', 'multiple_choice');

-- CreateEnum
CREATE TYPE "TestAttemptStatus" AS ENUM ('in_progress', 'passed', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('issued', 'revoked', 'reissued');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'logged', 'sent', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'student',
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstNameEn" TEXT NOT NULL,
    "lastNameEn" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "company" TEXT NOT NULL DEFAULT '',
    "position" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "photoUrl" TEXT NOT NULL DEFAULT '',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "source" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseApplication" (
    "id" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "courseId" TEXT,
    "comment" TEXT NOT NULL DEFAULT '',
    "status" "ApplicationStatus" NOT NULL DEFAULT 'new',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL DEFAULT '',
    "fullDescription" TEXT NOT NULL DEFAULT '',
    "goals" TEXT NOT NULL DEFAULT '',
    "requirements" TEXT NOT NULL DEFAULT '',
    "status" "CourseStatus" NOT NULL DEFAULT 'active',
    "isSequential" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "showOnHome" BOOLEAN NOT NULL DEFAULT false,
    "homeSortOrder" INTEGER NOT NULL DEFAULT 999,
    "certificateTemplateHtml" TEXT NOT NULL,
    "source" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "status" "CourseStatus" NOT NULL DEFAULT 'active',
    "source" JSONB,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "type" "MaterialType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "source" JSONB,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assignedById" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'not_started',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "materialProgress" JSONB,
    "activeTestStartedAt" TIMESTAMP(3),
    "extraTestAttempts" INTEGER NOT NULL DEFAULT 0,
    "source" JSONB,

    CONSTRAINT "CourseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "attemptsLimit" INTEGER NOT NULL DEFAULT 3,
    "passingPercent" INTEGER NOT NULL DEFAULT 80,
    "timeLimitMinutes" INTEGER NOT NULL DEFAULT 0,
    "showResultToUser" BOOLEAN NOT NULL DEFAULT true,
    "allowRetake" BOOLEAN NOT NULL DEFAULT true,
    "status" "TestStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestQuestion" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL DEFAULT 'single_choice',
    "questionText" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "source" JSONB,

    CONSTRAINT "TestQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "optionText" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TestOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAttempt" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "scorePercent" INTEGER NOT NULL DEFAULT 0,
    "status" "TestAttemptStatus" NOT NULL DEFAULT 'in_progress',
    "failureReason" TEXT NOT NULL DEFAULT '',
    "answers" JSONB,
    "source" JSONB,

    CONSTRAINT "TestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'issued',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "replacesCertificateId" TEXT NOT NULL DEFAULT '',
    "revokedAt" TIMESTAMP(3),
    "reissuedAt" TIMESTAMP(3),
    "snapshotFirstName" TEXT NOT NULL,
    "snapshotLastName" TEXT NOT NULL,
    "snapshotBirthDate" TIMESTAMP(3),
    "snapshotPosition" TEXT NOT NULL DEFAULT '',
    "snapshotCompany" TEXT NOT NULL DEFAULT '',
    "snapshotPhotoUrl" TEXT NOT NULL DEFAULT '',
    "snapshotCourseTitle" TEXT NOT NULL,
    "snapshotCertificateTemplateHtml" TEXT NOT NULL,
    "certificateHtml" TEXT NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'logged',
    "payload" TEXT NOT NULL,
    "temporaryPassword" TEXT NOT NULL DEFAULT '',
    "errorMessage" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT,
    "adminEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateEvent" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT,
    "certificateNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL DEFAULT '',
    "actorEmail" TEXT NOT NULL DEFAULT 'system',
    "actorRole" TEXT NOT NULL DEFAULT 'system',
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_status_idx" ON "User"("status");
CREATE INDEX "CourseApplication_courseId_idx" ON "CourseApplication"("courseId");
CREATE INDEX "CourseApplication_status_idx" ON "CourseApplication"("status");
CREATE INDEX "Course_status_idx" ON "Course"("status");
CREATE INDEX "Course_showOnHome_homeSortOrder_idx" ON "Course"("showOnHome", "homeSortOrder");
CREATE INDEX "Lesson_courseId_sortOrder_idx" ON "Lesson"("courseId", "sortOrder");
CREATE INDEX "Material_lessonId_sortOrder_idx" ON "Material"("lessonId", "sortOrder");
CREATE INDEX "Material_type_idx" ON "Material"("type");
CREATE UNIQUE INDEX "CourseAssignment_userId_courseId_key" ON "CourseAssignment"("userId", "courseId");
CREATE INDEX "CourseAssignment_courseId_idx" ON "CourseAssignment"("courseId");
CREATE INDEX "CourseAssignment_status_idx" ON "CourseAssignment"("status");
CREATE UNIQUE INDEX "Test_courseId_key" ON "Test"("courseId");
CREATE INDEX "TestQuestion_testId_sortOrder_idx" ON "TestQuestion"("testId", "sortOrder");
CREATE INDEX "TestOption_questionId_sortOrder_idx" ON "TestOption"("questionId", "sortOrder");
CREATE UNIQUE INDEX "TestAttempt_assignmentId_attemptNumber_key" ON "TestAttempt"("assignmentId", "attemptNumber");
CREATE INDEX "TestAttempt_userId_idx" ON "TestAttempt"("userId");
CREATE INDEX "TestAttempt_testId_idx" ON "TestAttempt"("testId");
CREATE INDEX "TestAttempt_status_idx" ON "TestAttempt"("status");
CREATE UNIQUE INDEX "Certificate_certificateNumber_key" ON "Certificate"("certificateNumber");
CREATE INDEX "Certificate_userId_idx" ON "Certificate"("userId");
CREATE INDEX "Certificate_courseId_idx" ON "Certificate"("courseId");
CREATE INDEX "Certificate_assignmentId_idx" ON "Certificate"("assignmentId");
CREATE INDEX "Certificate_status_idx" ON "Certificate"("status");
CREATE INDEX "Certificate_issuedAt_idx" ON "Certificate"("issuedAt");
CREATE INDEX "Notification_recipientUserId_idx" ON "Notification"("recipientUserId");
CREATE INDEX "Notification_status_idx" ON "Notification"("status");
CREATE INDEX "Notification_type_idx" ON "Notification"("type");
CREATE INDEX "AuditEvent_adminUserId_idx" ON "AuditEvent"("adminUserId");
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
CREATE INDEX "CertificateEvent_certificateId_idx" ON "CertificateEvent"("certificateId");
CREATE INDEX "CertificateEvent_userId_idx" ON "CertificateEvent"("userId");
CREATE INDEX "CertificateEvent_courseId_idx" ON "CertificateEvent"("courseId");
CREATE INDEX "CertificateEvent_action_idx" ON "CertificateEvent"("action");
CREATE INDEX "CertificateEvent_createdAt_idx" ON "CertificateEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "CourseApplication" ADD CONSTRAINT "CourseApplication_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Material" ADD CONSTRAINT "Material_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseAssignment" ADD CONSTRAINT "CourseAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseAssignment" ADD CONSTRAINT "CourseAssignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseAssignment" ADD CONSTRAINT "CourseAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Test" ADD CONSTRAINT "Test_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestOption" ADD CONSTRAINT "TestOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "TestQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CourseAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CourseAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CertificateEvent" ADD CONSTRAINT "CertificateEvent_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CertificateEvent" ADD CONSTRAINT "CertificateEvent_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
