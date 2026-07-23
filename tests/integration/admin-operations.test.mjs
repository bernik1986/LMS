import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test, { after, before } from "node:test";
import sharp from "sharp";
import {
  decodedSmtpText,
  smtpAttachmentNames,
  startTestServer
} from "../helpers/test-server.mjs";

let app;
let adminCookie;

before(async () => {
  app = await startTestServer({ inProcess: true });
  adminCookie = await app.login("admin@example.com", "Admin123!");
  await app.cacheCsrf("/admin", adminCookie);
});

after(async () => {
  await app?.stop();
});

test("administrator screens and spreadsheet or CSV exports are reachable and filtered safely", async () => {
  const db = app.readDb();
  const student = db.users.find((user) => user.role === "student");
  const course = db.courses[0];
  for (const path of [
    "/admin",
    "/admin/applications",
    "/admin/users",
    `/admin/users/${student.id}`,
    "/admin/reports",
    "/admin/checks",
    "/admin/checks/template",
    "/admin/tests",
    "/admin/courses",
    "/admin/courses/new",
    "/admin/courses/merge",
    `/admin/courses/${course.id}`,
    `/admin/courses/${course.id}/test/preview`,
    `/admin/courses/${course.id}/certificate-template/preview`,
    "/admin/course-prices",
    "/admin/homepage",
    "/admin/files",
    "/admin/certificates",
    "/admin/notifications",
    "/admin/audit"
  ]) {
    const page = await app.request(path, { headers: { cookie: adminCookie } });
    assert.equal(page.response.status, 200, `${path} did not render`);
    assert.match(page.response.headers.get("content-type"), /text\/html|application\/json/);
  }

  const exports = [
    ["/admin/files/import-report.csv", /text\/csv/],
    ["/admin/certificates/export.csv?status=issued", /text\/csv/],
    ["/admin/certificates/export.xls?status=issued", /excel/],
    ["/admin/course-prices/export.xls?q=Maritime", /excel/],
    ["/admin/checks/export.xls", /excel/]
  ];
  for (const [path, contentType] of exports) {
    const exported = await app.request(path, { headers: { cookie: adminCookie } });
    assert.equal(exported.response.status, 200, `${path} did not export`);
    assert.match(exported.response.headers.get("content-type"), contentType);
    assert.ok(exported.body.length > 20);
  }

  const filteredReport = await app.request(
    `/admin/reports?userId=${encodeURIComponent(student.id)}&courseId=${encodeURIComponent(course.id)}&status=not_started`,
    { headers: { cookie: adminCookie } }
  );
  assert.equal(filteredReport.response.status, 200);
  assert.match(filteredReport.text, new RegExp(student.email.replace(".", "\\.")));
});

test("homepage selection, editable policy content, course prices, and certificate automation settings persist", async () => {
  const [firstCourse, secondCourse] = app.readDb().courses;
  const homepage = await app.postForm(
    "/admin/homepage/courses",
    {
      showOnHome: [secondCourse.id, firstCourse.id],
      [`homeSortOrder:${firstCourse.id}`]: "2",
      [`homeSortOrder:${secondCourse.id}`]: "1"
    },
    adminCookie
  );
  assert.equal(homepage.response.status, 303);
  let db = app.readDb();
  assert.equal(db.settings.homepageCourseSelectionEnabled, true);
  assert.equal(db.courses.find((course) => course.id === firstCourse.id).showOnHome, true);
  assert.equal(db.courses.find((course) => course.id === secondCourse.id).homeSortOrder, 1);
  assert.ok(db.courses.slice(2).every((course) => course.showOnHome === false));

  const footer = await app.postForm(
    "/admin/homepage/footer",
    {
      policiesTitle: "Training policies",
      termsLabel: "Training terms",
      termsUrl: "/terms",
      termsContent: "Custom terms line one.\nCustom terms line two.",
      privacyLabel: "Privacy notice",
      privacyUrl: "/privacy",
      privacyContent: "Custom privacy policy.",
      userPolicyLabel: "Learner policy",
      userPolicyUrl: "/user-policy",
      userPolicyContent: "Custom learner policy.",
      feedbackTitle: "Contact our training team",
      namePlaceholder: "Full name",
      emailPlaceholder: "Email address",
      subjectPlaceholder: "Message subject",
      messagePlaceholder: "Your question",
      submitLabel: "Send enquiry"
    },
    adminCookie
  );
  assert.equal(footer.response.status, 303);
  db = app.readDb();
  assert.equal(db.settings.homeFooter.termsContent, "Custom terms line one.\nCustom terms line two.");
  assert.equal(db.settings.homeFooter.submitLabel, "Send enquiry");

  const home = await app.request("/");
  assert.match(home.text, /Training policies/);
  assert.match(home.text, /Contact our training team/);
  assert.match(home.text, /Send enquiry/);
  const terms = await app.request("/terms");
  assert.equal(terms.response.status, 200);
  assert.match(terms.text, /Custom terms line one/);
  assert.match(terms.text, /Custom terms line two/);

  const disableAutomaticCertificate = await app.postForm(
    "/admin/course-prices/update",
    {
      returnTo: "/admin/course-prices",
      [`oldPrice:${firstCourse.id}`]: "350",
      [`newPrice:${firstCourse.id}`]: "275",
      [`certificateSetting:${firstCourse.id}`]: "on"
    },
    adminCookie
  );
  assert.equal(disableAutomaticCertificate.response.status, 303);
  let savedCourse = app.readDb().courses.find((course) => course.id === firstCourse.id);
  assert.equal(savedCourse.oldPrice, "350 USD");
  assert.equal(savedCourse.newPrice, "275 USD");
  assert.equal(savedCourse.autoIssueCertificate, false);

  const enableAutomaticCertificate = await app.postForm(
    "/admin/course-prices/update",
    {
      [`oldPrice:${firstCourse.id}`]: "350 USD",
      [`newPrice:${firstCourse.id}`]: "275 USD",
      [`certificateSetting:${firstCourse.id}`]: "on",
      [`autoIssueCertificate:${firstCourse.id}`]: "on"
    },
    adminCookie
  );
  assert.equal(enableAutomaticCertificate.response.status, 303);
  savedCourse = app.readDb().courses.find((course) => course.id === firstCourse.id);
  assert.equal(savedCourse.autoIssueCertificate, true);
});

test("applications can be reviewed and converted into a student with credentials, assignment, audit entry, and deferred course notice", async () => {
  const course = app.readDb().courses.find((item) => item.status === "active");
  const email = "converted.application@example.com";
  const apply = await app.postForm("/apply", {
    courseId: course.id,
    firstName: "Connie",
    lastName: "Converted",
    email,
    phone: "+10000000777",
    comment: "Please enrol me"
  });
  assert.equal(apply.response.status, 303);

  let db = app.readDb();
  const application = db.applications.find((item) => item.email === email);
  assert.ok(application);
  const status = await app.postForm(
    "/admin/applications/status",
    { id: application.id, status: "contacted" },
    adminCookie
  );
  assert.equal(status.response.status, 303);
  assert.equal(app.readDb().applications.find((item) => item.id === application.id).status, "contacted");

  const messagesBefore = app.smtp.messages.length;
  const convert = await app.postForm(
    "/admin/applications/convert",
    { id: application.id },
    adminCookie
  );
  assert.equal(convert.response.status, 303);
  assert.equal(app.smtp.messages.length, messagesBefore + 1);
  db = app.readDb();
  const student = db.users.find((user) => user.email === email);
  assert.ok(student);
  assert.equal(student.firstNameEn, "Connie");
  assert.equal(student.courseNotificationsEnabled, false);
  const assignment = db.assignments.find(
    (item) => item.userId === student.id && item.courseId === course.id
  );
  assert.ok(assignment);
  assert.equal(db.applications.find((item) => item.id === application.id).status, "converted_to_user");
  assert.equal(
    db.notifications.find((note) => note.assignmentId === assignment.id && note.type === "course_assigned").status,
    "deferred"
  );
  const credentialsEmail = decodedSmtpText(app.smtp.messages.at(-1));
  assert.match(credentialsEmail, /Welcome to Maritime Portal/i);
  assert.match(credentialsEmail, /converted\.application@example\.com/);

  const detail = await app.request(`/admin/users/${student.id}`, {
    headers: { cookie: adminCookie }
  });
  assert.equal(detail.response.status, 200);
  assert.match(detail.text, /Connie Converted/);

  db = app.readDb();
  const audit = [...db.auditEvents].reverse().find((event) => event.action === "/admin/applications/convert");
  assert.ok(audit);
  const auditDetail = await app.request(`/admin/audit/${audit.id}`, {
    headers: { cookie: adminCookie }
  });
  assert.equal(auditDetail.response.status, 200);
  assert.match(auditDetail.text, /Technical details/);
  const missingAudit = await app.request("/admin/audit/not-an-event", {
    headers: { cookie: adminCookie }
  });
  assert.equal(missingAudit.response.status, 404);
});

test("student administration, assignment controls, certificate lifecycle, exports, and permanent cascade deletion work together", async () => {
  const photo = await sharp({
    create: {
      width: 480,
      height: 640,
      channels: 3,
      background: { r: 24, g: 91, b: 126 }
    }
  }).jpeg().toBuffer();
  const password = "CertificateUser123!";
  const email = "certificate.lifecycle@example.com";
  const create = await app.postMultipart(
    "/admin/users/create",
    {
      role: "student",
      email,
      password,
      firstNameEn: "Celia",
      lastNameEn: "Certificate",
      birthDate: "1990-08-09",
      position: "Chief Mate",
      company: "Certificate Shipping",
      phone: "+10000000666"
    },
    {
      photo: {
        name: "celia.jpg",
        type: "image/jpeg",
        buffer: photo
      }
    },
    adminCookie
  );
  assert.equal(create.response.status, 303);

  let db = app.readDb();
  let student = db.users.find((user) => user.email === email);
  assert.ok(student);
  const photoPath = `${app.uploadsDir}/${student.photoUrl.slice("/uploads/".length)}`;
  assert.ok(existsSync(photoPath));

  const studentCookie = await app.login(email, password);
  await app.cacheCsrf("/dashboard", studentCookie);
  const toggleOff = await app.postForm("/admin/users/toggle", { id: student.id }, adminCookie);
  assert.equal(toggleOff.response.status, 303);
  assert.equal(app.readDb().users.find((user) => user.id === student.id).status, "inactive");
  const stale = await app.request("/dashboard", { headers: { cookie: studentCookie } });
  assert.equal(stale.response.status, 303);
  const toggleOn = await app.postForm("/admin/users/toggle", { id: student.id }, adminCookie);
  assert.equal(toggleOn.response.status, 303);
  assert.equal(app.readDb().users.find((user) => user.id === student.id).status, "active");

  const update = await app.postForm(
    "/admin/users/update",
    {
      id: student.id,
      email,
      firstNameEn: "Celia",
      lastNameEn: "Certificate-Updated",
      birthDate: "1990-08-09",
      position: "Master",
      company: "Updated Certificate Shipping",
      phone: "+10000000667"
    },
    adminCookie
  );
  assert.equal(update.response.status, 303);
  student = app.readDb().users.find((user) => user.id === student.id);
  assert.equal(student.lastNameEn, "Certificate-Updated");

  const extraAssignment = await app.postForm(
    "/admin/assignments/create",
    { userId: student.id, courseId: "course_maritime_safety" },
    adminCookie
  );
  assert.equal(extraAssignment.response.status, 303);
  let assignment = app.readDb().assignments.find(
    (item) => item.userId === student.id && item.courseId === "course_maritime_safety"
  );
  assert.ok(assignment);
  const unlock = await app.postForm(
    `/admin/assignments/${assignment.id}/unlock-test`,
    { returnTo: `/admin/users/${student.id}` },
    adminCookie
  );
  assert.equal(unlock.response.status, 303);
  assert.equal(app.readDb().assignments.find((item) => item.id === assignment.id).extraTestAttempts, 1);
  const reset = await app.postForm(
    `/admin/assignments/${assignment.id}/reset-attempts`,
    { returnTo: `/admin/users/${student.id}` },
    adminCookie
  );
  assert.equal(reset.response.status, 303);
  assert.equal(app.readDb().assignments.find((item) => item.id === assignment.id).extraTestAttempts, 0);
  const removeAssignment = await app.postForm(
    `/admin/assignments/${assignment.id}/delete`,
    {},
    adminCookie
  );
  assert.equal(removeAssignment.response.status, 303);
  assert.ok(!app.readDb().assignments.some((item) => item.id === assignment.id));

  const issue = await app.postForm(
    "/admin/certificates/issue-manual",
    {
      userId: student.id,
      courseId: "course_first_aid",
      issuedAt: "2026-07-15"
    },
    adminCookie
  );
  assert.equal(issue.response.status, 303);
  await app.waitFor(
    () => app.readDb().certificates.some((certificate) => certificate.userId === student.id),
    "Certificate was not issued."
  );
  db = app.readDb();
  const firstCertificate = db.certificates.find((certificate) => certificate.userId === student.id);
  assert.equal(firstCertificate.status, "issued");
  await app.waitFor(
    () => app.smtp.messages.some((message) => decodedSmtpText(message).includes(firstCertificate.certificateNumber)),
    "Certificate email was not delivered."
  );
  const firstCertificateEmail = app.smtp.messages
    .map((message) => ({ raw: message, decoded: decodedSmtpText(message) }))
    .find((message) => message.decoded.includes(firstCertificate.certificateNumber));
  assert.ok(firstCertificateEmail);
  assert.ok(smtpAttachmentNames(firstCertificateEmail.raw).some((name) => name.endsWith(".pdf")));

  const resendMessagesBefore = app.smtp.messages.length;
  const resend = await app.postForm(
    "/admin/certificates/resend",
    { id: firstCertificate.id, returnTo: `/admin/certificates?userId=${student.id}` },
    adminCookie
  );
  assert.equal(resend.response.status, 303);
  await app.waitFor(() => app.smtp.messages.length === resendMessagesBefore + 1);
  assert.ok(app.readDb().certificateEvents.some(
    (event) => event.certificateId === firstCertificate.id && event.action === "resent"
  ));

  const revoke = await app.postForm(
    "/admin/certificates/revoke",
    { id: firstCertificate.id, returnTo: `/admin/certificates?userId=${student.id}` },
    adminCookie
  );
  assert.equal(revoke.response.status, 303);
  assert.equal(app.readDb().certificates.find((item) => item.id === firstCertificate.id).status, "revoked");
  const revokedVerification = await app.request(
    `/verify/${encodeURIComponent(firstCertificate.certificateNumber)}`
  );
  assert.equal(revokedVerification.response.status, 200);
  assert.match(revokedVerification.text, /not valid/i);

  const reissue = await app.postForm(
    "/admin/certificates/reissue",
    { id: firstCertificate.id, returnTo: `/admin/certificates?userId=${student.id}` },
    adminCookie
  );
  assert.equal(reissue.response.status, 303);
  await app.waitFor(
    () => app.readDb().certificates.filter((certificate) => certificate.userId === student.id).length === 2,
    "Replacement certificate was not issued."
  );
  db = app.readDb();
  const replacement = db.certificates.find((certificate) => certificate.replacesCertificateId === firstCertificate.id);
  assert.ok(replacement);
  assert.equal(replacement.status, "issued");
  assert.notEqual(replacement.certificateNumber, firstCertificate.certificateNumber);

  const certificateCsv = await app.request(
    `/admin/certificates/export.csv?userId=${student.id}`,
    { headers: { cookie: adminCookie } }
  );
  assert.equal(certificateCsv.response.status, 200);
  assert.match(certificateCsv.text, new RegExp(replacement.certificateNumber.replaceAll("/", "\\/")));
  assert.match(certificateCsv.text, /Certificate-Updated/);

  const deleteProtectedAssignment = await app.postForm(
    `/admin/assignments/${replacement.assignmentId}/delete`,
    {},
    adminCookie
  );
  assert.equal(deleteProtectedAssignment.response.status, 303);
  assert.ok(app.readDb().assignments.some((item) => item.id === replacement.assignmentId));

  const invalidPurge = await app.postForm(
    "/admin/users/purge",
    { id: student.id, confirmPermanentDelete: "no" },
    adminCookie
  );
  assert.equal(invalidPurge.response.status, 303);
  assert.equal(invalidPurge.response.headers.get("location"), "/admin/users?purgeError=1");
  assert.ok(app.readDb().users.some((user) => user.id === student.id));

  const purge = await app.postForm(
    "/admin/users/purge",
    { id: student.id, confirmPermanentDelete: "delete" },
    adminCookie
  );
  assert.equal(purge.response.status, 303);
  assert.equal(purge.response.headers.get("location"), "/admin/users?purged=1");
  db = app.readDb();
  assert.ok(!db.users.some((user) => user.id === student.id));
  assert.ok(!db.assignments.some((item) => item.userId === student.id));
  assert.ok(!db.certificates.some((certificate) => certificate.userId === student.id));
  assert.ok(!db.notifications.some((note) => note.recipientUserId === student.id));
  assert.ok(!db.sessions.some((session) => session.userId === student.id));
  assert.equal(existsSync(photoPath), false);

  const createAudit = [...db.auditEvents].reverse().find((event) => event.action === "/admin/users/create");
  assert.ok(createAudit);
  assert.ok(!JSON.stringify(createAudit.details).includes(password));
});
