import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { startTestServer } from "../helpers/test-server.mjs";

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

test("security headers, private routes, same-origin protection, and CSRF validation are enforced", async () => {
  const home = await app.request("/");
  assert.equal(home.response.status, 200);
  assert.equal(home.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(home.response.headers.get("x-frame-options"), "DENY");
  assert.equal(home.response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(home.response.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(home.response.headers.get("content-security-policy"), /frame-ancestors 'none'/);

  const anonymousAdmin = await app.request("/admin");
  assert.equal(anonymousAdmin.response.status, 303);
  assert.match(anonymousAdmin.response.headers.get("location"), /^\/login/);

  const evilOrigin = await app.request("/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://evil.example",
      referer: "https://evil.example/fake-login"
    },
    body: new URLSearchParams({ email: "admin@example.com", password: "Admin123!" })
  });
  assert.equal(evilOrigin.response.status, 403);
  assert.match(evilOrigin.text, /same-origin protection/i);

  const missingCsrf = await app.request("/admin/course-prices/update", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: app.baseUrl,
      referer: `${app.baseUrl}/admin/course-prices`,
      cookie: adminCookie
    },
    body: new URLSearchParams({ courseId: "course_maritime_safety", oldPrice: "100" })
  });
  assert.equal(missingCsrf.response.status, 403);
  assert.match(missingCsrf.text, /invalid CSRF token/i);

  const invalidCsrf = await app.postForm(
    "/admin/course-prices/update",
    { _csrf: "not-the-session-token", courseId: "course_maritime_safety", oldPrice: "100" },
    adminCookie
  );
  assert.equal(invalidCsrf.response.status, 403);
  assert.match(invalidCsrf.text, /invalid CSRF token/i);

  const protectedFile = await app.request("/uploads/%2e%2e%2fdb.json");
  assert.notEqual(protectedFile.response.status, 200);
  assert.ok(!protectedFile.text.includes("passwordHash"));
});

test("session cookies are hardened and logout invalidates the server-side session", async () => {
  const login = await app.postForm("/login", {
    email: "student@example.com",
    password: "Student123!"
  });
  assert.equal(login.response.status, 303);
  const setCookie = login.response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);
  const studentCookie = setCookie.split(";")[0];
  await app.cacheCsrf("/dashboard", studentCookie);
  const logout = await app.postForm("/logout", {}, studentCookie);
  assert.equal(logout.response.status, 303);
  const staleSession = await app.request("/dashboard", { headers: { cookie: studentCookie } });
  assert.equal(staleSession.response.status, 303);
  assert.match(staleSession.response.headers.get("location"), /^\/login/);
});

test("full administrators can create admins, while instructors remain limited to students and assignments", async () => {
  const createInstructor = await app.postForm(
    "/admin/users/create",
    {
      role: "instructor",
      email: "instructor.security@example.com",
      password: "Instructor123!",
      firstNameEn: "Inga",
      lastNameEn: "Instructor",
      birthDate: "1988-02-03",
      position: "Instructor",
      company: "Maritime Portal",
      phone: "+10000000111"
    },
    adminCookie
  );
  assert.equal(createInstructor.response.status, 303);

  const createAdmin = await app.postForm(
    "/admin/users/create",
    {
      role: "admin",
      email: "admin.second@example.com",
      password: "SecondAdmin123!",
      firstNameEn: "Second",
      lastNameEn: "Administrator",
      birthDate: "1985-05-06",
      position: "Administrator",
      company: "Maritime Portal",
      phone: "+10000000112"
    },
    adminCookie
  );
  assert.equal(createAdmin.response.status, 303);
  const roles = new Map(app.readDb().users.map((user) => [user.email, user.role]));
  assert.equal(roles.get("instructor.security@example.com"), "instructor");
  assert.equal(roles.get("admin.second@example.com"), "admin");

  const instructorCookie = await app.login("instructor.security@example.com", "Instructor123!");
  await app.cacheCsrf("/admin/users", instructorCookie);
  const forbiddenReports = await app.request("/admin/reports", { headers: { cookie: instructorCookie } });
  assert.equal(forbiddenReports.response.status, 403);
  const forbiddenPrices = await app.request("/admin/course-prices", { headers: { cookie: instructorCookie } });
  assert.equal(forbiddenPrices.response.status, 403);
  const forbiddenDelete = await app.postForm(
    "/admin/users/purge",
    { id: "user_student", confirmEmail: "student@example.com" },
    instructorCookie
  );
  assert.equal(forbiddenDelete.response.status, 403);

  const createStudent = await app.postForm(
    "/admin/users/create",
    {
      role: "admin",
      email: "created.by.instructor@example.com",
      password: "InstructorMade123!",
      firstNameEn: "Created",
      lastNameEn: "Student",
      birthDate: "1992-03-04",
      position: "Deck Officer",
      company: "Test Shipping",
      phone: "+10000000113"
    },
    instructorCookie
  );
  assert.equal(createStudent.response.status, 303);
  const createdStudent = app.readDb().users.find((user) => user.email === "created.by.instructor@example.com");
  assert.equal(createdStudent.role, "student");
  assert.equal(createdStudent.createdById, app.readDb().users.find((user) => user.email === "instructor.security@example.com").id);

  const assignment = await app.postForm(
    "/admin/assignments/create",
    { userId: createdStudent.id, courseId: "course_first_aid" },
    instructorCookie
  );
  assert.equal(assignment.response.status, 303);
  assert.ok(app.readDb().assignments.some((item) => item.userId === createdStudent.id && item.courseId === "course_first_aid"));
});

test("concurrent duplicate user and assignment requests remain idempotent", async () => {
  const userFields = {
    role: "student",
    email: "parallel.user@example.com",
    password: "ParallelUser123!",
    firstNameEn: "Parallel",
    lastNameEn: "User",
    birthDate: "1990-01-02",
    position: "Engineer",
    company: "Parallel Shipping",
    phone: "+10000000114"
  };
  const createResults = await Promise.all([
    app.postForm("/admin/users/create", userFields, adminCookie),
    app.postForm("/admin/users/create", userFields, adminCookie)
  ]);
  assert.deepEqual(createResults.map((result) => result.response.status).sort(), [303, 409]);
  const matchingUsers = app.readDb().users.filter((user) => user.email === userFields.email);
  assert.equal(matchingUsers.length, 1);
  assert.match(createResults.find((result) => result.response.status === 409).text, /already exists/i);

  const studentId = matchingUsers[0].id;
  const assignmentResults = await Promise.all([
    app.postForm("/admin/assignments/create", { userId: studentId, courseId: "course_maritime_safety" }, adminCookie),
    app.postForm("/admin/assignments/create", { userId: studentId, courseId: "course_maritime_safety" }, adminCookie)
  ]);
  assert.ok(assignmentResults.every((result) => result.response.status === 303));
  const matchingAssignments = app.readDb().assignments.filter(
    (assignment) => assignment.userId === studentId && assignment.courseId === "course_maritime_safety"
  );
  assert.equal(matchingAssignments.length, 1);
});

test("login brute-force attempts are rate limited without leaking account existence", async () => {
  const statuses = [];
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const result = await app.postForm("/login", {
      email: attempt % 2 ? "missing@example.com" : "admin@example.com",
      password: "DefinitelyWrong123!"
    });
    statuses.push(result.response.status);
    if (attempt < 8) assert.match(result.text, /Invalid email or password/i);
  }
  assert.deepEqual(statuses.slice(0, 8), Array(8).fill(401));
  assert.equal(statuses[8], 429);
});
