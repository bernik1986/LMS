import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadEnvFile } from "../../scripts/env.mjs";
import {
  defaultConnectionString,
  flattenDb,
  maskedConnectionString,
  migrationSummary,
  resolveConnectionString,
  validateFlatDb
} from "../../scripts/prisma-db.mjs";

function fixtureDb() {
  return {
    users: [
      {
        id: "user_admin",
        role: "admin",
        email: "admin@example.com",
        passwordHash: "salt:hash",
        status: "active"
      },
      {
        id: "user_student",
        role: "student",
        email: "student@example.com",
        passwordHash: "salt:hash",
        status: "active"
      }
    ],
    applications: [],
    courses: [
      {
        id: "course_one",
        title: "Course one",
        lessons: [
          {
            id: "lesson_one",
            title: "Lesson one",
            materials: [{ id: "material_one", title: "Material one", type: "text", content: "Text" }]
          }
        ],
        test: {
          id: "test_one",
          title: "Test one",
          questions: [
            {
              id: "question_one",
              questionText: "Question?",
              options: [
                { id: "option_yes", optionText: "Yes", isCorrect: true },
                { id: "option_no", optionText: "No", isCorrect: false }
              ]
            }
          ]
        }
      }
    ],
    assignments: [
      {
        id: "assignment_one",
        userId: "user_student",
        courseId: "course_one",
        assignedById: "user_admin",
        status: "in_progress"
      }
    ],
    testAttempts: [
      {
        id: "attempt_one",
        assignmentId: "assignment_one",
        testId: "test_one",
        userId: "user_student",
        attemptNumber: 1,
        status: "passed"
      }
    ],
    certificates: [
      {
        id: "certificate_one",
        certificateNumber: "725645565/01/01/2026",
        userId: "user_student",
        courseId: "course_one",
        assignmentId: "assignment_one",
        status: "issued"
      }
    ],
    standaloneCertificates: [
      {
        id: "standalone_certificate_one",
        courseId: "course_one",
        certificateNumber: "725645566/01/01/2026",
        status: "issued",
        issuedAt: "2026-01-01T12:00:00.000Z",
        expiresAt: "2031-01-01T12:00:00.000Z",
        snapshotFirstName: "Direct",
        snapshotLastName: "Candidate",
        snapshotBirthDate: "1985-05-06",
        snapshotCourseTitle: "Course one",
        snapshotCertificateTemplateHtml: "<h1>{{fullName}}</h1>",
        certificateHtml: "<h1>Direct Candidate</h1>"
      }
    ],
    notifications: [],
    sessions: [],
    passwordResetTokens: [],
    auditEvents: [],
    certificateEvents: [],
    settings: { emailTemplates: {} }
  };
}

test("connection helpers select defaults and hide passwords", () => {
  assert.equal(resolveConnectionString(""), defaultConnectionString);
  assert.equal(
    maskedConnectionString("postgresql://marine:super-secret@db.example.test:5432/lms"),
    "postgresql://marine:***@db.example.test:5432/lms"
  );
  assert.equal(maskedConnectionString("not-a-url"), "not-a-url");
});

test("flattenDb preserves relations and migrationSummary counts every model", () => {
  const flat = flattenDb(fixtureDb());
  assert.equal(flat.courses.length, 1);
  assert.deepEqual(flat.lessons.map((item) => item.courseId), ["course_one"]);
  assert.deepEqual(flat.materials.map((item) => item.lessonId), ["lesson_one"]);
  assert.deepEqual(flat.tests.map((item) => item.courseId), ["course_one"]);
  assert.deepEqual(flat.questions.map((item) => item.testId), ["test_one"]);
  assert.deepEqual(flat.options.map((item) => item.questionId), ["question_one", "question_one"]);
  assert.deepEqual(migrationSummary(flat), {
    users: 2,
    courses: 1,
    lessons: 1,
    materials: 1,
    tests: 1,
    questions: 1,
    options: 2,
    applications: 0,
    assignments: 1,
    testAttempts: 1,
    certificates: 1,
    standaloneCertificates: 1,
    notifications: 0,
    sessions: 0,
    passwordResetTokens: 0,
    auditEvents: 0,
    certificateEvents: 0,
    settings: 1
  });
});

test("validateFlatDb accepts a consistent graph", () => {
  const validation = validateFlatDb(flattenDb(fixtureDb()));
  assert.deepEqual(validation, { errors: [], warnings: [] });
});

test("validateFlatDb reports duplicates, broken required relations, and soft-reference warnings", () => {
  const db = fixtureDb();
  db.users.push({ ...db.users[1], id: "user_duplicate", email: "STUDENT@example.com" });
  db.assignments.push({
    ...db.assignments[0],
    id: "assignment_broken",
    userId: "missing_user",
    courseId: "missing_course"
  });
  db.notifications.push({
    id: "notification_orphan",
    recipientUserId: "missing_user",
    type: "course_assigned",
    status: "queued"
  });
  db.auditEvents.push({ id: "audit_orphan", adminUserId: "missing_admin" });
  db.certificateEvents.push({
    id: "event_orphan",
    certificateId: "missing_certificate",
    courseId: "missing_course"
  });
  db.standaloneCertificates[0].certificateNumber = db.certificates[0].certificateNumber;
  const validation = validateFlatDb(flattenDb(db));
  assert.ok(validation.errors.some((message) => message.includes("users.email: duplicate")));
  assert.ok(validation.errors.some((message) => message.includes("assignment_broken references a missing user or course")));
  assert.ok(validation.errors.some((message) => message.includes("allCertificates.certificateNumber: duplicate")));
  assert.ok(validation.warnings.some((message) => message.includes("notification_orphan references a missing user")));
  assert.ok(validation.warnings.some((message) => message.includes("audit_orphan references a missing admin")));
  assert.ok(validation.warnings.some((message) => message.includes("event_orphan references a missing certificate")));
});

test("loadEnvFile handles comments, quotes, protected keys, and explicit overrides", () => {
  const directory = mkdtempSync(join(tmpdir(), "marine-lms-env-test-"));
  const envPath = join(directory, ".env");
  const keys = ["LMS_TEST_PLAIN", "LMS_TEST_QUOTED", "LMS_TEST_PROTECTED"];
  try {
    writeFileSync(
      envPath,
      [
        "# comment",
        "LMS_TEST_PLAIN=value",
        "LMS_TEST_QUOTED=\"value with spaces\"",
        "LMS_TEST_PROTECTED=from-file"
      ].join("\n"),
      "utf8"
    );
    process.env.LMS_TEST_PROTECTED = "from-process";
    loadEnvFile(envPath, new Set(["LMS_TEST_PROTECTED"]));
    assert.equal(process.env.LMS_TEST_PLAIN, "value");
    assert.equal(process.env.LMS_TEST_QUOTED, "value with spaces");
    assert.equal(process.env.LMS_TEST_PROTECTED, "from-process");
    loadEnvFile(envPath, new Set(), true);
    assert.equal(process.env.LMS_TEST_PROTECTED, "from-file");
  } finally {
    for (const key of keys) delete process.env[key];
    rmSync(directory, { recursive: true, force: true });
  }
});
