import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { decodedSmtpText, startTestServer } from "../helpers/test-server.mjs";

let app;
let currentStudentEmail = "student@example.com";
let currentStudentPassword = "Student123!";

before(async () => {
  app = await startTestServer({ inProcess: true });
});

after(async () => {
  await app?.stop();
});

test("public, policy, catalogue, asset, health, and not-found routes render safely", async () => {
  for (const path of [
    "/",
    "/login",
    "/forgot-password",
    "/blog",
    "/about",
    "/contacts",
    "/terms",
    "/privacy",
    "/user-policy",
    "/apply",
    "/courses"
  ]) {
    const page = await app.request(path);
    assert.equal(page.response.status, 200, `${path} did not render`);
    assert.match(page.response.headers.get("content-type"), /text\/html/);
  }

  const course = app.readDb().courses.find((item) => item.status === "active");
  const details = await app.request(`/courses/${course.id}`);
  assert.equal(details.response.status, 200);
  assert.match(details.text, new RegExp(course.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const missingCourse = await app.request("/courses/not-a-course");
  assert.equal(missingCourse.response.status, 404);
  const missingPage = await app.request("/not-a-real-route");
  assert.equal(missingPage.response.status, 404);

  const home = await app.request("/");
  const assetPath = home.text.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
  assert.ok(assetPath);
  const asset = await app.request(assetPath);
  assert.equal(asset.response.status, 200);
  assert.equal(asset.response.headers.get("x-content-type-options"), "nosniff");
  const assetTraversal = await app.request("/assets/%2e%2e%2fdata%2fdb.json");
  assert.equal(assetTraversal.response.status, 404);

  const health = await app.request("/healthz", { method: "HEAD" });
  assert.equal(health.response.status, 200);
  assert.equal(health.body.length, 0);
});

test("password recovery uses a one-time link, rejects weak or reused tokens, and does not enumerate accounts", async () => {
  const beforeUnknown = app.readDb().notifications.length;
  const unknown = await app.postForm("/forgot-password", { email: "absent.account@example.com" });
  assert.equal(unknown.response.status, 303);
  assert.equal(unknown.response.headers.get("location"), "/forgot-password?success=1");
  assert.equal(app.readDb().notifications.length, beforeUnknown);

  const recovery = await app.postForm("/forgot-password", { email: currentStudentEmail });
  assert.equal(recovery.response.status, 303);
  await app.waitFor(() => app.smtp.messages.some((message) => /Reset your Maritime Portal password/i.test(message)));
  const recoveryMessage = [...app.smtp.messages].reverse().find((message) => /Reset your Maritime Portal password/i.test(message));
  const recoveryText = decodedSmtpText(recoveryMessage);
  const token = recoveryText.match(/reset-password\?token=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(token);

  const resetPage = await app.request(`/reset-password?token=${token}`);
  assert.equal(resetPage.response.status, 200);
  assert.match(resetPage.text, new RegExp(`name="token" value="${token}"`));

  const weak = await app.postForm("/reset-password", { token, password: "short" });
  assert.equal(weak.response.status, 303);
  assert.equal(weak.response.headers.get("location"), "/reset-password?error=invalid");

  const newPassword = "RecoveredStudent123!";
  const reset = await app.postForm("/reset-password", { token, password: newPassword });
  assert.equal(reset.response.status, 303);
  assert.equal(reset.response.headers.get("location"), "/login?notice=password_reset");
  const usedToken = app.readDb().passwordResetTokens.find((item) => item.userId === "user_student");
  assert.ok(usedToken.usedAt);

  const reuse = await app.postForm("/reset-password", { token, password: "AnotherStudent123!" });
  assert.equal(reuse.response.status, 303);
  assert.equal(reuse.response.headers.get("location"), "/reset-password?error=invalid");
  currentStudentPassword = newPassword;
  const login = await app.login(currentStudentEmail, currentStudentPassword);
  assert.ok(login.startsWith("sid="));
  await app.waitFor(() => app.readDb().notifications.some((note) => note.type === "password_changed" && note.status === "sent"));
});

test("anonymous and signed-in applications plus footer feedback create the correct personalized records", async () => {
  const course = app.readDb().courses.find((item) => item.status === "active");
  const invalid = await app.postForm("/apply", {
    courseId: "missing-course",
    firstName: "Invalid",
    lastName: "Applicant",
    email: "invalid@example.com"
  });
  assert.equal(invalid.response.status, 303);
  assert.equal(invalid.response.headers.get("location"), "/apply");

  const anonymous = await app.postForm("/apply", {
    courseId: course.id,
    firstName: "Ada",
    lastName: "Applicant",
    email: "ada.applicant@example.com",
    phone: "+10000000991",
    comment: "Anonymous request"
  });
  assert.equal(anonymous.response.status, 303);
  assert.equal(anonymous.response.headers.get("location"), "/apply?success=1");
  let db = app.readDb();
  const anonymousApplication = db.applications.find((item) => item.email === "ada.applicant@example.com");
  assert.equal(anonymousApplication.courseId, course.id);
  assert.equal(anonymousApplication.status, "new");
  assert.ok(db.notifications.some((note) => note.type === "new_application" && note.payload.includes("Ada Applicant")));

  const studentCookie = await app.login(currentStudentEmail, currentStudentPassword);
  await app.cacheCsrf("/apply", studentCookie);
  const signedIn = await app.postForm("/apply", { courseId: course.id, comment: "Existing student request" }, studentCookie);
  assert.equal(signedIn.response.status, 303);
  db = app.readDb();
  const studentApplication = db.applications.find((item) => item.comment === "Existing student request");
  assert.equal(studentApplication.email, currentStudentEmail);
  assert.equal(studentApplication.firstName, "Alex");
  assert.ok(db.notifications.some((note) => note.type === "new_application" && note.payload.includes("Student course request")));

  const notesBeforeIncomplete = db.notifications.length;
  const incompleteFeedback = await app.postForm("/feedback", { name: "No message" });
  assert.equal(incompleteFeedback.response.status, 303);
  assert.equal(app.readDb().notifications.length, notesBeforeIncomplete);

  const feedback = await app.postForm("/feedback", {
    name: "Feedback Sender",
    email: "feedback@example.com",
    subject: "Training question",
    message: "Please contact me."
  });
  assert.equal(feedback.response.status, 303);
  assert.equal(feedback.response.headers.get("location"), "/?feedback=1");
  assert.ok(app.readDb().notifications.some((note) => note.type === "feedback_message" && note.payload.includes("Training question")));
});

test("student profile validation, profile update, and password change invalidate the old session correctly", async () => {
  const studentCookie = await app.login(currentStudentEmail, currentStudentPassword);
  await app.cacheCsrf("/dashboard/profile", studentCookie);

  const duplicate = await app.postForm(
    "/dashboard/profile/update",
    {
      lastNameEn: "Student",
      firstNameEn: "Alex",
      birthDate: "1995-02-03",
      email: "admin@example.com",
      position: "Deck Officer",
      company: "Updated Shipping"
    },
    studentCookie
  );
  assert.equal(duplicate.response.status, 400);
  assert.match(duplicate.text, /already used by another user/i);

  const updated = await app.postForm(
    "/dashboard/profile/update",
    {
      lastNameEn: "Navigator",
      firstNameEn: "Alex",
      birthDate: "1995-02-03",
      email: "student.updated@example.com",
      position: "Chief Mate",
      company: "Updated Shipping"
    },
    studentCookie
  );
  assert.equal(updated.response.status, 303);
  const student = app.readDb().users.find((item) => item.id === "user_student");
  assert.equal(student.email, "student.updated@example.com");
  assert.equal(student.lastNameEn, "Navigator");
  assert.equal(student.company, "Updated Shipping");
  currentStudentEmail = student.email;

  const wrongPassword = await app.postForm(
    "/dashboard/profile/password",
    { currentPassword: "WrongPassword123!", newPassword: "UpdatedStudent123!" },
    studentCookie
  );
  assert.equal(wrongPassword.response.status, 400);

  const changed = await app.postForm(
    "/dashboard/profile/password",
    { currentPassword: currentStudentPassword, newPassword: "UpdatedStudent123!" },
    studentCookie
  );
  assert.equal(changed.response.status, 303);
  assert.equal(changed.response.headers.get("location"), "/login?notice=password_changed");
  currentStudentPassword = "UpdatedStudent123!";
  const stale = await app.request("/dashboard", { headers: { cookie: studentCookie } });
  assert.equal(stale.response.status, 303);
  const freshCookie = await app.login(currentStudentEmail, currentStudentPassword);
  assert.ok(freshCookie.startsWith("sid="));
});
