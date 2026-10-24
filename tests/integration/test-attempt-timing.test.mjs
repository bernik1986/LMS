import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { startTestServer } from "../helpers/test-server.mjs";

let app;
let adminCookie;
let studentCookie;

before(async () => {
  app = await startTestServer({
    inProcess: true,
    env: { TEST_SUBMISSION_GRACE_MS: "25" }
  });
  adminCookie = await app.login("admin@example.com", "Admin123!");
  studentCookie = await app.login("student@example.com", "Student123!");
  await app.cacheCsrf("/admin/courses/course_maritime_safety", adminCookie);
  await app.cacheCsrf("/dashboard/courses/assign_demo", studentCookie);

  for (const materialId of ["material_intro_text", "material_intro_video", "material_emergency_text"]) {
    const completed = await app.postForm(
      "/dashboard/materials/complete",
      { assignmentId: "assign_demo", materialId },
      studentCookie
    );
    assert.equal(completed.response.status, 303);
  }
});

after(async () => {
  await app?.stop();
});

async function updateTestTimeLimit(minutes) {
  const update = await app.postForm(
    "/admin/courses/course_maritime_safety/test/settings",
    {
      title: "Safety final test",
      attemptsLimit: "3",
      passingPercent: "80",
      timeLimitMinutes: String(minutes),
      status: "active",
      showResultToUser: "on",
      allowRetake: "on"
    },
    adminCookie
  );
  assert.equal(update.response.status, 303);
}

async function submitCorrectAnswers() {
  return app.postForm(
    "/dashboard/tests/assign_demo",
    { q_test_access: "q1_o2", q_alarm: "q2_o1" },
    studentCookie
  );
}

test("an above-pass-mark result is identified as expired and the reason is visible", async () => {
  await updateTestTimeLimit(0.001);
  const testPage = await app.request("/dashboard/tests/assign_demo", {
    headers: { cookie: studentCookie }
  });
  assert.equal(testPage.response.status, 200);
  assert.match(testPage.text, /data-test-countdown/);
  assert.match(testPage.text, /data-test-deadline-at="\d+"/);
  assert.match(testPage.text, /Time expired\. Submitting the attempt/);

  await delay(140);
  const submitted = await submitCorrectAnswers();
  assert.equal(submitted.response.status, 303);

  let database = app.readDb();
  const expiredAttempt = database.testAttempts.find(
    (attempt) => attempt.assignmentId === "assign_demo" && attempt.attemptNumber === 1
  );
  assert.equal(expiredAttempt.scorePercent, 100);
  assert.equal(expiredAttempt.status, "expired");
  assert.equal(expiredAttempt.failureReason, "time_expired");
  assert.equal(database.assignments.find((assignment) => assignment.id === "assign_demo").status, "test_failed");

  const coursePage = await app.request("/dashboard/courses/assign_demo", {
    headers: { cookie: studentCookie }
  });
  assert.match(coursePage.text, /Time expired/);
  assert.match(coursePage.text, /score was recorded, but this attempt could not be accepted/i);

  const adminReport = await app.request("/admin/tests?status=expired", {
    headers: { cookie: adminCookie }
  });
  assert.equal(adminReport.response.status, 200);
  assert.match(adminReport.text, /Time expired/);

  await updateTestTimeLimit(1);
  const retakePage = await app.request("/dashboard/tests/assign_demo", {
    headers: { cookie: studentCookie }
  });
  assert.equal(retakePage.response.status, 200);
  const retake = await submitCorrectAnswers();
  assert.equal(retake.response.status, 303);

  database = app.readDb();
  const passedAttempt = database.testAttempts.find(
    (attempt) => attempt.assignmentId === "assign_demo" && attempt.attemptNumber === 2
  );
  assert.equal(passedAttempt.scorePercent, 100);
  assert.equal(passedAttempt.status, "passed");
  assert.equal(database.assignments.find((assignment) => assignment.id === "assign_demo").status, "completed");
});
