import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import sharp from "sharp";
import { startTestServer } from "../helpers/test-server.mjs";

let app;
let adminCookie;
let adminCsrf;
let studentCookie;
let studentCsrf;

before(async () => {
  app = await startTestServer({ inProcess: true });
  adminCookie = await app.login("admin@example.com", "Admin123!");
  adminCsrf = await app.cacheCsrf("/admin", adminCookie);
  studentCookie = await app.login("student@example.com", "Student123!");
  studentCsrf = await app.cacheCsrf("/dashboard", studentCookie);
});

after(async () => {
  await app?.stop();
});

test("students cannot access administration, other students' files, assignments, or CSRF sessions", async () => {
  const photo = await sharp({
    create: {
      width: 320,
      height: 420,
      channels: 3,
      background: { r: 16, g: 77, b: 111 }
    }
  }).png().toBuffer();
  const create = await app.postMultipart(
    "/admin/users/create",
    {
      role: "student",
      email: "isolated.student@example.com",
      password: "IsolatedStudent123!",
      firstNameEn: "Isolated",
      lastNameEn: "Student",
      birthDate: "1994-04-05",
      position: "Engineer",
      company: "Isolation Shipping",
      phone: "+10000000555"
    },
    {
      photo: {
        name: "isolated.png",
        type: "image/png",
        buffer: photo
      }
    },
    adminCookie
  );
  assert.equal(create.response.status, 303);
  const isolated = app.readDb().users.find((user) => user.email === "isolated.student@example.com");
  assert.ok(isolated);

  const course = app.readDb().courses.find((item) =>
    item.lessons?.some((lesson) => lesson.materials?.some((material) => material.isRequired))
  );
  const material = course.lessons.flatMap((lesson) => lesson.materials).find((item) => item.isRequired);
  const assign = await app.postForm(
    "/admin/assignments/create",
    { userId: isolated.id, courseId: course.id },
    adminCookie
  );
  assert.equal(assign.response.status, 303);
  const isolatedAssignment = app.readDb().assignments.find(
    (item) => item.userId === isolated.id && item.courseId === course.id
  );
  assert.ok(isolatedAssignment);

  const adminPage = await app.request("/admin", { headers: { cookie: studentCookie } });
  assert.equal(adminPage.response.status, 403);
  assert.match(adminPage.text, /available only to administrators and instructors/i);
  const adminPost = await app.postForm(
    "/admin/users/create",
    {
      role: "admin",
      email: "forbidden@example.com",
      password: "ForbiddenUser123!",
      firstNameEn: "Forbidden",
      lastNameEn: "User",
      birthDate: "1990-01-01",
      position: "Admin"
    },
    studentCookie
  );
  assert.equal(adminPost.response.status, 403);
  assert.ok(!app.readDb().users.some((user) => user.email === "forbidden@example.com"));

  const foreignPhoto = await app.request(isolated.photoUrl, {
    headers: { cookie: studentCookie }
  });
  assert.equal(foreignPhoto.response.status, 403);
  const ownDashboard = await app.request("/dashboard", {
    headers: { cookie: studentCookie }
  });
  assert.equal(ownDashboard.response.status, 200);

  const foreignProgress = await app.postForm(
    "/dashboard/materials/complete",
    {
      assignmentId: isolatedAssignment.id,
      materialId: material.id
    },
    studentCookie
  );
  assert.equal(foreignProgress.response.status, 404);
  const unchangedAssignment = app.readDb().assignments.find((item) => item.id === isolatedAssignment.id);
  assert.equal(unchangedAssignment.materialProgress[material.id], undefined);

  const wrongCsrfSession = await app.postForm(
    "/dashboard/profile/update",
    {
      _csrf: adminCsrf,
      lastNameEn: "Stolen",
      firstNameEn: "Token",
      birthDate: "1995-02-03",
      email: "student@example.com",
      position: "Deck Officer"
    },
    studentCookie
  );
  assert.equal(wrongCsrfSession.response.status, 403);
  assert.match(wrongCsrfSession.text, /invalid CSRF token/i);
  assert.notEqual(
    app.readDb().users.find((user) => user.email === "student@example.com").lastNameEn,
    "Stolen"
  );
  assert.notEqual(studentCsrf, adminCsrf);
});

test("instructors can manage student records and assignments, but every destructive or administrative action is denied", async () => {
  const createInstructor = await app.postForm(
    "/admin/users/create",
    {
      role: "instructor",
      email: "role.matrix.instructor@example.com",
      password: "RoleInstructor123!",
      firstNameEn: "Irene",
      lastNameEn: "Instructor",
      birthDate: "1986-03-02",
      position: "Instructor",
      company: "Maritime Portal",
      phone: "+10000000444"
    },
    adminCookie
  );
  assert.equal(createInstructor.response.status, 303);
  const instructor = app.readDb().users.find((user) => user.email === "role.matrix.instructor@example.com");
  const instructorCookie = await app.login(instructor.email, "RoleInstructor123!");
  await app.cacheCsrf("/admin/users", instructorCookie);

  for (const path of ["/admin", "/admin/users"]) {
    const allowed = await app.request(path, { headers: { cookie: instructorCookie } });
    assert.equal(allowed.response.status, 200, `${path} should be available to instructors`);
  }
  for (const path of [
    "/admin/applications",
    "/admin/reports",
    "/admin/checks",
    "/admin/checks/template",
    "/admin/tests",
    "/admin/courses",
    "/admin/courses/new",
    "/admin/course-prices",
    "/admin/homepage",
    "/admin/files",
    "/admin/certificates",
    "/admin/notifications",
    "/admin/audit",
    "/admin/users/user_student"
  ]) {
    const forbidden = await app.request(path, { headers: { cookie: instructorCookie } });
    assert.equal(forbidden.response.status, 403, `${path} should be denied to instructors`);
  }

  const createStudent = await app.postForm(
    "/admin/users/create",
    {
      role: "admin",
      email: "managed.by.instructor@example.com",
      password: "ManagedStudent123!",
      firstNameEn: "Managed",
      lastNameEn: "Student",
      birthDate: "1992-08-08",
      position: "Deck Officer",
      company: "Managed Shipping",
      phone: "+10000000333"
    },
    instructorCookie
  );
  assert.equal(createStudent.response.status, 303);
  let managedStudent = app.readDb().users.find((user) => user.email === "managed.by.instructor@example.com");
  assert.equal(managedStudent.role, "student");
  assert.equal(managedStudent.createdById, instructor.id);

  const updateStudent = await app.postForm(
    "/admin/users/update",
    {
      id: managedStudent.id,
      email: managedStudent.email,
      firstNameEn: "Managed",
      lastNameEn: "Updated",
      birthDate: "1992-08-08",
      position: "Chief Mate",
      company: "Updated Shipping",
      phone: "+10000000334"
    },
    instructorCookie
  );
  assert.equal(updateStudent.response.status, 303);
  managedStudent = app.readDb().users.find((user) => user.id === managedStudent.id);
  assert.equal(managedStudent.lastNameEn, "Updated");
  assert.equal(managedStudent.position, "Chief Mate");

  const photo = await sharp({
    create: {
      width: 300,
      height: 400,
      channels: 3,
      background: { r: 40, g: 108, b: 142 }
    }
  }).jpeg().toBuffer();
  const uploadPhoto = await app.postMultipart(
    "/admin/users/photo",
    { id: managedStudent.id },
    {
      photo: {
        name: "managed.jpg",
        type: "image/jpeg",
        buffer: photo
      }
    },
    instructorCookie
  );
  assert.equal(uploadPhoto.response.status, 303);
  assert.match(app.readDb().users.find((user) => user.id === managedStudent.id).photoUrl, /^\/uploads\//);

  const assignment = await app.postForm(
    "/admin/assignments/create",
    { userId: managedStudent.id, courseId: "course_first_aid" },
    instructorCookie
  );
  assert.equal(assignment.response.status, 303);
  assert.ok(app.readDb().assignments.some(
    (item) => item.userId === managedStudent.id && item.courseId === "course_first_aid"
  ));

  const courseBefore = app.readDb().courses.find((course) => course.id === "course_first_aid").title;
  const certificatesBefore = app.readDb().certificates.length;
  const forbiddenPosts = [
    ["/admin/users/toggle", { id: managedStudent.id }],
    ["/admin/users/delete", { id: managedStudent.id }],
    ["/admin/users/reset-password", { id: managedStudent.id, password: "DeniedReset123!" }],
    ["/admin/users/purge", { id: managedStudent.id, confirmPermanentDelete: "delete" }],
    ["/admin/certificates/issue-manual", { userId: managedStudent.id, courseId: "course_first_aid", issuedAt: "2026-07-20" }],
    ["/admin/courses/course_first_aid/update", { title: "Forbidden course title" }],
    ["/admin/applications/status", { id: "missing", status: "accepted" }],
    ["/admin/course-prices/update", { "oldPrice:course_first_aid": "1" }],
    ["/admin/homepage/footer", { policiesTitle: "Forbidden" }],
    ["/admin/notifications/send-pending", {}],
    ["/admin/courses/create", { title: "Forbidden course" }]
  ];
  for (const [path, fields] of forbiddenPosts) {
    const forbidden = await app.postForm(path, fields, instructorCookie);
    assert.equal(forbidden.response.status, 403, `${path} should be denied to instructors`);
  }
  managedStudent = app.readDb().users.find((user) => user.id === managedStudent.id);
  assert.equal(managedStudent.status, "active");
  assert.equal(app.readDb().courses.find((course) => course.id === "course_first_aid").title, courseBefore);
  assert.equal(app.readDb().certificates.length, certificatesBefore);
});

test("untrusted user content is escaped in administrative HTML and sensitive form values are excluded from audit records", async () => {
  const password = "EscapedStudent123!";
  const create = await app.postForm(
    "/admin/users/create",
    {
      role: "student",
      email: "escaped.student@example.com",
      password,
      firstNameEn: "<script>alert(1)</script>",
      lastNameEn: "<img src=x onerror=alert(2)>",
      birthDate: "1991-01-01",
      position: "<b>Master</b>",
      company: "<svg onload=alert(3)>",
      phone: "+10000000222"
    },
    adminCookie
  );
  assert.equal(create.response.status, 303);

  const usersPage = await app.request("/admin/users?q=escaped.student", {
    headers: { cookie: adminCookie }
  });
  assert.equal(usersPage.response.status, 200);
  assert.ok(!usersPage.text.includes("<script>alert(1)</script>"));
  assert.ok(!usersPage.text.includes("<img src=x onerror=alert(2)>"));
  assert.match(usersPage.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(usersPage.text, /&lt;img src=x onerror=alert\(2\)&gt;/);

  const audit = [...app.readDb().auditEvents]
    .reverse()
    .find((event) => event.action === "/admin/users/create" && JSON.stringify(event.details).includes("escaped.student@example.com"));
  assert.ok(audit);
  const serializedDetails = JSON.stringify(audit.details);
  assert.ok(!serializedDetails.includes(password));
  assert.ok(!serializedDetails.includes(adminCsrf));
  assert.ok(!serializedDetails.toLowerCase().includes("password"));
  assert.ok(!serializedDetails.toLowerCase().includes("_csrf"));
});
