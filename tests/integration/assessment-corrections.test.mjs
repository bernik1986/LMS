import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "../helpers/test-server.mjs";

test("offline correction uses normal certificate issuance, audit, notification and idempotency", async () => {
  const root = mkdtempSync(join(tmpdir(), "lms-correction-"));
  const env = { NODE_ENV: "test", LMS_STORAGE: "json", LMS_DB_PATH: join(root, "db.json"), LMS_UPLOADS_DIR: join(root, "uploads"), LMS_CLI_MODE: "true", LMS_MAINTENANCE_CONFIRMED: "true", LMS_ASSESSMENT_MAINTENANCE: "true", SMTP_HOST: "", PUBLIC_BASE_URL: "https://example.test" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    await import(`../../scripts/lms-server.mjs?seed=${Date.now()}`);
    const seed = JSON.parse(readFileSync(env.LMS_DB_PATH, "utf8"));
    for (const policy of ["automatic", "manual", "approved_manual", "no_photo", "existing", "inactive", "incomplete"]) {
      const db = structuredClone(seed);
      const course = db.courses.find((c) => c.id === "course_maritime_safety");
      const assignment = db.assignments.find((a) => a.id === "assign_demo");
      const user = db.users.find((u) => u.id === assignment.userId);
      user.photoUrl = policy === "no_photo" ? "" : "/uploads/test-photo.png";
      course.autoIssueCertificate = !["manual", "approved_manual"].includes(policy);
      user.status = policy === "inactive" ? "inactive" : "active";
      assignment.materialProgress = Object.fromEntries(course.lessons.flatMap((lesson) => lesson.materials).map((material) => [material.id, { status: policy === "incomplete" ? "not_started" : "completed" }]));
      for (const question of course.test.questions) question.type ??= "single_choice";
      const q = course.test.questions[0];
      const oldOptions = q.options.map(({ id, optionText, isCorrect }) => ({ id, optionText, isCorrect }));
      const correct = q.options.find((o) => !o.isCorrect);
      const plan = { version: "correction-test", sha256: "fixture", corrections: [{ courseId: course.id, questionId: q.id, oldQuestionText: q.questionText, oldType: q.type, oldOptions, newOptions: oldOptions.map((o) => ({ ...o, isCorrect: o.id === correct.id })), retrospective: "rekey" }] };
      const finishedAt = new Date().toISOString();
      db.testAttempts = [{ id: "correction_attempt", assignmentId: assignment.id, testId: course.test.id, userId: user.id, attemptNumber: 1, startedAt: finishedAt, finishedAt, scorePercent: 50, status: "failed", failureReason: "", answers: course.test.questions.map((question) => ({ questionId: question.id, selectedOptionIds: [question.id === q.id ? correct.id : question.options.find((o) => o.isCorrect).id], isCorrect: question.id !== q.id })) }];
      db.certificates = policy === "existing" ? [{ id: "existing_certificate", assignmentId: assignment.id, status: "issued" }] : [];
      writeFileSync(env.LMS_DB_PATH, JSON.stringify(db));
      const beforeImport = readFileSync(env.LMS_DB_PATH, "utf8");
      const module = await import(`../../scripts/lms-server.mjs?policy=${policy}-${Date.now()}`);
      assert.equal(readFileSync(env.LMS_DB_PATH, "utf8"), beforeImport, "maintenance import must not persist normalization before validation");
      const report = await module.applyAssessmentCorrectionMaintenance(plan, { asOf: finishedAt, approvedManualAssignmentIds: policy === "approved_manual" ? [assignment.id] : [] });
      const persisted = JSON.parse(readFileSync(env.LMS_DB_PATH, "utf8"));
      assert.equal(persisted.testAttempts[0].status, "passed");
      assert.equal(persisted.assignments.find((a) => a.id === assignment.id).status, "completed");
      assert.equal(report.certificates[0].outcome, { automatic: "issued", approved_manual: "issued", manual: "manual_approval_required", no_photo: "photo_required", existing: "already_issued", inactive: "user_inactive", incomplete: "materials_incomplete" }[policy]);
      assert.equal(persisted.certificates.length, ["automatic", "approved_manual", "existing"].includes(policy) ? 1 : 0);
      if (policy === "automatic") {
        const certificate = persisted.certificates[0];
        assert.ok(certificate.certificateHtml);
        assert.equal(certificate.snapshotCourseTitle, course.title);
        assert.ok(persisted.notifications.some((n) => n.certificateId === certificate.id && n.type === "certificate_available"));
        assert.ok(persisted.certificateEvents.some((e) => e.certificateId === certificate.id && e.action === "assessment_correction"));
      }
      const repeated = await module.applyAssessmentCorrectionMaintenance(plan, { asOf: finishedAt });
      assert.equal(repeated.alreadyApplied, true);
      assert.deepEqual(JSON.parse(readFileSync(env.LMS_DB_PATH, "utf8")), persisted);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("an obsolete assessment page is rejected without consuming an attempt or recording a failure", async () => {
  const app = await startTestServer({ inProcess: true });
  try {
    const adminCookie = await app.login("admin@example.com", "Admin123!");
    const studentCookie = await app.login("student@example.com", "Student123!");
    await app.cacheCsrf("/admin/courses/course_maritime_safety", adminCookie);
    await app.cacheCsrf("/dashboard/courses/assign_demo", studentCookie);
    for (const materialId of ["material_intro_text", "material_intro_video", "material_emergency_text"]) await app.postForm("/dashboard/materials/complete", { assignmentId: "assign_demo", materialId }, studentCookie);
    await app.postForm("/admin/courses/course_maritime_safety/test/settings", { title: "Safety final test", attemptsLimit: "3", passingPercent: "70", timeLimitMinutes: "60", status: "active", showResultToUser: "on", allowRetake: "on" }, adminCookie);
    const page = await app.request("/dashboard/tests/assign_demo", { headers: { cookie: studentCookie } });
    const version = page.text.match(/name="assessmentPaperVersion" value="([^"]+)"/)[1];
    await app.postForm("/admin/courses/course_maritime_safety/test/questions/q_test_access/update", { questionText: "Updated question", type: "single_choice", optionId1: "q1_o1", optionId2: "q1_o2", option1: "Immediately after course assignment", option2: "After completing the required materials", correct: "2" }, adminCookie);
    const rejected = await app.postForm("/dashboard/tests/assign_demo", { assessmentPaperVersion: version, q_test_access: "q1_o2", q_alarm: "q2_o1" }, studentCookie);
    assert.equal(rejected.response.status, 409);
    assert.match(rejected.text, /No attempt has been used/);
    assert.equal(app.readDb().testAttempts.length, 0);
    const refreshed = await app.request("/dashboard/tests/assign_demo", { headers: { cookie: studentCookie } });
    const newVersion = refreshed.text.match(/name="assessmentPaperVersion" value="([^"]+)"/)[1];
    assert.notEqual(version, newVersion);
    const originalRevision = app.readDb().courses.find((c) => c.id === "course_maritime_safety").test.questions[0].source.assessmentRevision;
    const originalClock = app.readDb().assignments.find((a) => a.id === "assign_demo").activeTestStartedAt;
    await app.postForm("/dashboard/tests/assign_demo", { assessmentPaperVersion: "forged-version", q_test_access: "q1_o2", q_alarm: "q2_o1" }, studentCookie);
    await app.request("/dashboard/tests/assign_demo", { headers: { cookie: studentCookie } });
    assert.equal(app.readDb().assignments.find((a) => a.id === "assign_demo").activeTestStartedAt, originalClock, "a forged paper version must not reset the clock");
    await app.postForm("/admin/courses/course_maritime_safety/test/questions/q_test_access/update", { questionText: "Updated question", type: "single_choice", optionId1: "q1_o1", optionId2: "q1_o2", option1: "Immediately after course assignment", option2: "After completing the required materials", correct: "1" }, adminCookie);
    assert.notEqual(app.readDb().courses.find((c) => c.id === "course_maritime_safety").test.questions[0].source.assessmentRevision, originalRevision);
    const keyOnlyPage = await app.request("/dashboard/tests/assign_demo", { headers: { cookie: studentCookie } });
    const keyOnlyVersion = keyOnlyPage.text.match(/name="assessmentPaperVersion" value="([^"]+)"/)[1];
    assert.notEqual(keyOnlyVersion, newVersion, "an answer-key-only edit must change the public revision without hashing the secret key");
    const passed = await app.postForm("/dashboard/tests/assign_demo", { assessmentPaperVersion: keyOnlyVersion, q_test_access: "q1_o1", q_alarm: "q2_o1" }, studentCookie);
    assert.equal(passed.response.status, 303);
    const attempt = app.readDb().testAttempts[0];
    assert.equal(attempt.status, "passed");
    assert.equal(attempt.source.assessmentPaperVersion, keyOnlyVersion);
    assert.equal(attempt.source.questionSnapshots.length, 2);
  } finally { await app.stop(); }
});
