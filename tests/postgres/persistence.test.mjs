import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test, { after, before } from "node:test";
import pg from "pg";
import { applyPrismaMigrations } from "../../scripts/apply-prisma-migrations.mjs";
import { prepareAssessmentCorrection } from "../../scripts/assessment-regrade.mjs";
import {
  clearPrismaDatabase,
  createPrismaClient,
  loadPrismaDb,
  prismaDataCounts,
  replacePrismaDb,
  syncPrismaDb
} from "../../scripts/prisma-db.mjs";

const { Client } = pg;
const adminConnectionString =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
const databaseName = `marine_lms_test_${process.pid}_${Date.now()}`.toLowerCase();
const testConnectionUrl = new URL(adminConnectionString);
testConnectionUrl.pathname = `/${databaseName}`;
testConnectionUrl.search = "";
const connectionString = testConnectionUrl.toString();
let adminClient;
let prisma;

function sampleDb() {
  const createdAt = "2026-07-23T10:00:00.000Z";
  return {
    users: [
      {
        id: "pg_admin",
        role: "admin",
        email: "pg.admin@example.com",
        passwordHash: "salt:hash",
        firstNameEn: "Postgres",
        lastNameEn: "Admin",
        birthDate: "",
        company: "Maritime Portal",
        position: "Administrator",
        phone: "+10000000201",
        photoUrl: "",
        status: "active",
        createdById: "",
        authVersion: 1,
        mustChangePassword: false,
        courseNotificationsEnabled: true,
        createdAt
      },
      {
        id: "pg_student",
        role: "student",
        email: "pg.student@example.com",
        passwordHash: "salt:hash",
        firstNameEn: "Postgres",
        lastNameEn: "Student",
        birthDate: "1990-01-02",
        company: "Database Shipping",
        position: "Deck Officer",
        phone: "+10000000202",
        photoUrl: "/uploads/test/student.jpg",
        status: "active",
        createdById: "pg_admin",
        authVersion: 2,
        mustChangePassword: false,
        courseNotificationsEnabled: true,
        createdAt
      }
    ],
    applications: [
      {
        id: "pg_application",
        lastName: "Applicant",
        firstName: "Postgres",
        phone: "+10000000203",
        email: "pg.applicant@example.com",
        courseId: "pg_course",
        comment: "Test application",
        status: "new",
        adminNote: "",
        createdAt
      }
    ],
    courses: [
      {
        id: "pg_course",
        title: "PostgreSQL Persistence Course",
        shortDescription: "Persistence test",
        fullDescription: "Tests all nested production entities.",
        goals: "Verify production persistence",
        requirements: "Docker PostgreSQL",
        oldPrice: "120 USD",
        newPrice: "100 USD",
        status: "active",
        isSequential: true,
        imageUrl: "/uploads/test/course.png",
        showOnHome: true,
        homeSortOrder: 1,
        autoIssueCertificate: false,
        certificateTemplateHtml: "<h1>{{courseTitle}}</h1><p>{{fullName}}</p>",
        source: { test: true },
        createdAt,
        lessons: [
          {
            id: "pg_lesson",
            title: "Persistence lesson",
            description: "Nested lesson",
            sortOrder: 1,
            isRequired: true,
            status: "active",
            source: { test: true },
            materials: [
              {
                id: "pg_material",
                type: "text",
                title: "Persistence material",
                content: "PostgreSQL keeps this text.",
                isRequired: true,
                sortOrder: 1,
                source: { test: true }
              }
            ]
          }
        ],
        test: {
          id: "pg_test",
          title: "Persistence test",
          description: "Nested test",
          attemptsLimit: 3,
          passingPercent: 80,
          timeLimitMinutes: 15,
          showResultToUser: true,
          allowRetake: true,
          status: "active",
          questions: [
            {
              id: "pg_question",
              type: "single_choice",
              questionText: "Does the relation survive?",
              sortOrder: 1,
              source: { test: true },
              options: [
                { id: "pg_option_yes", optionText: "Yes", isCorrect: true, sortOrder: 1 },
                { id: "pg_option_no", optionText: "No", isCorrect: false, sortOrder: 2 }
              ]
            }
          ]
        }
      }
    ],
    assignments: [
      {
        id: "pg_assignment",
        userId: "pg_student",
        courseId: "pg_course",
        assignedById: "pg_admin",
        status: "completed",
        assignedAt: createdAt,
        startedAt: "2026-07-23T10:05:00.000Z",
        completedAt: "2026-07-23T10:30:00.000Z",
        progressPercent: 100,
        materialProgress: { pg_material: true },
        extraTestAttempts: 1,
        source: { test: true }
      }
    ],
    testAttempts: [
      {
        id: "pg_attempt",
        assignmentId: "pg_assignment",
        testId: "pg_test",
        userId: "pg_student",
        attemptNumber: 1,
        startedAt: "2026-07-23T10:20:00.000Z",
        finishedAt: "2026-07-23T10:25:00.000Z",
        scorePercent: 100,
        status: "passed",
        failureReason: "",
        answers: [{ questionId: "pg_question", selectedOptionId: "pg_option_yes", isCorrect: true }],
        source: { test: true }
      }
    ],
    certificates: [
      {
        id: "pg_certificate",
        userId: "pg_student",
        courseId: "pg_course",
        assignmentId: "pg_assignment",
        certificateNumber: "725645565/23/07/2026",
        status: "issued",
        issuedAt: "2026-07-23T10:30:00.000Z",
        expiresAt: "2031-07-23T10:30:00.000Z",
        replacesCertificateId: "",
        revokedAt: "",
        reissuedAt: "",
        snapshotFirstName: "Postgres",
        snapshotLastName: "Student",
        snapshotBirthDate: "1990-01-02",
        snapshotPosition: "Deck Officer",
        snapshotCompany: "Database Shipping",
        snapshotPhotoUrl: "/uploads/test/student.jpg",
        snapshotCourseTitle: "PostgreSQL Persistence Course",
        snapshotCertificateTemplateHtml: "<h1>{{courseTitle}}</h1>",
        certificateHtml: "<h1>PostgreSQL Persistence Course</h1>"
      }
    ],
    standaloneCertificates: [
      {
        id: "pg_standalone_certificate",
        courseId: "pg_course",
        certificateNumber: "725645566/23/07/2026",
        status: "issued",
        issuedAt: "2026-07-23T11:00:00.000Z",
        expiresAt: "2031-07-23T11:00:00.000Z",
        snapshotFirstName: "Direct",
        snapshotLastName: "Candidate",
        snapshotBirthDate: "1985-04-03",
        snapshotPosition: "",
        snapshotCompany: "",
        snapshotPhotoUrl: "/uploads/test/direct-candidate.jpg",
        snapshotCourseTitle: "PostgreSQL Persistence Course",
        snapshotCertificateTemplateHtml: "<h1>{{courseTitle}}</h1><p>{{fullName}}</p>",
        certificateHtml: "<h1>PostgreSQL Persistence Course</h1><p>Direct Candidate</p>",
        createdById: "pg_admin",
        createdByEmail: "pg.admin@example.com",
        createdAt: "2026-07-23T11:00:00.000Z"
      }
    ],
    notifications: [
      {
        id: "pg_notification",
        recipientUserId: "pg_student",
        recipientEmail: "pg.student@example.com",
        assignmentId: "pg_assignment",
        certificateId: "pg_certificate",
        type: "certificate_available",
        status: "sent",
        payload: "Certificate ready",
        errorMessage: "",
        createdAt,
        sentAt: "2026-07-23T10:31:00.000Z"
      }
    ],
    sessions: [
      {
        id: "pg_session",
        tokenHash: "pg-session-token-hash",
        csrfToken: "pg-csrf-token",
        userId: "pg_admin",
        authVersion: 1,
        expiresAt: "2026-07-24T10:00:00.000Z",
        createdAt,
        lastSeenAt: createdAt
      }
    ],
    passwordResetTokens: [
      {
        id: "pg_reset",
        tokenHash: "pg-reset-token-hash",
        userId: "pg_student",
        expiresAt: "2026-07-23T11:00:00.000Z",
        usedAt: "",
        createdAt
      }
    ],
    auditEvents: [
      {
        id: "pg_audit",
        adminUserId: "pg_admin",
        adminEmail: "pg.admin@example.com",
        action: "/admin/test",
        details: { test: true },
        createdAt
      }
    ],
    certificateEvents: [
      {
        id: "pg_certificate_event",
        certificateId: "pg_certificate",
        certificateNumber: "725645565/23/07/2026",
        userId: "pg_student",
        courseId: "pg_course",
        action: "issued",
        actorUserId: "pg_admin",
        actorEmail: "pg.admin@example.com",
        actorRole: "admin",
        details: { test: true },
        createdAt
      }
    ],
    settings: {
      homepageCourseSelectionEnabled: true,
      invoiceTemplate: { academyName: "Maritime Portal Test" },
      invoices: []
    }
  };
}

before(async () => {
  adminClient = new Client({ connectionString: adminConnectionString });
  try {
    await adminClient.connect();
  } catch (error) {
    throw new Error(
      `PostgreSQL test server is unavailable. Start Docker and make sure ${adminConnectionString} is reachable. ${error.message}`
    );
  }
  await adminClient.query(`CREATE DATABASE "${databaseName}"`);
});

after(async () => {
  await prisma?.$disconnect().catch(() => {});
  if (adminClient) {
    await adminClient.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName]
    ).catch(() => {});
    await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => {});
    await adminClient.end().catch(() => {});
  }
});

test("all SQL migrations apply once and checksum verification makes reruns idempotent", async () => {
  const first = await applyPrismaMigrations({
    connectionString,
    log: { log() {} }
  });
  const migrationDirectories = readdirSync(resolve("prisma/migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(first.applied, migrationDirectories);
  assert.deepEqual(first.skipped, []);

  const second = await applyPrismaMigrations({
    connectionString,
    log: { log() {} }
  });
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.skipped, migrationDirectories);

  const verifier = new Client({ connectionString });
  await verifier.connect();
  const migrationRows = await verifier.query(
    'SELECT "migration_name", "finished_at", "applied_steps_count" FROM "_prisma_migrations" ORDER BY "migration_name"'
  );
  await verifier.end();
  assert.equal(migrationRows.rowCount, migrationDirectories.length);
  assert.ok(migrationRows.rows.every((row) => row.finished_at && row.applied_steps_count === 1));
});

test("replacePrismaDb and loadPrismaDb round-trip every production entity and nested relation", async () => {
  const input = sampleDb();
  const summary = await replacePrismaDb(input, { connectionString });
  assert.equal(summary.users, 2);
  assert.equal(summary.courses, 1);
  assert.equal(summary.lessons, 1);
  assert.equal(summary.materials, 1);
  assert.equal(summary.tests, 1);
  assert.equal(summary.questions, 1);
  assert.equal(summary.options, 2);
  assert.equal(summary.assignments, 1);
  assert.equal(summary.certificates, 1);
  assert.equal(summary.standaloneCertificates, 1);

  const loaded = await loadPrismaDb({ connectionString });
  assert.equal(loaded.users.length, 2);
  assert.equal(loaded.courses.length, 1);
  assert.equal(loaded.courses[0].lessons[0].materials[0].content, "PostgreSQL keeps this text.");
  assert.equal(loaded.courses[0].test.questions[0].options.length, 2);
  assert.deepEqual(loaded.assignments[0].materialProgress, { pg_material: true });
  assert.equal(loaded.testAttempts[0].answers[0].selectedOptionId, "pg_option_yes");
  assert.equal(loaded.certificates[0].certificateNumber, "725645565/23/07/2026");
  assert.equal(loaded.standaloneCertificates[0].certificateNumber, "725645566/23/07/2026");
  assert.equal(loaded.standaloneCertificates[0].snapshotLastName, "Candidate");
  assert.equal(loaded.notifications[0].certificateId, "pg_certificate");
  assert.equal(loaded.sessions[0].csrfToken, "pg-csrf-token");
  assert.equal(loaded.passwordResetTokens[0].id, "pg_reset");
  assert.equal(loaded.auditEvents[0].details.test, true);
  assert.equal(loaded.certificateEvents[0].details.test, true);
  assert.equal(loaded.settings.invoiceTemplate.academyName, "Maritime Portal Test");
});

test("syncPrismaDb applies updates, inserts, and removals without replacing unrelated rows", async () => {
  const previous = await loadPrismaDb({ connectionString });
  const next = structuredClone(previous);
  next.courses[0].title = "PostgreSQL Persistence Course Updated";
  next.courses[0].autoIssueCertificate = true;
  next.courses[0].lessons[0].materials = [];
  next.applications.push({
    id: "pg_application_second",
    lastName: "Second",
    firstName: "Applicant",
    phone: "+10000000204",
    email: "pg.second.applicant@example.com",
    courseId: "pg_course",
    comment: "Added by sync",
    status: "contacted",
    adminNote: "Called",
    createdAt: "2026-07-23T11:00:00.000Z"
  });
  next.settings.syncMarker = randomUUID();

  const summary = await syncPrismaDb(previous, next, { connectionString });
  assert.equal(summary.courses, 1);
  assert.equal(summary.materials, 0);
  assert.equal(summary.applications, 2);

  const loaded = await loadPrismaDb({ connectionString });
  assert.equal(loaded.courses[0].title, "PostgreSQL Persistence Course Updated");
  assert.equal(loaded.courses[0].autoIssueCertificate, true);
  assert.equal(loaded.courses[0].lessons[0].materials.length, 0);
  assert.equal(loaded.applications.length, 2);
  assert.equal(loaded.settings.syncMarker, next.settings.syncMarker);
  assert.equal(loaded.users.length, 2);
  assert.equal(loaded.certificates.length, 1);
  assert.equal(loaded.standaloneCertificates.length, 1);
});

test("database uniqueness and cascade constraints protect production consistency", async () => {
  prisma = createPrismaClient(connectionString);
  await assert.rejects(
    () =>
      prisma.user.create({
        data: {
          id: "pg_duplicate_user",
          email: "pg.student@example.com",
          passwordHash: "salt:hash",
          firstNameEn: "Duplicate",
          lastNameEn: "Email"
        }
      }),
    /Unique constraint|unique constraint/i
  );

  await prisma.user.delete({ where: { id: "pg_student" } });
  const { counts } = await prismaDataCounts({ prisma });
  assert.equal(counts.users, 1);
  assert.equal(counts.assignments, 0);
  assert.equal(counts.attempts, 0);
  assert.equal(counts.certificates, 0);
  assert.equal(counts.standaloneCertificates, 1);
  assert.equal(counts.notifications, 1);
  const detachedNotification = await prisma.notification.findUnique({ where: { id: "pg_notification" } });
  assert.equal(detachedNotification.recipientUserId, null);
});

test("clearPrismaDatabase removes all mutable data while retaining a valid migrated schema", async () => {
  prisma ??= createPrismaClient(connectionString);
  await clearPrismaDatabase(prisma);
  const { counts } = await prismaDataCounts({ prisma });
  for (const [key, count] of Object.entries(counts)) {
    assert.equal(count, 0, `${key} was not cleared`);
  }
  const migrationCount = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM "_prisma_migrations"');
  assert.ok(migrationCount[0].count > 0);
});

test("assessment corrections persist atomically with original answers and unchanged certificate policy", async () => {
  const fixture = sampleDb();
  fixture.testAttempts[0].scorePercent = 0;
  fixture.testAttempts[0].status = "failed";
  fixture.testAttempts[0].answers[0] = { questionId: "pg_question", selectedOptionId: "pg_option_no", isCorrect: false };
  fixture.assignments[0].status = "test_failed";
  await replacePrismaDb(fixture, { connectionString });
  const before = await loadPrismaDb({ connectionString });
  const question = before.courses[0].test.questions[0];
  const oldOptions = question.options.map(({ id, optionText, isCorrect }) => ({ id, optionText, isCorrect }));
  const plan = { version: "pg-correction", corrections: [{ courseId: "pg_course", questionId: question.id, oldQuestionText: question.questionText, oldType: question.type, oldOptions, newOptions: oldOptions.map((o) => ({ ...o, isCorrect: !o.isCorrect })), retrospective: "rekey" }] };
  const { database: corrected, report } = prepareAssessmentCorrection(before, plan, { asOf: "2026-07-24T00:00:00Z" });
  corrected.auditEvents.push({ id: "correction_audit", action: "assessment_correction", adminEmail: "system", createdAt: "2026-07-24T00:00:00Z", details: { version: plan.version, report } });
  const invalid = structuredClone(corrected);
  invalid.auditEvents.at(-1).details.nonJsonValue = 1n;
  await assert.rejects(syncPrismaDb(before, invalid, { connectionString }), /BigInt/);
  let persisted = await loadPrismaDb({ connectionString });
  assert.equal(persisted.testAttempts[0].scorePercent, 0);
  assert.equal(persisted.courses[0].test.questions[0].options[0].isCorrect, true);
  await syncPrismaDb(before, corrected, { connectionString });
  persisted = await loadPrismaDb({ connectionString });
  assert.equal(persisted.testAttempts[0].scorePercent, 100);
  assert.equal(persisted.testAttempts[0].status, "passed");
  assert.equal(persisted.testAttempts[0].source.assessmentCorrections[0].original.scorePercent, 0);
  assert.equal(persisted.courses[0].autoIssueCertificate, false);
  assert.equal(persisted.certificates.length, 1);
  assert.equal(prepareAssessmentCorrection(persisted, plan, { asOf: "2026-07-24T00:00:00Z" }).report.alreadyApplied, true);
  await clearPrismaDatabase(prisma);
});

test("Rightship assessment migration imports the supplied answer key without overwriting an existing test", async () => {
  const sql = readFileSync(resolve("prisma/migrations/20261026130000_add_rightship_inspection_test/migration.sql"), "utf8");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO "Course" ("id", "title", "certificateTemplateHtml", "autoIssueCertificate", "updatedAt")
      VALUES ('course_0bbe1e76', 'Rightship Inspection', 'unchanged template', false, now())`);
    await client.query(`INSERT INTO "Test" ("id", "courseId", "title", "passingPercent", "timeLimitMinutes")
      VALUES ('rightship_migration_fixture', 'course_0bbe1e76', 'Final test', 80, 30)`);
    await client.query(sql);
    const settings = await client.query(`SELECT "passingPercent", "timeLimitMinutes", "attemptsLimit", "allowRetake"
      FROM "Test" WHERE "id" = 'rightship_migration_fixture'`);
    assert.deepEqual(settings.rows[0], { passingPercent: 70, timeLimitMinutes: 0, attemptsLimit: 3, allowRetake: true });
    const questions = await client.query(`SELECT q."sortOrder", count(o."id")::int AS options,
      count(o."id") FILTER (WHERE o."isCorrect")::int AS correct,
      min(o."sortOrder") FILTER (WHERE o."isCorrect") AS answer
      FROM "TestQuestion" q JOIN "TestOption" o ON o."questionId" = q."id"
      WHERE q."testId" = 'rightship_migration_fixture'
      GROUP BY q."id" ORDER BY q."sortOrder"`);
    assert.equal(questions.rows.length, 10);
    assert.equal(questions.rows.reduce((sum, q) => sum + q.options, 0), 25);
    assert(questions.rows.every((q) => q.correct === 1));
    assert.deepEqual(questions.rows.map((q) => q.answer), [3, 1, 2, 2, 1, 1, 3, 2, 2, 1]);
    const course = await client.query(`SELECT "autoIssueCertificate", "certificateTemplateHtml" FROM "Course" WHERE "id" = 'course_0bbe1e76'`);
    assert.deepEqual(course.rows[0], { autoIssueCertificate: false, certificateTemplateHtml: "unchanged template" });
    await assert.rejects(client.query(sql), /test is no longer empty/);
    await client.query("ROLLBACK");
    // A fresh database without this administrator-created course must still migrate.
    await client.query(sql);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
});
