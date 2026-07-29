import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { decodedSmtpText, startTestServer } from "../helpers/test-server.mjs";

let app;
let adminCookie;

before(async () => {
  app = await startTestServer({ inProcess: true });
  adminCookie = await app.login("admin@example.com", "Admin123!");
  await app.cacheCsrf("/admin/notifications", adminCookie);
});

after(async () => {
  await app?.stop();
});

test("editable email templates and the SMTP test use personalized branded content", async () => {
  const update = await app.postForm(
    "/admin/notifications/templates",
    {
      "subject:smtp_test": "SMTP check for {{firstName}}",
      "body:smtp_test": "**Delivery ready**\n\n{{payload}}\n\nOpen {{platformUrl}}"
    },
    adminCookie
  );
  assert.equal(update.response.status, 303);
  assert.equal(update.response.headers.get("location"), "/admin/notifications");

  const adminAlerts = await app.postForm(
    "/admin/notifications/admin-alerts",
    { adminActivityNotificationEmail: "bernik1986@gmail.com" },
    adminCookie
  );
  assert.equal(adminAlerts.response.status, 303);
  assert.equal(app.readDb().settings.adminActivityNotificationEmail, "bernik1986@gmail.com");

  const recipient = "smtp.preview@example.com";
  const sentBefore = app.smtp.messages.length;
  const smtpTest = await app.postForm("/admin/notifications/test-smtp", { email: recipient }, adminCookie);
  assert.equal(smtpTest.response.status, 303);
  assert.equal(app.smtp.messages.length, sentBefore + 1);

  const message = app.smtp.messages.at(-1);
  const decoded = decodedSmtpText(message);
  const admin = app.readDb().users.find((user) => user.email === "admin@example.com");
  assert.match(message, new RegExp(`Subject: SMTP check for ${admin.firstNameEn}`));
  assert.match(decoded, /Delivery ready/);
  assert.match(decoded, /SMTP test from admin panel/);
  assert.match(decoded, new RegExp(app.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(decoded, new RegExp(`Good day,\\s*<strong>${admin.firstNameEn}`, "i"));
  assert.match(decoded, /Maritime Portal Training Team/i);

  const note = app.readDb().notifications.at(-1);
  assert.equal(note.type, "smtp_test");
  assert.equal(note.recipientEmail, recipient);
  assert.equal(note.status, "sent");
});

test("registration, deferred assignment, first sign-in, and administrator password reset deliver the expected emails", async () => {
  const initialPassword = "LifecycleStudent123!";
  const email = "lifecycle.student@example.com";
  const messagesBeforeRegistration = app.smtp.messages.length;
  const create = await app.postForm(
    "/admin/users/create",
    {
      role: "student",
      email,
      password: initialPassword,
      firstNameEn: "Laura",
      lastNameEn: "Lifecycle",
      birthDate: "1993-06-15",
      position: "Deck Officer",
      company: "Lifecycle Shipping",
      phone: "+10000000881"
    },
    adminCookie
  );
  assert.equal(create.response.status, 303);
  assert.match(create.response.headers.get("location"), /^\/admin\/users\?created=/);
  assert.equal(app.smtp.messages.length, messagesBeforeRegistration + 1);

  let db = app.readDb();
  const student = db.users.find((user) => user.email === email);
  assert.ok(student);
  assert.equal(student.courseNotificationsEnabled, false);
  const registrationEmail = decodedSmtpText(app.smtp.messages.at(-1));
  assert.match(registrationEmail, /Welcome to Maritime Portal/i);
  assert.match(registrationEmail, new RegExp(email.replace(".", "\\.")));
  assert.match(registrationEmail, new RegExp(initialPassword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(registrationEmail, /Good day,\s*<strong>Laura/i);
  const registrationNote = db.notifications.find(
    (note) => note.recipientUserId === student.id && note.type === "user_registered"
  );
  assert.equal(registrationNote.status, "sent");
  assert.ok(!registrationNote.payload.includes(initialPassword));

  const assignmentMessagesBefore = app.smtp.messages.length;
  const assign = await app.postForm(
    "/admin/assignments/create",
    { userId: student.id, courseId: "course_first_aid" },
    adminCookie
  );
  assert.equal(assign.response.status, 303);
  db = app.readDb();
  const assignment = db.assignments.find(
    (item) => item.userId === student.id && item.courseId === "course_first_aid"
  );
  assert.ok(assignment);
  let assignmentNote = db.notifications.find(
    (note) => note.assignmentId === assignment.id && note.type === "course_assigned"
  );
  assert.equal(assignmentNote.status, "deferred");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(app.smtp.messages.length, assignmentMessagesBefore);

  const studentCookie = await app.login(email, initialPassword);
  assert.ok(studentCookie.startsWith("sid="));
  await app.waitFor(
    () => app.readDb().notifications.find((note) => note.id === assignmentNote.id)?.status === "sent",
    "Deferred course assignment notification was not sent after first sign-in."
  );
  assignmentNote = app.readDb().notifications.find((note) => note.id === assignmentNote.id);
  assert.equal(assignmentNote.status, "sent");
  const assignmentEmail = app.smtp.messages
    .map(decodedSmtpText)
    .find((message) => message.includes("Course assigned: First Aid"));
  assert.match(assignmentEmail, /Good day,\s*<strong>Laura/i);

  await app.waitFor(
    () => app.readDb().notifications.find(
      (note) => note.type === "student_first_login" && note.payload.includes(email)
    )?.status === "sent",
    "First student sign-in notification was not sent to the administrator."
  );
  db = app.readDb();
  const firstLoginNote = db.notifications.find(
    (note) => note.type === "student_first_login" && note.payload.includes(email)
  );
  assert.equal(firstLoginNote.recipientEmail, "bernik1986@gmail.com");
  const firstLoginEmail = app.smtp.messages
    .map(decodedSmtpText)
    .find((message) => message.includes("Student signed in to Maritime Portal for the first time"));
  assert.match(firstLoginEmail, /Laura Lifecycle/);
  assert.match(firstLoginEmail, /Good day,\s*<strong>Administrator/i);

  const firstLoginNotesBeforeSecondSignIn = db.notifications.filter(
    (note) => note.type === "student_first_login" && note.payload.includes(email)
  ).length;
  await app.login(email, initialPassword);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    app.readDb().notifications.filter(
      (note) => note.type === "student_first_login" && note.payload.includes(email)
    ).length,
    firstLoginNotesBeforeSecondSignIn
  );

  await app.cacheCsrf(`/dashboard/courses/${assignment.id}`, studentCookie);
  const completeMaterial = await app.postForm(
    "/dashboard/materials/complete",
    { assignmentId: assignment.id, materialId: "material_aid_text" },
    studentCookie
  );
  assert.equal(completeMaterial.response.status, 303);

  const failedTest = await app.postForm(
    `/dashboard/tests/${assignment.id}`,
    { q_aid_1: "q_aid_1_o2" },
    studentCookie
  );
  assert.equal(failedTest.response.status, 303);
  await app.waitFor(
    () => app.readDb().notifications.find(
      (note) => note.type === "course_test_failed" && note.assignmentId === assignment.id
    )?.status === "sent",
    "Failed final test notification was not sent to the administrator."
  );
  let testResultNote = app.readDb().notifications.find(
    (note) => note.type === "course_test_failed" && note.assignmentId === assignment.id
  );
  assert.equal(testResultNote.recipientEmail, "bernik1986@gmail.com");
  assert.match(testResultNote.payload, /Not passed - course not completed/);
  assert.match(testResultNote.payload, /Score:\*\* 0%/);

  const passedTest = await app.postForm(
    `/dashboard/tests/${assignment.id}`,
    { q_aid_1: "q_aid_1_o1" },
    studentCookie
  );
  assert.equal(passedTest.response.status, 303);
  await app.waitFor(
    () => app.readDb().notifications.find(
      (note) => note.type === "course_test_passed" && note.assignmentId === assignment.id
    )?.status === "sent",
    "Successful course completion notification was not sent to the administrator."
  );
  testResultNote = app.readDb().notifications.find(
    (note) => note.type === "course_test_passed" && note.assignmentId === assignment.id
  );
  assert.equal(testResultNote.recipientEmail, "bernik1986@gmail.com");
  assert.match(testResultNote.payload, /Passed - course completed/);
  assert.match(testResultNote.payload, /Score:\*\* 100%/);
  const testResultEmails = app.smtp.messages.map(decodedSmtpText);
  assert.ok(testResultEmails.some((message) => /Student did not pass the final test/i.test(message) && message.includes("Laura Lifecycle")));
  assert.ok(testResultEmails.some((message) => /Student successfully completed a course/i.test(message) && message.includes("Laura Lifecycle")));

  const resetPassword = "LifecycleReset123!";
  const resetMessagesBefore = app.smtp.messages.length;
  const reset = await app.postForm(
    "/admin/users/reset-password",
    { id: student.id, password: resetPassword },
    adminCookie
  );
  assert.equal(reset.response.status, 303);
  assert.equal(app.smtp.messages.length, resetMessagesBefore + 1);
  const resetEmail = decodedSmtpText(app.smtp.messages.at(-1));
  assert.match(resetEmail, /password was reset/i);
  assert.match(resetEmail, new RegExp(resetPassword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const resetNote = app.readDb().notifications.find(
    (note) => note.recipientUserId === student.id && note.type === "password_reset"
  );
  assert.equal(resetNote.status, "sent");
  assert.ok(!resetNote.payload.includes(resetPassword));

  const staleSession = await app.request("/dashboard", { headers: { cookie: studentCookie } });
  assert.equal(staleSession.response.status, 303);
  const oldLogin = await app.postForm("/login", { email, password: initialPassword });
  assert.equal(oldLogin.response.status, 401);
  const freshCookie = await app.login(email, resetPassword);
  assert.ok(freshCookie.startsWith("sid="));
});

test("failed SMTP messages remain visible and can be retried manually", async () => {
  app.smtp.state.rejectRecipients = true;
  const recipient = "retry.smtp@example.com";
  const failed = await app.postForm("/admin/notifications/test-smtp", { email: recipient }, adminCookie);
  assert.equal(failed.response.status, 303);

  let note = [...app.readDb().notifications]
    .reverse()
    .find((item) => item.type === "smtp_test" && item.recipientEmail === recipient);
  assert.equal(note.status, "failed");
  assert.match(note.errorMessage, /recipient rejected/i);

  const page = await app.request("/admin/notifications?q=retry.smtp", {
    headers: { cookie: adminCookie }
  });
  assert.equal(page.response.status, 200);
  assert.match(page.text, /retry\.smtp@example\.com/);
  assert.match(page.text, /recipient rejected/i);

  app.smtp.state.rejectRecipients = false;
  const messagesBeforeRetry = app.smtp.messages.length;
  const retry = await app.postForm("/admin/notifications/send-pending", {}, adminCookie);
  assert.equal(retry.response.status, 303);
  note = app.readDb().notifications.find((item) => item.id === note.id);
  assert.equal(note.status, "sent");
  assert.equal(app.smtp.messages.length, messagesBeforeRetry + 1);
});
