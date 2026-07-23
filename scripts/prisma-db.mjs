import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export const defaultConnectionString = "postgresql://postgres:postgres@localhost:5432/marine_lms?schema=public";

const userRoles = new Set(["admin", "instructor", "student"]);
const userStatuses = new Set(["active", "inactive", "deleted"]);
const courseStatuses = new Set(["active", "inactive"]);
const applicationStatuses = new Set(["new", "contacted", "accepted", "rejected", "converted_to_user"]);
const assignmentStatuses = new Set(["not_started", "in_progress", "materials_completed", "test_available", "test_failed", "test_passed", "completed"]);
const materialTypes = new Set(["video", "audio", "text", "pdf", "image", "download"]);
const testStatuses = new Set(["active", "inactive"]);
const questionTypes = new Set(["single_choice", "multiple_choice"]);
const attemptStatuses = new Set(["in_progress", "passed", "failed", "expired"]);
const certificateStatuses = new Set(["issued", "revoked", "reissued"]);
const notificationStatuses = new Set(["deferred", "queued", "logged", "sent", "failed"]);

export function resolveConnectionString(value = process.env.DATABASE_URL) {
  return value || defaultConnectionString;
}

export function maskedConnectionString(value) {
  return String(value || "").replace(/:[^:@/]+@/, ":***@");
}

function dateOrNull(value) {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOrNow(value) {
  return dateOrNull(value) ?? new Date();
}

function dateTimeString(value) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : "";
}

function dateOnlyString(value) {
  return dateTimeString(value).slice(0, 10);
}

function enumValue(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function jsonValue(value) {
  return value === undefined || value === null ? undefined : value;
}

function objectWithOptionalJson(object, key, value) {
  const normalized = jsonValue(value);
  if (normalized !== undefined) object[key] = normalized;
  return object;
}

function compactObject(object) {
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) delete object[key];
  }
  return object;
}

export function flattenDb(db) {
  const users = db.users ?? [];
  const courses = db.courses ?? [];
  const lessons = [];
  const materials = [];
  const tests = [];
  const questions = [];
  const options = [];

  for (const course of courses) {
    for (const lesson of course.lessons ?? []) {
      lessons.push({ ...lesson, courseId: course.id });
      for (const material of lesson.materials ?? []) {
        materials.push({ ...material, lessonId: lesson.id });
      }
    }
    if (course.test) {
      tests.push({ ...course.test, courseId: course.id });
      for (const question of course.test.questions ?? []) {
        questions.push({ ...question, testId: course.test.id });
        for (const option of question.options ?? []) {
          options.push({ ...option, questionId: question.id });
        }
      }
    }
  }

  return {
    users,
    courses,
    lessons,
    materials,
    tests,
    questions,
    options,
    applications: db.applications ?? [],
    assignments: db.assignments ?? [],
    testAttempts: db.testAttempts ?? [],
    certificates: db.certificates ?? [],
    standaloneCertificates: db.standaloneCertificates ?? [],
    notifications: db.notifications ?? [],
    sessions: db.sessions ?? [],
    passwordResetTokens: db.passwordResetTokens ?? [],
    auditEvents: db.auditEvents ?? [],
    certificateEvents: db.certificateEvents ?? [],
    settings: db.settings ?? {}
  };
}

export function migrationSummary(flat) {
  return {
    users: flat.users.length,
    courses: flat.courses.length,
    lessons: flat.lessons.length,
    materials: flat.materials.length,
    tests: flat.tests.length,
    questions: flat.questions.length,
    options: flat.options.length,
    applications: flat.applications.length,
    assignments: flat.assignments.length,
    testAttempts: flat.testAttempts.length,
    certificates: flat.certificates.length,
    standaloneCertificates: flat.standaloneCertificates.length,
    notifications: flat.notifications.length,
    sessions: flat.sessions.length,
    passwordResetTokens: flat.passwordResetTokens.length,
    auditEvents: flat.auditEvents.length,
    certificateEvents: flat.certificateEvents.length,
    settings: Object.keys(flat.settings).length ? 1 : 0
  };
}

function duplicateKeys(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));
}

function addDuplicateErrors(errors, label, duplicates) {
  for (const duplicate of duplicates) {
    errors.push(`${label}: duplicate ${duplicate.key} (${duplicate.count} records)`);
  }
}

function invalidIds(items, predicate) {
  return items.filter((item) => !predicate(item)).map((item) => item.id ?? "(missing id)");
}

export function validateFlatDb(flat) {
  const errors = [];
  const warnings = [];
  const userIds = new Set(flat.users.map((user) => user.id));
  const courseIds = new Set(flat.courses.map((course) => course.id));
  const lessonIds = new Set(flat.lessons.map((lesson) => lesson.id));
  const testIds = new Set(flat.tests.map((test) => test.id));
  const questionIds = new Set(flat.questions.map((question) => question.id));
  const assignmentIds = new Set(flat.assignments.map((assignment) => assignment.id));
  const certificateIds = new Set(flat.certificates.map((certificate) => certificate.id));
  const allCertificates = [...flat.certificates, ...flat.standaloneCertificates];

  addDuplicateErrors(errors, "users.id", duplicateKeys(flat.users, (user) => user.id));
  addDuplicateErrors(errors, "users.email", duplicateKeys(flat.users, (user) => user.email?.toLowerCase()));
  addDuplicateErrors(errors, "courses.id", duplicateKeys(flat.courses, (course) => course.id));
  addDuplicateErrors(errors, "lessons.id", duplicateKeys(flat.lessons, (lesson) => lesson.id));
  addDuplicateErrors(errors, "materials.id", duplicateKeys(flat.materials, (material) => material.id));
  addDuplicateErrors(errors, "tests.id", duplicateKeys(flat.tests, (test) => test.id));
  addDuplicateErrors(errors, "tests.courseId", duplicateKeys(flat.tests, (test) => test.courseId));
  addDuplicateErrors(errors, "questions.id", duplicateKeys(flat.questions, (question) => question.id));
  addDuplicateErrors(errors, "options.id", duplicateKeys(flat.options, (option) => option.id));
  addDuplicateErrors(errors, "assignments.id", duplicateKeys(flat.assignments, (assignment) => assignment.id));
  addDuplicateErrors(errors, "assignments.userId+courseId", duplicateKeys(flat.assignments, (assignment) => `${assignment.userId}|${assignment.courseId}`));
  addDuplicateErrors(errors, "testAttempts.id", duplicateKeys(flat.testAttempts, (attempt) => attempt.id));
  addDuplicateErrors(errors, "testAttempts.assignmentId+attemptNumber", duplicateKeys(flat.testAttempts, (attempt) => `${attempt.assignmentId}|${attempt.attemptNumber}`));
  addDuplicateErrors(errors, "certificates.id", duplicateKeys(flat.certificates, (certificate) => certificate.id));
  addDuplicateErrors(errors, "certificates.certificateNumber", duplicateKeys(flat.certificates, (certificate) => certificate.certificateNumber));
  addDuplicateErrors(errors, "standaloneCertificates.id", duplicateKeys(flat.standaloneCertificates, (certificate) => certificate.id));
  addDuplicateErrors(errors, "standaloneCertificates.certificateNumber", duplicateKeys(flat.standaloneCertificates, (certificate) => certificate.certificateNumber));
  addDuplicateErrors(errors, "allCertificates.certificateNumber", duplicateKeys(allCertificates, (certificate) => certificate.certificateNumber));

  for (const user of flat.users) {
    if (!user.id || !user.email || !user.passwordHash) {
      errors.push(`users: ${user.id || user.email || "(missing id)"} is missing id, email, or passwordHash`);
    }
  }
  for (const course of flat.courses) {
    if (!course.id || !course.title) {
      errors.push(`courses: ${course.id || "(missing id)"} is missing id or title`);
    }
  }
  for (const certificate of flat.standaloneCertificates) {
    if (
      !certificate.id ||
      !certificate.courseId ||
      !certificate.certificateNumber ||
      !certificate.snapshotFirstName ||
      !certificate.snapshotLastName ||
      !certificate.snapshotBirthDate ||
      !certificate.snapshotCourseTitle ||
      !certificate.snapshotCertificateTemplateHtml
    ) {
      errors.push(`standaloneCertificates: ${certificate.id || "(missing id)"} is missing required certificate snapshot data`);
    }
  }

  for (const id of invalidIds(flat.lessons, (lesson) => courseIds.has(lesson.courseId))) {
    errors.push(`lessons: ${id} references a missing course`);
  }
  for (const id of invalidIds(flat.materials, (material) => lessonIds.has(material.lessonId))) {
    errors.push(`materials: ${id} references a missing lesson`);
  }
  for (const id of invalidIds(flat.tests, (test) => courseIds.has(test.courseId))) {
    errors.push(`tests: ${id} references a missing course`);
  }
  for (const id of invalidIds(flat.questions, (question) => testIds.has(question.testId))) {
    errors.push(`questions: ${id} references a missing test`);
  }
  for (const id of invalidIds(flat.options, (option) => questionIds.has(option.questionId))) {
    errors.push(`options: ${id} references a missing question`);
  }
  for (const id of invalidIds(flat.assignments, (assignment) => userIds.has(assignment.userId) && courseIds.has(assignment.courseId))) {
    errors.push(`assignments: ${id} references a missing user or course`);
  }
  for (const id of invalidIds(flat.sessions, (session) => userIds.has(session.userId))) {
    errors.push(`sessions: ${id} references a missing user`);
  }
  for (const id of invalidIds(flat.passwordResetTokens, (token) => userIds.has(token.userId))) {
    errors.push(`passwordResetTokens: ${id} references a missing user`);
  }
  for (const id of invalidIds(flat.testAttempts, (attempt) => assignmentIds.has(attempt.assignmentId) && testIds.has(attempt.testId) && userIds.has(attempt.userId))) {
    errors.push(`testAttempts: ${id} references a missing assignment, test, or user`);
  }
  for (const id of invalidIds(flat.certificates, (certificate) => userIds.has(certificate.userId) && courseIds.has(certificate.courseId) && assignmentIds.has(certificate.assignmentId))) {
    errors.push(`certificates: ${id} references a missing user, course, or assignment`);
  }

  for (const application of flat.applications) {
    if (application.courseId && !courseIds.has(application.courseId)) {
      warnings.push(`applications: ${application.id} references a missing course and will be imported without course link`);
    }
  }
  for (const notification of flat.notifications) {
    if (notification.recipientUserId && !userIds.has(notification.recipientUserId)) {
      warnings.push(`notifications: ${notification.id} references a missing user and will be imported without user link`);
    }
  }
  for (const event of flat.auditEvents) {
    if (event.adminUserId && !userIds.has(event.adminUserId)) {
      warnings.push(`auditEvents: ${event.id} references a missing admin and will be imported without admin link`);
    }
  }
  for (const event of flat.certificateEvents) {
    if (event.certificateId && !certificateIds.has(event.certificateId)) {
      warnings.push(`certificateEvents: ${event.id} references a missing certificate and will be imported without certificate link`);
    }
    if (event.courseId && !courseIds.has(event.courseId)) {
      warnings.push(`certificateEvents: ${event.id} references a missing course and will be imported without course link`);
    }
  }

  return { errors, warnings };
}

export function createPrismaClient(connectionString = resolveConnectionString()) {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export async function prismaDataCounts(options = {}) {
  const prisma = options.prisma ?? createPrismaClient(resolveConnectionString(options.connectionString));
  const shouldDisconnect = !options.prisma;

  try {
    const [
      users,
      applications,
      courses,
      lessons,
      materials,
      assignments,
      tests,
      questions,
      optionsCount,
      attempts,
      certificates,
      standaloneCertificates,
      notifications,
      auditEvents,
      certificateEvents,
      settings
    ] = await Promise.all([
      prisma.user.count(),
      prisma.courseApplication.count(),
      prisma.course.count(),
      prisma.lesson.count(),
      prisma.material.count(),
      prisma.courseAssignment.count(),
      prisma.test.count(),
      prisma.testQuestion.count(),
      prisma.testOption.count(),
      prisma.testAttempt.count(),
      prisma.certificate.count(),
      prisma.standaloneCertificate.count(),
      prisma.notification.count(),
      prisma.auditEvent.count(),
      prisma.certificateEvent.count(),
      prisma.appSetting.count()
    ]);

    const counts = {
      users,
      applications,
      courses,
      lessons,
      materials,
      assignments,
      tests,
      questions,
      options: optionsCount,
      attempts,
      certificates,
      standaloneCertificates,
      notifications,
      auditEvents,
      certificateEvents,
      settings
    };

    return {
      counts,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0)
    };
  } finally {
    if (shouldDisconnect) await prisma.$disconnect();
  }
}

async function clearTables(client) {
  await client.session.deleteMany();
  await client.passwordResetToken.deleteMany();
  await client.certificateEvent.deleteMany();
  await client.auditEvent.deleteMany();
  await client.notification.deleteMany();
  await client.standaloneCertificate.deleteMany();
  await client.certificate.deleteMany();
  await client.testAttempt.deleteMany();
  await client.testOption.deleteMany();
  await client.testQuestion.deleteMany();
  await client.test.deleteMany();
  await client.material.deleteMany();
  await client.lesson.deleteMany();
  await client.courseAssignment.deleteMany();
  await client.courseApplication.deleteMany();
  await client.course.deleteMany();
  await client.user.deleteMany();
  await client.appSetting.deleteMany();
}

export async function clearPrismaDatabase(prisma) {
  await prisma.$transaction(async (tx) => {
    await clearTables(tx);
  });
}

async function writeFlatDb(client, flat) {
  const userIds = new Set(flat.users.map((user) => user.id));
  const courseIds = new Set(flat.courses.map((course) => course.id));
  const lessonIds = new Set(flat.lessons.map((lesson) => lesson.id));
  const assignmentIds = new Set(flat.assignments.map((assignment) => assignment.id));
  const testIds = new Set(flat.tests.map((test) => test.id));
  const questionIds = new Set(flat.questions.map((question) => question.id));
  const certificateIds = new Set(flat.certificates.map((certificate) => certificate.id));

  if (flat.users.length) {
    await client.user.createMany({
      data: flat.users.map((user) =>
        objectWithOptionalJson(
          {
            id: user.id,
            role: enumValue(user.role, userRoles, "student"),
            email: user.email,
            passwordHash: user.passwordHash,
            firstNameEn: user.firstNameEn ?? "",
            lastNameEn: user.lastNameEn ?? "",
            birthDate: dateOrNull(user.birthDate),
            company: user.company ?? "",
            position: user.position ?? "",
            phone: user.phone ?? "",
            photoUrl: user.photoUrl ?? "",
            status: enumValue(user.status, userStatuses, "active"),
            createdById: user.createdById ?? "",
            authVersion: Number(user.authVersion) || 1,
            mustChangePassword: Boolean(user.mustChangePassword),
            courseNotificationsEnabled: user.courseNotificationsEnabled !== false,
            createdAt: dateOrNow(user.createdAt)
          },
          "source",
          user.source
        )
      )
    });
  }

  if (flat.courses.length) {
    await client.course.createMany({
      data: flat.courses.map((course) =>
        objectWithOptionalJson(
          {
            id: course.id,
            title: course.title ?? "",
            shortDescription: course.shortDescription ?? "",
            fullDescription: course.fullDescription ?? "",
            goals: course.goals ?? "",
            requirements: course.requirements ?? "",
            oldPrice: course.oldPrice ?? "",
            newPrice: course.newPrice ?? "",
            status: enumValue(course.status, courseStatuses, "active"),
            isSequential: Boolean(course.isSequential ?? true),
            imageUrl: course.imageUrl ?? "",
            showOnHome: Boolean(course.showOnHome),
            homeSortOrder: Number(course.homeSortOrder) || 999,
            autoIssueCertificate: course.autoIssueCertificate !== false,
            certificateTemplateHtml: course.certificateTemplateHtml ?? "",
            createdAt: dateOrNow(course.createdAt)
          },
          "source",
          course.source
        )
      )
    });
  }

  if (flat.lessons.length) {
    await client.lesson.createMany({
      data: flat.lessons
        .filter((lesson) => courseIds.has(lesson.courseId))
        .map((lesson) =>
          objectWithOptionalJson(
            {
              id: lesson.id,
              courseId: lesson.courseId,
              title: lesson.title ?? "",
              description: lesson.description ?? "",
              sortOrder: Number(lesson.sortOrder) || 0,
              isRequired: Boolean(lesson.isRequired ?? true),
              status: enumValue(lesson.status, courseStatuses, "active")
            },
            "source",
            lesson.source
          )
        )
    });
  }

  if (flat.materials.length) {
    await client.material.createMany({
      data: flat.materials
        .filter((material) => lessonIds.has(material.lessonId))
        .map((material) =>
          objectWithOptionalJson(
            {
              id: material.id,
              lessonId: material.lessonId,
              type: enumValue(material.type, materialTypes, "text"),
              title: material.title ?? "",
              content: material.content ?? "",
              isRequired: Boolean(material.isRequired ?? true),
              sortOrder: Number(material.sortOrder) || 0
            },
            "source",
            material.source
          )
        )
    });
  }

  if (flat.tests.length) {
    await client.test.createMany({
      data: flat.tests
        .filter((test) => courseIds.has(test.courseId))
        .map((test) => ({
          id: test.id,
          courseId: test.courseId,
          title: test.title ?? "",
          description: test.description ?? "",
          attemptsLimit: Number(test.attemptsLimit) || 3,
          passingPercent: Number(test.passingPercent) || 80,
          timeLimitMinutes: Number(test.timeLimitMinutes) || 0,
          showResultToUser: Boolean(test.showResultToUser ?? true),
          allowRetake: Boolean(test.allowRetake ?? true),
          status: enumValue(test.status, testStatuses, "active")
        }))
    });
  }

  if (flat.questions.length) {
    await client.testQuestion.createMany({
      data: flat.questions
        .filter((question) => testIds.has(question.testId))
        .map((question) =>
          objectWithOptionalJson(
            {
              id: question.id,
              testId: question.testId,
              type: enumValue(question.type, questionTypes, "single_choice"),
              questionText: question.questionText ?? "",
              sortOrder: Number(question.sortOrder) || 0
            },
            "source",
            question.source
          )
        )
    });
  }

  if (flat.options.length) {
    await client.testOption.createMany({
      data: flat.options
        .filter((option) => questionIds.has(option.questionId))
        .map((option) => ({
          id: option.id,
          questionId: option.questionId,
          optionText: option.optionText ?? "",
          isCorrect: Boolean(option.isCorrect),
          sortOrder: Number(option.sortOrder) || 0
        }))
    });
  }

  if (flat.applications.length) {
    await client.courseApplication.createMany({
      data: flat.applications.map((application) => ({
        id: application.id,
        lastName: application.lastName ?? "",
        firstName: application.firstName ?? "",
        phone: application.phone ?? "",
        email: application.email ?? "",
        courseId: courseIds.has(application.courseId) ? application.courseId : null,
        comment: application.comment ?? "",
        status: enumValue(application.status, applicationStatuses, "new"),
        adminNote: application.adminNote ?? "",
        createdAt: dateOrNow(application.createdAt)
      }))
    });
  }

  if (flat.assignments.length) {
    await client.courseAssignment.createMany({
      data: flat.assignments
        .filter((assignment) => userIds.has(assignment.userId) && courseIds.has(assignment.courseId))
        .map((assignment) =>
          objectWithOptionalJson(
            objectWithOptionalJson(
              {
                id: assignment.id,
                userId: assignment.userId,
                courseId: assignment.courseId,
                assignedById: userIds.has(assignment.assignedById) ? assignment.assignedById : null,
                status: enumValue(assignment.status, assignmentStatuses, "not_started"),
                assignedAt: dateOrNow(assignment.assignedAt),
                startedAt: dateOrNull(assignment.startedAt),
                completedAt: dateOrNull(assignment.completedAt),
                progressPercent: Number(assignment.progressPercent) || 0,
                activeTestStartedAt: dateOrNull(assignment.activeTestStartedAt),
                extraTestAttempts: Number(assignment.extraTestAttempts) || 0
              },
              "materialProgress",
              assignment.materialProgress
            ),
            "source",
            assignment.source
          )
        )
    });
  }

  if (flat.testAttempts.length) {
    await client.testAttempt.createMany({
      data: flat.testAttempts
        .filter((attempt) => assignmentIds.has(attempt.assignmentId) && testIds.has(attempt.testId) && userIds.has(attempt.userId))
        .map((attempt) =>
          objectWithOptionalJson(
            objectWithOptionalJson(
              {
                id: attempt.id,
                assignmentId: attempt.assignmentId,
                testId: attempt.testId,
                userId: attempt.userId,
                attemptNumber: Number(attempt.attemptNumber) || 1,
                startedAt: dateOrNow(attempt.startedAt),
                finishedAt: dateOrNull(attempt.finishedAt),
                scorePercent: Number(attempt.scorePercent) || 0,
                status: enumValue(attempt.status, attemptStatuses, "failed"),
                failureReason: attempt.failureReason ?? ""
              },
              "answers",
              attempt.answers
            ),
            "source",
            attempt.source
          )
        )
    });
  }

  if (flat.certificates.length) {
    await client.certificate.createMany({
      data: flat.certificates
        .filter((certificate) => userIds.has(certificate.userId) && courseIds.has(certificate.courseId) && assignmentIds.has(certificate.assignmentId))
        .map((certificate) => ({
          id: certificate.id,
          userId: certificate.userId,
          courseId: certificate.courseId,
          assignmentId: certificate.assignmentId,
          certificateNumber: certificate.certificateNumber,
          status: enumValue(certificate.status, certificateStatuses, "issued"),
          issuedAt: dateOrNow(certificate.issuedAt),
          expiresAt: dateOrNow(certificate.expiresAt),
          replacesCertificateId: certificate.replacesCertificateId ?? "",
          revokedAt: dateOrNull(certificate.revokedAt),
          reissuedAt: dateOrNull(certificate.reissuedAt),
          snapshotFirstName: certificate.snapshotFirstName ?? "",
          snapshotLastName: certificate.snapshotLastName ?? "",
          snapshotBirthDate: dateOrNull(certificate.snapshotBirthDate),
          snapshotPosition: certificate.snapshotPosition ?? "",
          snapshotCompany: certificate.snapshotCompany ?? "",
          snapshotPhotoUrl: certificate.snapshotPhotoUrl ?? "",
          snapshotCourseTitle: certificate.snapshotCourseTitle ?? "",
          snapshotCertificateTemplateHtml: certificate.snapshotCertificateTemplateHtml ?? "",
          certificateHtml: certificate.certificateHtml ?? ""
        }))
    });
  }

  if (flat.standaloneCertificates.length) {
    await client.standaloneCertificate.createMany({
      data: flat.standaloneCertificates.map((certificate) => ({
        id: certificate.id,
        courseId: certificate.courseId,
        certificateNumber: certificate.certificateNumber,
        status: enumValue(certificate.status, certificateStatuses, "issued"),
        issuedAt: dateOrNow(certificate.issuedAt),
        expiresAt: dateOrNow(certificate.expiresAt),
        snapshotFirstName: certificate.snapshotFirstName ?? "",
        snapshotLastName: certificate.snapshotLastName ?? "",
        snapshotBirthDate: dateOrNow(certificate.snapshotBirthDate),
        snapshotPosition: certificate.snapshotPosition ?? "",
        snapshotCompany: certificate.snapshotCompany ?? "",
        snapshotPhotoUrl: certificate.snapshotPhotoUrl ?? "",
        snapshotCourseTitle: certificate.snapshotCourseTitle ?? "",
        snapshotCertificateTemplateHtml: certificate.snapshotCertificateTemplateHtml ?? "",
        certificateHtml: certificate.certificateHtml ?? "",
        createdById: certificate.createdById ?? "",
        createdByEmail: certificate.createdByEmail ?? "",
        createdAt: dateOrNow(certificate.createdAt)
      }))
    });
  }

  if (flat.notifications.length) {
    await client.notification.createMany({
      data: flat.notifications.map((note) => ({
        id: note.id,
        recipientUserId: userIds.has(note.recipientUserId) ? note.recipientUserId : null,
        recipientEmail: note.recipientEmail ?? "",
        assignmentId: note.assignmentId ?? "",
        certificateId: note.certificateId ?? "",
        type: note.type ?? "",
        status: enumValue(note.status, notificationStatuses, "logged"),
        payload: note.payload ?? "",
        errorMessage: note.errorMessage ?? "",
        createdAt: dateOrNow(note.createdAt),
        sentAt: dateOrNull(note.sentAt)
      }))
    });
  }

  if (flat.sessions.length) {
    await client.session.createMany({
      data: flat.sessions
        .filter((session) => userIds.has(session.userId))
        .map((session) => ({
          id: session.id,
          tokenHash: session.tokenHash,
          csrfToken: session.csrfToken,
          userId: session.userId,
          authVersion: Number(session.authVersion) || 1,
          expiresAt: dateOrNow(session.expiresAt),
          createdAt: dateOrNow(session.createdAt),
          lastSeenAt: dateOrNow(session.lastSeenAt)
        }))
    });
  }

  if (flat.passwordResetTokens.length) {
    await client.passwordResetToken.createMany({
      data: flat.passwordResetTokens
        .filter((token) => userIds.has(token.userId))
        .map((token) => ({
          id: token.id,
          tokenHash: token.tokenHash,
          userId: token.userId,
          expiresAt: dateOrNow(token.expiresAt),
          usedAt: dateOrNull(token.usedAt),
          createdAt: dateOrNow(token.createdAt)
        }))
    });
  }

  if (flat.auditEvents.length) {
    await client.auditEvent.createMany({
      data: flat.auditEvents.map((event) =>
        objectWithOptionalJson(
          {
            id: event.id,
            adminUserId: userIds.has(event.adminUserId) ? event.adminUserId : null,
            adminEmail: event.adminEmail ?? "",
            action: event.action ?? "",
            createdAt: dateOrNow(event.createdAt)
          },
          "details",
          event.details
        )
      )
    });
  }

  if (flat.certificateEvents.length) {
    await client.certificateEvent.createMany({
      data: flat.certificateEvents.map((event) =>
        objectWithOptionalJson(
          {
            id: event.id,
            certificateId: certificateIds.has(event.certificateId) ? event.certificateId : null,
            certificateNumber: event.certificateNumber ?? "",
            userId: event.userId ?? "",
            courseId: courseIds.has(event.courseId) ? event.courseId : null,
            action: event.action ?? "",
            actorUserId: event.actorUserId ?? "",
            actorEmail: event.actorEmail ?? "system",
            actorRole: event.actorRole ?? "system",
            createdAt: dateOrNow(event.createdAt)
          },
          "details",
          event.details
        )
      )
    });
  }

  await client.appSetting.upsert({
    where: { key: "settings" },
    update: { value: flat.settings ?? {} },
    create: { key: "settings", value: flat.settings ?? {} }
  });
}

export async function replacePrismaDb(db, options = {}) {
  const prisma = options.prisma ?? createPrismaClient(resolveConnectionString(options.connectionString));
  const shouldDisconnect = !options.prisma;
  const flat = flattenDb(db);
  const validation = validateFlatDb(flat);

  if (validation.errors.length) {
    throw new Error(`LMS data failed database validation: ${validation.errors.join("; ")}`);
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await clearTables(tx);
        await writeFlatDb(tx, flat);
      },
      { maxWait: 120000, timeout: 120000 }
    );
    return migrationSummary(flat);
  } finally {
    if (shouldDisconnect) await prisma.$disconnect();
  }
}

function stableRecord(value) {
  return JSON.stringify(value ?? null);
}

function changedRecords(previous = [], next = []) {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  return next.filter((item) => stableRecord(previousById.get(item.id)) !== stableRecord(item));
}

function removedIds(previous = [], next = []) {
  const nextIds = new Set(next.map((item) => item.id));
  return previous.filter((item) => !nextIds.has(item.id)).map((item) => item.id);
}

function updateData(data) {
  const update = { ...data };
  delete update.id;
  delete update.createdAt;
  return update;
}

async function upsertRecords(client, modelName, records, mapper) {
  for (const record of records) {
    const data = mapper(record);
    await client[modelName].upsert({ where: { id: data.id }, create: data, update: updateData(data) });
  }
}

function userData(user) {
  return objectWithOptionalJson({
    id: user.id,
    role: enumValue(user.role, userRoles, "student"),
    email: user.email,
    passwordHash: user.passwordHash,
    firstNameEn: user.firstNameEn ?? "",
    lastNameEn: user.lastNameEn ?? "",
    birthDate: dateOrNull(user.birthDate),
    company: user.company ?? "",
    position: user.position ?? "",
    phone: user.phone ?? "",
    photoUrl: user.photoUrl ?? "",
    status: enumValue(user.status, userStatuses, "active"),
    createdById: user.createdById ?? "",
    authVersion: Number(user.authVersion) || 1,
    mustChangePassword: Boolean(user.mustChangePassword),
    courseNotificationsEnabled: user.courseNotificationsEnabled !== false,
    createdAt: dateOrNow(user.createdAt)
  }, "source", user.source);
}

function courseData(course) {
  return objectWithOptionalJson({
    id: course.id,
    title: course.title ?? "",
    shortDescription: course.shortDescription ?? "",
    fullDescription: course.fullDescription ?? "",
    goals: course.goals ?? "",
    requirements: course.requirements ?? "",
    oldPrice: course.oldPrice ?? "",
    newPrice: course.newPrice ?? "",
    status: enumValue(course.status, courseStatuses, "active"),
    isSequential: Boolean(course.isSequential ?? true),
    imageUrl: course.imageUrl ?? "",
    showOnHome: Boolean(course.showOnHome),
    homeSortOrder: Number(course.homeSortOrder) || 999,
    autoIssueCertificate: course.autoIssueCertificate !== false,
    certificateTemplateHtml: course.certificateTemplateHtml ?? "",
    createdAt: dateOrNow(course.createdAt)
  }, "source", course.source);
}

function lessonData(lesson) {
  return objectWithOptionalJson({
    id: lesson.id, courseId: lesson.courseId, title: lesson.title ?? "", description: lesson.description ?? "",
    sortOrder: Number(lesson.sortOrder) || 0, isRequired: Boolean(lesson.isRequired ?? true),
    status: enumValue(lesson.status, courseStatuses, "active")
  }, "source", lesson.source);
}

function materialData(material) {
  return objectWithOptionalJson({
    id: material.id, lessonId: material.lessonId, type: enumValue(material.type, materialTypes, "text"),
    title: material.title ?? "", content: material.content ?? "", isRequired: Boolean(material.isRequired ?? true), sortOrder: Number(material.sortOrder) || 0
  }, "source", material.source);
}

function testData(test) {
  return {
    id: test.id, courseId: test.courseId, title: test.title ?? "", description: test.description ?? "",
    attemptsLimit: Number(test.attemptsLimit) || 3, passingPercent: Number(test.passingPercent) || 80,
    timeLimitMinutes: Number(test.timeLimitMinutes) || 0, showResultToUser: Boolean(test.showResultToUser ?? true),
    allowRetake: Boolean(test.allowRetake ?? true), status: enumValue(test.status, testStatuses, "active")
  };
}

function questionData(question) {
  return objectWithOptionalJson({
    id: question.id, testId: question.testId, type: enumValue(question.type, questionTypes, "single_choice"),
    questionText: question.questionText ?? "", sortOrder: Number(question.sortOrder) || 0
  }, "source", question.source);
}

function optionData(option) {
  return { id: option.id, questionId: option.questionId, optionText: option.optionText ?? "", isCorrect: Boolean(option.isCorrect), sortOrder: Number(option.sortOrder) || 0 };
}

function applicationData(application, courseIds) {
  return {
    id: application.id, lastName: application.lastName ?? "", firstName: application.firstName ?? "", phone: application.phone ?? "", email: application.email ?? "",
    courseId: courseIds.has(application.courseId) ? application.courseId : null, comment: application.comment ?? "",
    status: enumValue(application.status, applicationStatuses, "new"), adminNote: application.adminNote ?? "", createdAt: dateOrNow(application.createdAt)
  };
}

function assignmentData(assignment, userIds) {
  return objectWithOptionalJson(objectWithOptionalJson({
    id: assignment.id, userId: assignment.userId, courseId: assignment.courseId,
    assignedById: userIds.has(assignment.assignedById) ? assignment.assignedById : null,
    status: enumValue(assignment.status, assignmentStatuses, "not_started"), assignedAt: dateOrNow(assignment.assignedAt),
    startedAt: dateOrNull(assignment.startedAt), completedAt: dateOrNull(assignment.completedAt), progressPercent: Number(assignment.progressPercent) || 0,
    activeTestStartedAt: dateOrNull(assignment.activeTestStartedAt), extraTestAttempts: Number(assignment.extraTestAttempts) || 0
  }, "materialProgress", assignment.materialProgress), "source", assignment.source);
}

function testAttemptData(attempt) {
  return objectWithOptionalJson(objectWithOptionalJson({
    id: attempt.id, assignmentId: attempt.assignmentId, testId: attempt.testId, userId: attempt.userId,
    attemptNumber: Number(attempt.attemptNumber) || 1, startedAt: dateOrNow(attempt.startedAt), finishedAt: dateOrNull(attempt.finishedAt),
    scorePercent: Number(attempt.scorePercent) || 0, status: enumValue(attempt.status, attemptStatuses, "failed"), failureReason: attempt.failureReason ?? ""
  }, "answers", attempt.answers), "source", attempt.source);
}

function certificateData(certificate) {
  return {
    id: certificate.id, userId: certificate.userId, courseId: certificate.courseId, assignmentId: certificate.assignmentId,
    certificateNumber: certificate.certificateNumber, status: enumValue(certificate.status, certificateStatuses, "issued"),
    issuedAt: dateOrNow(certificate.issuedAt), expiresAt: dateOrNow(certificate.expiresAt), replacesCertificateId: certificate.replacesCertificateId ?? "",
    revokedAt: dateOrNull(certificate.revokedAt), reissuedAt: dateOrNull(certificate.reissuedAt), snapshotFirstName: certificate.snapshotFirstName ?? "",
    snapshotLastName: certificate.snapshotLastName ?? "", snapshotBirthDate: dateOrNull(certificate.snapshotBirthDate), snapshotPosition: certificate.snapshotPosition ?? "",
    snapshotCompany: certificate.snapshotCompany ?? "", snapshotPhotoUrl: certificate.snapshotPhotoUrl ?? "", snapshotCourseTitle: certificate.snapshotCourseTitle ?? "",
    snapshotCertificateTemplateHtml: certificate.snapshotCertificateTemplateHtml ?? "", certificateHtml: certificate.certificateHtml ?? ""
  };
}

function standaloneCertificateData(certificate) {
  return {
    id: certificate.id,
    courseId: certificate.courseId,
    certificateNumber: certificate.certificateNumber,
    status: enumValue(certificate.status, certificateStatuses, "issued"),
    issuedAt: dateOrNow(certificate.issuedAt),
    expiresAt: dateOrNow(certificate.expiresAt),
    snapshotFirstName: certificate.snapshotFirstName ?? "",
    snapshotLastName: certificate.snapshotLastName ?? "",
    snapshotBirthDate: dateOrNow(certificate.snapshotBirthDate),
    snapshotPosition: certificate.snapshotPosition ?? "",
    snapshotCompany: certificate.snapshotCompany ?? "",
    snapshotPhotoUrl: certificate.snapshotPhotoUrl ?? "",
    snapshotCourseTitle: certificate.snapshotCourseTitle ?? "",
    snapshotCertificateTemplateHtml: certificate.snapshotCertificateTemplateHtml ?? "",
    certificateHtml: certificate.certificateHtml ?? "",
    createdById: certificate.createdById ?? "",
    createdByEmail: certificate.createdByEmail ?? "",
    createdAt: dateOrNow(certificate.createdAt)
  };
}

function notificationData(note, userIds) {
  return {
    id: note.id, recipientUserId: userIds.has(note.recipientUserId) ? note.recipientUserId : null,
    recipientEmail: note.recipientEmail ?? "", assignmentId: note.assignmentId ?? "", certificateId: note.certificateId ?? "", type: note.type ?? "", status: enumValue(note.status, notificationStatuses, "logged"),
    payload: note.payload ?? "", errorMessage: note.errorMessage ?? "", createdAt: dateOrNow(note.createdAt), sentAt: dateOrNull(note.sentAt)
  };
}

function sessionData(session) {
  return {
    id: session.id, tokenHash: session.tokenHash, csrfToken: session.csrfToken, userId: session.userId,
    authVersion: Number(session.authVersion) || 1, expiresAt: dateOrNow(session.expiresAt),
    createdAt: dateOrNow(session.createdAt), lastSeenAt: dateOrNow(session.lastSeenAt)
  };
}

function passwordResetTokenData(token) {
  return {
    id: token.id, tokenHash: token.tokenHash, userId: token.userId, expiresAt: dateOrNow(token.expiresAt),
    usedAt: dateOrNull(token.usedAt), createdAt: dateOrNow(token.createdAt)
  };
}

function auditEventData(event, userIds) {
  return objectWithOptionalJson({
    id: event.id, adminUserId: userIds.has(event.adminUserId) ? event.adminUserId : null,
    adminEmail: event.adminEmail ?? "", action: event.action ?? "", createdAt: dateOrNow(event.createdAt)
  }, "details", event.details);
}

function certificateEventData(event, certificateIds, courseIds) {
  return objectWithOptionalJson({
    id: event.id, certificateId: certificateIds.has(event.certificateId) ? event.certificateId : null,
    certificateNumber: event.certificateNumber ?? "", userId: event.userId ?? "", courseId: courseIds.has(event.courseId) ? event.courseId : null,
    action: event.action ?? "", actorUserId: event.actorUserId ?? "", actorEmail: event.actorEmail ?? "system", actorRole: event.actorRole ?? "system",
    createdAt: dateOrNow(event.createdAt)
  }, "details", event.details);
}

async function deleteRecords(client, modelName, ids) {
  if (ids.length) await client[modelName].deleteMany({ where: { id: { in: ids } } });
}

export async function syncPrismaDb(previousDb, nextDb, options = {}) {
  const prisma = options.prisma ?? createPrismaClient(resolveConnectionString(options.connectionString));
  const shouldDisconnect = !options.prisma;
  const previous = flattenDb(previousDb);
  const next = flattenDb(nextDb);
  const validation = validateFlatDb(next);
  if (validation.errors.length) throw new Error(`LMS data failed database validation: ${validation.errors.join("; ")}`);

  const userIds = new Set(next.users.map((item) => item.id));
  const courseIds = new Set(next.courses.map((item) => item.id));
  const lessonIds = new Set(next.lessons.map((item) => item.id));
  const testIds = new Set(next.tests.map((item) => item.id));
  const questionIds = new Set(next.questions.map((item) => item.id));
  const assignmentIds = new Set(next.assignments.map((item) => item.id));
  const certificateIds = new Set(next.certificates.map((item) => item.id));

  try {
    await prisma.$transaction(async (tx) => {
      // Delete leaf records first so removed parent records keep referential integrity.
      await deleteRecords(tx, "session", removedIds(previous.sessions, next.sessions));
      await deleteRecords(tx, "passwordResetToken", removedIds(previous.passwordResetTokens, next.passwordResetTokens));
      await deleteRecords(tx, "certificateEvent", removedIds(previous.certificateEvents, next.certificateEvents));
      await deleteRecords(tx, "auditEvent", removedIds(previous.auditEvents, next.auditEvents));
      await deleteRecords(tx, "notification", removedIds(previous.notifications, next.notifications));
      await deleteRecords(tx, "standaloneCertificate", removedIds(previous.standaloneCertificates, next.standaloneCertificates));
      await deleteRecords(tx, "certificate", removedIds(previous.certificates, next.certificates));
      await deleteRecords(tx, "testAttempt", removedIds(previous.testAttempts, next.testAttempts));
      await deleteRecords(tx, "testOption", removedIds(previous.options, next.options));
      await deleteRecords(tx, "testQuestion", removedIds(previous.questions, next.questions));
      await deleteRecords(tx, "test", removedIds(previous.tests, next.tests));
      await deleteRecords(tx, "material", removedIds(previous.materials, next.materials));
      await deleteRecords(tx, "lesson", removedIds(previous.lessons, next.lessons));
      await deleteRecords(tx, "courseAssignment", removedIds(previous.assignments, next.assignments));
      await deleteRecords(tx, "courseApplication", removedIds(previous.applications, next.applications));

      await upsertRecords(tx, "user", changedRecords(previous.users, next.users), userData);
      await upsertRecords(tx, "course", changedRecords(previous.courses, next.courses), courseData);
      await upsertRecords(tx, "lesson", changedRecords(previous.lessons, next.lessons).filter((item) => courseIds.has(item.courseId)), lessonData);
      await upsertRecords(tx, "material", changedRecords(previous.materials, next.materials).filter((item) => lessonIds.has(item.lessonId)), materialData);
      await upsertRecords(tx, "test", changedRecords(previous.tests, next.tests).filter((item) => courseIds.has(item.courseId)), testData);
      await upsertRecords(tx, "testQuestion", changedRecords(previous.questions, next.questions).filter((item) => testIds.has(item.testId)), questionData);
      await upsertRecords(tx, "testOption", changedRecords(previous.options, next.options).filter((item) => questionIds.has(item.questionId)), optionData);
      await upsertRecords(tx, "courseApplication", changedRecords(previous.applications, next.applications), (item) => applicationData(item, courseIds));
      await upsertRecords(tx, "courseAssignment", changedRecords(previous.assignments, next.assignments).filter((item) => userIds.has(item.userId) && courseIds.has(item.courseId)), (item) => assignmentData(item, userIds));
      await upsertRecords(tx, "testAttempt", changedRecords(previous.testAttempts, next.testAttempts).filter((item) => assignmentIds.has(item.assignmentId) && testIds.has(item.testId) && userIds.has(item.userId)), testAttemptData);
      await upsertRecords(tx, "certificate", changedRecords(previous.certificates, next.certificates).filter((item) => userIds.has(item.userId) && courseIds.has(item.courseId) && assignmentIds.has(item.assignmentId)), certificateData);
      await upsertRecords(tx, "standaloneCertificate", changedRecords(previous.standaloneCertificates, next.standaloneCertificates), standaloneCertificateData);
      await upsertRecords(tx, "notification", changedRecords(previous.notifications, next.notifications), (item) => notificationData(item, userIds));
      await upsertRecords(tx, "session", changedRecords(previous.sessions, next.sessions).filter((item) => userIds.has(item.userId)), sessionData);
      await upsertRecords(tx, "passwordResetToken", changedRecords(previous.passwordResetTokens, next.passwordResetTokens).filter((item) => userIds.has(item.userId)), passwordResetTokenData);
      await upsertRecords(tx, "auditEvent", changedRecords(previous.auditEvents, next.auditEvents), (item) => auditEventData(item, userIds));
      await upsertRecords(tx, "certificateEvent", changedRecords(previous.certificateEvents, next.certificateEvents), (item) => certificateEventData(item, certificateIds, courseIds));

      if (stableRecord(previous.settings) !== stableRecord(next.settings)) {
        await tx.appSetting.upsert({ where: { key: "settings" }, update: { value: next.settings ?? {} }, create: { key: "settings", value: next.settings ?? {} } });
      }

      await deleteRecords(tx, "course", removedIds(previous.courses, next.courses));
      await deleteRecords(tx, "user", removedIds(previous.users, next.users));
    }, { maxWait: 120000, timeout: 120000 });
    return migrationSummary(next);
  } finally {
    if (shouldDisconnect) await prisma.$disconnect();
  }
}

function mapMaterial(material) {
  return compactObject({
    id: material.id,
    type: material.type,
    title: material.title,
    content: material.content,
    isRequired: material.isRequired,
    sortOrder: material.sortOrder,
    source: material.source ?? undefined
  });
}

function mapLesson(lesson) {
  return compactObject({
    id: lesson.id,
    title: lesson.title,
    description: lesson.description,
    sortOrder: lesson.sortOrder,
    isRequired: lesson.isRequired,
    status: lesson.status,
    source: lesson.source ?? undefined,
    materials: lesson.materials.map(mapMaterial)
  });
}

function mapTest(test) {
  if (!test) return null;
  return {
    id: test.id,
    title: test.title,
    description: test.description,
    attemptsLimit: test.attemptsLimit,
    passingPercent: test.passingPercent,
    timeLimitMinutes: test.timeLimitMinutes,
    showResultToUser: test.showResultToUser,
    allowRetake: test.allowRetake,
    status: test.status,
    questions: test.questions.map((question) =>
      compactObject({
        id: question.id,
        type: question.type,
        questionText: question.questionText,
        sortOrder: question.sortOrder,
        source: question.source ?? undefined,
        options: question.options.map((option) => ({
          id: option.id,
          optionText: option.optionText,
          isCorrect: option.isCorrect,
          sortOrder: option.sortOrder
        }))
      })
    )
  };
}

function mapCourse(course) {
  return compactObject({
    id: course.id,
    title: course.title,
    shortDescription: course.shortDescription,
    fullDescription: course.fullDescription,
    goals: course.goals,
    requirements: course.requirements,
    oldPrice: course.oldPrice,
    newPrice: course.newPrice,
    status: course.status,
    isSequential: course.isSequential,
    imageUrl: course.imageUrl,
    showOnHome: course.showOnHome,
    homeSortOrder: course.homeSortOrder,
    autoIssueCertificate: course.autoIssueCertificate,
    certificateTemplateHtml: course.certificateTemplateHtml,
    source: course.source ?? undefined,
    createdAt: dateTimeString(course.createdAt),
    lessons: course.lessons.map(mapLesson),
    test: mapTest(course.test)
  });
}

export async function loadPrismaDb(options = {}) {
  const prisma = options.prisma ?? createPrismaClient(resolveConnectionString(options.connectionString));
  const shouldDisconnect = !options.prisma;

  try {
    const [users, applications, courses, assignments, testAttempts, certificates, standaloneCertificates, notifications, sessions, passwordResetTokens, auditEvents, certificateEvents, settingsRecord] =
      await Promise.all([
        prisma.user.findMany({ orderBy: [{ createdAt: "asc" }, { email: "asc" }] }),
        prisma.courseApplication.findMany({ orderBy: { createdAt: "desc" } }),
        prisma.course.findMany({
          orderBy: [{ homeSortOrder: "asc" }, { title: "asc" }],
          include: {
            lessons: {
              orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
              include: {
                materials: { orderBy: [{ sortOrder: "asc" }, { title: "asc" }] }
              }
            },
            test: {
              include: {
                questions: {
                  orderBy: [{ sortOrder: "asc" }],
                  include: {
                    options: { orderBy: [{ sortOrder: "asc" }] }
                  }
                }
              }
            }
          }
        }),
        prisma.courseAssignment.findMany({ orderBy: { assignedAt: "desc" } }),
        prisma.testAttempt.findMany({ orderBy: { startedAt: "desc" } }),
        prisma.certificate.findMany({ orderBy: { issuedAt: "desc" } }),
        prisma.standaloneCertificate.findMany({ orderBy: { issuedAt: "desc" } }),
        prisma.notification.findMany({ orderBy: { createdAt: "desc" } }),
        prisma.session.findMany({ orderBy: { createdAt: "desc" } }),
        prisma.passwordResetToken.findMany({ orderBy: { createdAt: "desc" } }),
        prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" } }),
        prisma.certificateEvent.findMany({ orderBy: { createdAt: "desc" } }),
        prisma.appSetting.findUnique({ where: { key: "settings" } })
      ]);

    return {
      users: users.map((user) =>
        compactObject({
          id: user.id,
          role: user.role,
          email: user.email,
          passwordHash: user.passwordHash,
          firstNameEn: user.firstNameEn,
          lastNameEn: user.lastNameEn,
          birthDate: dateOnlyString(user.birthDate),
          company: user.company,
          position: user.position,
          phone: user.phone,
          photoUrl: user.photoUrl,
          status: user.status,
          createdById: user.createdById ?? "",
          authVersion: user.authVersion,
          mustChangePassword: Boolean(user.mustChangePassword),
          courseNotificationsEnabled: user.courseNotificationsEnabled !== false,
          source: user.source ?? undefined,
          createdAt: dateTimeString(user.createdAt)
        })
      ),
      applications: applications.map((application) => ({
        id: application.id,
        lastName: application.lastName,
        firstName: application.firstName,
        phone: application.phone,
        email: application.email,
        courseId: application.courseId ?? "",
        comment: application.comment,
        status: application.status,
        adminNote: application.adminNote,
        createdAt: dateTimeString(application.createdAt)
      })),
      courses: courses.map(mapCourse),
      assignments: assignments.map((assignment) =>
        compactObject({
          id: assignment.id,
          userId: assignment.userId,
          courseId: assignment.courseId,
          assignedById: assignment.assignedById ?? "",
          status: assignment.status,
          assignedAt: dateTimeString(assignment.assignedAt),
          startedAt: dateTimeString(assignment.startedAt),
          completedAt: dateTimeString(assignment.completedAt),
          progressPercent: assignment.progressPercent,
          materialProgress: assignment.materialProgress ?? {},
          activeTestStartedAt: dateTimeString(assignment.activeTestStartedAt),
          extraTestAttempts: assignment.extraTestAttempts,
          source: assignment.source ?? undefined
        })
      ),
      testAttempts: testAttempts.map((attempt) =>
        compactObject({
          id: attempt.id,
          assignmentId: attempt.assignmentId,
          testId: attempt.testId,
          userId: attempt.userId,
          attemptNumber: attempt.attemptNumber,
          startedAt: dateTimeString(attempt.startedAt),
          finishedAt: dateTimeString(attempt.finishedAt),
          scorePercent: attempt.scorePercent,
          status: attempt.status,
          failureReason: attempt.failureReason,
          answers: attempt.answers ?? {},
          source: attempt.source ?? undefined
        })
      ),
      certificates: certificates.map((certificate) => ({
        id: certificate.id,
        userId: certificate.userId,
        courseId: certificate.courseId,
        assignmentId: certificate.assignmentId,
        certificateNumber: certificate.certificateNumber,
        status: certificate.status,
        issuedAt: dateTimeString(certificate.issuedAt),
        expiresAt: dateTimeString(certificate.expiresAt),
        replacesCertificateId: certificate.replacesCertificateId,
        revokedAt: dateTimeString(certificate.revokedAt),
        reissuedAt: dateTimeString(certificate.reissuedAt),
        snapshotFirstName: certificate.snapshotFirstName,
        snapshotLastName: certificate.snapshotLastName,
        snapshotBirthDate: dateOnlyString(certificate.snapshotBirthDate),
        snapshotPosition: certificate.snapshotPosition,
        snapshotCompany: certificate.snapshotCompany,
        snapshotPhotoUrl: certificate.snapshotPhotoUrl,
        snapshotCourseTitle: certificate.snapshotCourseTitle,
        snapshotCertificateTemplateHtml: certificate.snapshotCertificateTemplateHtml,
        certificateHtml: certificate.certificateHtml
      })),
      standaloneCertificates: standaloneCertificates.map((certificate) => ({
        id: certificate.id,
        courseId: certificate.courseId,
        certificateNumber: certificate.certificateNumber,
        status: certificate.status,
        issuedAt: dateTimeString(certificate.issuedAt),
        expiresAt: dateTimeString(certificate.expiresAt),
        snapshotFirstName: certificate.snapshotFirstName,
        snapshotLastName: certificate.snapshotLastName,
        snapshotBirthDate: dateOnlyString(certificate.snapshotBirthDate),
        snapshotPosition: certificate.snapshotPosition,
        snapshotCompany: certificate.snapshotCompany,
        snapshotPhotoUrl: certificate.snapshotPhotoUrl,
        snapshotCourseTitle: certificate.snapshotCourseTitle,
        snapshotCertificateTemplateHtml: certificate.snapshotCertificateTemplateHtml,
        certificateHtml: certificate.certificateHtml,
        createdById: certificate.createdById,
        createdByEmail: certificate.createdByEmail,
        createdAt: dateTimeString(certificate.createdAt)
      })),
      notifications: notifications.map((note) => ({
        id: note.id,
        recipientUserId: note.recipientUserId ?? "",
        recipientEmail: note.recipientEmail,
        assignmentId: note.assignmentId ?? "",
        certificateId: note.certificateId ?? "",
        type: note.type,
        status: note.status,
        payload: note.payload,
        errorMessage: note.errorMessage,
        createdAt: dateTimeString(note.createdAt),
        sentAt: dateTimeString(note.sentAt)
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        tokenHash: session.tokenHash,
        csrfToken: session.csrfToken,
        userId: session.userId,
        authVersion: session.authVersion,
        expiresAt: dateTimeString(session.expiresAt),
        createdAt: dateTimeString(session.createdAt),
        lastSeenAt: dateTimeString(session.lastSeenAt)
      })),
      passwordResetTokens: passwordResetTokens.map((token) => ({
        id: token.id,
        tokenHash: token.tokenHash,
        userId: token.userId,
        expiresAt: dateTimeString(token.expiresAt),
        usedAt: dateTimeString(token.usedAt),
        createdAt: dateTimeString(token.createdAt)
      })),
      auditEvents: auditEvents.map((event) =>
        compactObject({
          id: event.id,
          adminUserId: event.adminUserId ?? "",
          adminEmail: event.adminEmail,
          action: event.action,
          details: event.details ?? undefined,
          createdAt: dateTimeString(event.createdAt)
        })
      ),
      certificateEvents: certificateEvents.map((event) =>
        compactObject({
          id: event.id,
          certificateId: event.certificateId ?? "",
          certificateNumber: event.certificateNumber,
          userId: event.userId,
          courseId: event.courseId ?? "",
          action: event.action,
          actorUserId: event.actorUserId,
          actorEmail: event.actorEmail,
          actorRole: event.actorRole,
          details: event.details ?? undefined,
          createdAt: dateTimeString(event.createdAt)
        })
      ),
      settings: settingsRecord?.value && typeof settingsRecord.value === "object" ? settingsRecord.value : {}
    };
  } finally {
    if (shouldDisconnect) await prisma.$disconnect();
  }
}
