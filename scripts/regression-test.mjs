import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { resolve } from "node:path";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const suppliedBaseUrl = process.env.TEST_BASE_URL?.replace(/\/$/, "");
const port = Number(process.env.TEST_PORT ?? 4300 + (Date.now() % 1000));
const baseUrl = suppliedBaseUrl ?? `http://127.0.0.1:${port}`;
const dbPath = resolve(process.env.LMS_DB_PATH ?? resolve("data/test-artifacts", `regression-${runId}.json`));
const imoFixturePath = resolve(process.env.IMO_NEWS_FIXTURE_PATH ?? resolve("data/test-artifacts", `imo-news-${runId}.html`));
const csrfTokens = new Map();
let assertions = 0;

async function startSmtpFixture(preferredPort = 0) {
  const messages = [];
  const sockets = new Set();
  const state = { rateLimited: false, rcptCommands: 0 };
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    let receivingData = false;
    let messageLines = [];
    socket.write("220 regression.smtp ESMTP ready\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\r\n")) {
        const lineEnd = buffer.indexOf("\r\n");
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        if (receivingData) {
          if (line === ".") {
            messages.push(messageLines.join("\r\n"));
            messageLines = [];
            receivingData = false;
            socket.write("250 2.0.0 queued\r\n");
          } else {
            messageLines.push(line.startsWith("..") ? line.slice(1) : line);
          }
          continue;
        }
        const command = line.toUpperCase();
        if (command.startsWith("EHLO") || command.startsWith("HELO")) {
          socket.write("250-regression.smtp\r\n250 SIZE 52428800\r\n");
        } else if (command.startsWith("MAIL FROM")) {
          socket.write("250 2.1.0 sender accepted\r\n");
        } else if (command.startsWith("RCPT TO")) {
          state.rcptCommands += 1;
          socket.write(state.rateLimited
            ? "451 Outbound rate limit exceeded (60.0/1h). Contact support.\r\n"
            : "250 2.1.5 recipient accepted\r\n");
        } else if (command === "DATA") {
          receivingData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (command === "QUIT") {
          socket.write("221 2.0.0 closing connection\r\n");
          socket.end();
        } else {
          socket.write("250 2.0.0 accepted\r\n");
        }
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(preferredPort, "127.0.0.1");
  await once(server, "listening");
  return { server, sockets, messages, state, port: server.address().port };
}

async function stopSmtpFixture(fixture) {
  if (!fixture) return;
  for (const socket of fixture.sockets) socket.destroy();
  fixture.server.close();
  await once(fixture.server, "close");
}

function createImoNewsFixture() {
  const cards = Array.from({ length: 22 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `<div><img src="https://wwwcdn.imo.org/localresources/test-${index + 1}.jpg"><span class="badge badge-primary">${day} January 2026</span><h3 class="card-title"><a href="/en/MediaCentre/PressBriefings/pages/test-${index + 1}.aspx">IMO fixture news ${index + 1}</a></h3><p class="card-text">Official fixture summary ${index + 1}</p></div>`;
  }).reverse().join("\n");
  mkdirSync(resolve("data/test-artifacts"), { recursive: true });
  writeFileSync(imoFixturePath, cards, "utf8");
}

function assert(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function readDb() {
  return JSON.parse(readFileSync(dbPath, "utf8"));
}

function decodedSmtpText(message) {
  const parts = [];
  const pattern = /Content-Type: text\/(?:plain|html); charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)(?=\r\n--)/g;
  for (const match of String(message ?? "").matchAll(pattern)) {
    parts.push(Buffer.from(match[1].replace(/\s/g, ""), "base64").toString("utf8"));
  }
  return parts.join("\n");
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual", ...options });
  return { response, body: await response.text() };
}

function cookieFrom(response) {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function postForm(path, fields, cookie = "") {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(key, String(item));
  }
  const csrfToken = csrfTokens.get(cookie);
  if (csrfToken && !form.has("_csrf")) form.set("_csrf", csrfToken);
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: baseUrl, ...(cookie ? { cookie } : {}) },
    body: form
  });
}

async function postMultipart(path, fields, file, cookie = "") {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  const csrfToken = csrfTokens.get(cookie);
  if (csrfToken && !form.has("_csrf")) form.set("_csrf", csrfToken);
  if (file) form.set("photo", new Blob([file.buffer], { type: file.type }), file.name);
  return request(path, {
    method: "POST",
    headers: { origin: baseUrl, ...(cookie ? { cookie } : {}) },
    body: form
  });
}

async function cacheCsrfToken(path, cookie) {
  const { response, body } = await request(path, { headers: { cookie } });
  const match = body.match(/name="_csrf" value="([^"]+)"/);
  assert(response.status === 200 && match, `CSRF token is unavailable on ${path}`);
  csrfTokens.set(cookie, match[1]);
}

async function login(email, password) {
  const { response, body } = await postForm("/login", { email, password });
  const cookie = cookieFrom(response);
  assert(response.status === 303 && cookie, `Login failed for ${email}: ${response.status} ${response.headers.get("location") ?? ""} ${body.slice(0, 140)}`);
  return cookie;
}

async function expectRedirect(promise, expectedPath) {
  const { response } = await promise;
  assert(response.status === 303, `Expected redirect to ${expectedPath}, got ${response.status}`);
  assert(response.headers.get("location") === expectedPath, `Expected ${expectedPath}, got ${response.headers.get("location")}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const { response } = await request("/healthz");
      if (response.status === 200) return;
    } catch {
      // The server needs a moment to create its isolated database.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  }
  throw new Error("Regression server did not become ready.");
}

async function waitForCondition(check, message) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (check()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(message);
}

async function stopServer(server) {
  if (!server?.listening) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections?.();
  await closed;
}

export async function runRegressionTest() {
  createImoNewsFixture();
  const suppliedSmtpPort = Number(process.env.TEST_SMTP_PORT ?? 0);
  const smtpFixture = !suppliedBaseUrl || suppliedSmtpPort ? await startSmtpFixture(suppliedSmtpPort) : null;
  let server = null;
  if (!suppliedBaseUrl) {
    Object.assign(process.env, {
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_BASE_URL: baseUrl,
      LMS_STORAGE: "json",
      LMS_DB_PATH: dbPath,
      IMO_NEWS_FIXTURE_PATH: imoFixturePath,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(smtpFixture.port),
      SMTP_SECURE: "false",
      SMTP_STARTTLS: "false",
      SMTP_USER: "",
      SMTP_PASS: "",
      SMTP_FROM: "info@maritimeportal.test",
      SMTP_FROM_NAME: "Maritime Portal",
      SMTP_RATE_LIMIT_RETRY_MINUTES: "65"
    });
    ({ server } = await import("./lms-server.mjs"));
  }

  try {
    if (server) await waitForServer();
    else await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));

    const home = await request("/");
    assert(home.response.status === 200, "Home page is unavailable");
    assert(home.body.includes("home-footer"), "Public footer is missing");
    for (const path of ["/blog", "/contacts", "/terms", "/privacy", "/user-policy"]) {
      const page = await request(path);
      assert(page.response.status === 200, `${path} is unavailable`);
    }
    if (!suppliedBaseUrl) {
      const blog = await request("/blog");
      const cardCount = (blog.body.match(/class="imo-news-card"/g) ?? []).length;
      assert(cardCount === 20, `Blog should show 20 IMO news cards, got ${cardCount}`);
      assert(blog.body.includes("22 January 2026") && blog.body.includes("IMO fixture news 22"), "Latest IMO news is missing from the blog");
      assert(!blog.body.includes(">IMO fixture news 2</h2>"), "Blog includes news outside the latest 20");
      assert(blog.body.indexOf("IMO fixture news 22") < blog.body.indexOf("IMO fixture news 21"), "IMO news is not ordered newest first");
    }
    const anonymousDashboard = await request("/dashboard");
    assert(anonymousDashboard.response.status === 303 && anonymousDashboard.response.headers.get("location")?.startsWith("/login"), "Anonymous user can access the dashboard");

    if (!suppliedBaseUrl) {
      const localhostOrigin = `http://localhost:${port}`;
      const localOriginLogin = await fetch(`${localhostOrigin}/login`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: localhostOrigin,
          referer: `${localhostOrigin}/login`
        },
        body: new URLSearchParams({ email: "student@example.com", password: "Student123!" })
      });
      assert(localOriginLogin.status === 303, "Localhost sign-in is rejected when PUBLIC_BASE_URL uses 127.0.0.1");
    }

    const adminCookie = await login("admin@example.com", "Admin123!");
    const studentCookie = await login("student@example.com", "Student123!");
    await cacheCsrfToken("/admin", adminCookie);
    await cacheCsrfToken("/dashboard", studentCookie);
    const secondAdminCookie = await login("admin@example.com", "Admin123!");
    await cacheCsrfToken("/admin", secondAdminCookie);
    const firstAdminSessionProbe = await postForm("/csrf-session-probe", {}, adminCookie);
    assert(
      firstAdminSessionProbe.response.status === 404,
      "Signing in from a second browser invalidates CSRF tokens in the first browser"
    );
    const newAdminEmail = `regression-admin-${runId}@example.com`;
    const newAdminPassword = "RegressionAdmin123!";
    const createAdmin = await postForm("/admin/users/create", {
      role: "admin", email: newAdminEmail, firstNameEn: "Regression", lastNameEn: "Administrator",
      birthDate: "1990-01-01", position: "Administrator", password: newAdminPassword
    }, adminCookie);
    assert(createAdmin.response.status === 303, "Administrator account creation did not redirect");
    let database = readDb();
    assert(database.users.some((item) => item.email === newAdminEmail && item.role === "admin"), "Full administrator cannot create an administrator account");
    const newAdmin = database.users.find((item) => item.email === newAdminEmail);
    assert(newAdmin.mustChangePassword === false, "A new account still requires a mandatory first password change");
    assert(newAdmin.courseNotificationsEnabled === false, "A new account allows course emails before its first sign-in");
    const newAdminRegistration = database.notifications.find((note) => note.recipientEmail === newAdminEmail && note.type === "user_registered");
    assert(newAdminRegistration?.status === "sent", "New users do not receive their account details by e-mail");
    assert(!newAdminRegistration.payload.includes(newAdminPassword), "The initial password is retained in notification history");
    assert(!database.passwordResetTokens.some((token) => token.userId === newAdmin.id), "New users still receive an unnecessary account activation token");
    const duplicateUser = await postForm("/admin/users/create", {
      role: "student", email: newAdminEmail.toUpperCase(), firstNameEn: "Existing", lastNameEn: "Email",
      birthDate: "1990-01-01", position: "Trainee", company: "Regression company", password: "RegressionStudent123!"
    }, adminCookie);
    assert(duplicateUser.response.status === 409, "Duplicate e-mail creation did not return a clear conflict");
    assert(duplicateUser.body.includes("A user with this e-mail address already exists."), "Duplicate e-mail error is not shown to the administrator");
    assert(duplicateUser.body.includes("Regression company"), "User creation form values are not preserved after a duplicate e-mail error");
    const firstAdminSignIn = await postForm("/login", { email: newAdminEmail, password: newAdminPassword });
    const newAdminCookie = cookieFrom(firstAdminSignIn.response);
    assert(firstAdminSignIn.response.status === 303 && firstAdminSignIn.response.headers.get("location") === "/admin", "A new administrator is not sent directly to the admin panel");
    database = readDb();
    assert(database.users.find((item) => item.id === newAdmin.id).mustChangePassword === false, "Mandatory password change remains after first sign-in");
    assert(database.users.find((item) => item.id === newAdmin.id).courseNotificationsEnabled === true, "Course notifications are not enabled after first sign-in");
    const newAdminPanel = await request("/admin", { headers: { cookie: newAdminCookie } });
    assert(newAdminPanel.response.status === 200, "Created administrator cannot open the admin panel with the assigned password");
    const legacyFirstLoginPage = await request("/first-login", { headers: { cookie: newAdminCookie } });
    assert(legacyFirstLoginPage.response.status === 303 && legacyFirstLoginPage.response.headers.get("location") === "/admin", "Legacy first-login URL still requires a password change");
    await cacheCsrfToken("/admin", newAdminCookie);
    const postSignInProbe = await postForm("/csrf-session-probe", {}, newAdminCookie);
    assert(postSignInProbe.response.status === 404, "Authenticated forms fail after direct first sign-in");

    const instructorEmail = `regression-instructor-${runId}@example.com`;
    const instructorPassword = "RegressionInstructor123!";
    const createInstructor = await postForm("/admin/users/create", {
      role: "instructor", email: instructorEmail, firstNameEn: "Regression", lastNameEn: "Instructor",
      birthDate: "1990-01-01", position: "Instructor", password: instructorPassword
    }, adminCookie);
    assert(createInstructor.response.status === 303, "Instructor account creation did not redirect");
    const instructorFirstSignIn = await postForm("/login", { email: instructorEmail, password: instructorPassword });
    const instructorCookie = cookieFrom(instructorFirstSignIn.response);
    assert(
      instructorFirstSignIn.response.status === 303 && instructorFirstSignIn.response.headers.get("location") === "/admin" && instructorCookie,
      "A newly created instructor cannot sign in directly with the assigned password"
    );
    await cacheCsrfToken("/admin/users", instructorCookie);
    const instructorAdminAttemptEmail = `regression-instructor-request-${runId}@example.com`;
    const instructorAdminAttempt = await postForm("/admin/users/create", {
      role: "admin", email: instructorAdminAttemptEmail, firstNameEn: "Regression", lastNameEn: "Student",
      birthDate: "1990-01-01", position: "Trainee", password: "RegressionStudent123!"
    }, instructorCookie);
    assert(instructorAdminAttempt.response.status === 303, "Instructor user creation did not redirect");
    database = readDb();
    assert(database.users.some((item) => item.email === instructorAdminAttemptEmail && item.role === "student"), "Instructor can create an administrator account");
    const studentAdmin = await request("/admin", { headers: { cookie: studentCookie } });
    assert(studentAdmin.response.status === 403, "Student can access the admin area");
    for (const path of ["/admin/checks", "/admin/course-prices", "/admin/courses/new", "/admin/courses/merge"]) {
      const page = await request(path, { headers: { cookie: adminCookie } });
      assert(page.response.status === 200, `${path} is unavailable for an admin`);
    }
    for (const path of ["/admin/checks/export.xls", "/admin/course-prices/export.xls"]) {
      const report = await request(path, { headers: { cookie: adminCookie } });
      assert(report.response.status === 200 && report.response.headers.get("content-type")?.includes("application/vnd.ms-excel"), `${path} does not export an Excel document`);
    }

    const alphaTitle = `Regression Navigation ${runId}`;
    const betaTitle = `Regression Safety ${runId}`;
    const removableTitle = `Regression Removable ${runId}`;
    const alphaDescription = `Course list description ${runId}`;
    for (const title of [alphaTitle, betaTitle, removableTitle]) {
      const { response } = await postForm("/admin/courses/create", { title, shortDescription: title === alphaTitle ? alphaDescription : "Regression course", goals: "Regression" }, adminCookie);
      assert(response.status === 303, `Course creation did not redirect for ${title}`);
    }
    database = readDb();
    const alpha = database.courses.find((course) => course.title === alphaTitle);
    const beta = database.courses.find((course) => course.title === betaTitle);
    const removable = database.courses.find((course) => course.title === removableTitle);
    assert(alpha && beta && removable, "Regression courses were not created");

    const pendingStudentEmail = `regression-pending-${runId}@example.com`;
    const pendingStudentPassword = "RegressionPending123!";
    const createPendingStudent = await postForm("/admin/users/create", {
      role: "student", email: pendingStudentEmail, firstNameEn: "Pending", lastNameEn: "Learner",
      birthDate: "1995-04-16", position: "Deck Cadet", password: pendingStudentPassword
    }, adminCookie);
    assert(createPendingStudent.response.status === 303, "Pending student account creation did not redirect");
    database = readDb();
    const pendingStudent = database.users.find((item) => item.email === pendingStudentEmail);
    assert(pendingStudent?.courseNotificationsEnabled === false, "Pending student course notifications are enabled too early");
    await expectRedirect(
      postForm("/admin/assignments/create", { userId: pendingStudent.id, courseId: alpha.id }, adminCookie),
      "/admin/users"
    );
    database = readDb();
    const pendingAssignment = database.assignments.find((item) => item.userId === pendingStudent.id && item.courseId === alpha.id);
    const deferredAssignmentNotice = database.notifications.find((note) => note.assignmentId === pendingAssignment?.id && note.type === "course_assigned");
    assert(pendingAssignment && deferredAssignmentNotice?.status === "deferred", "Course assignment email was not deferred before first sign-in");
    const pendingFirstSignIn = await postForm("/login", { email: pendingStudentEmail, password: pendingStudentPassword });
    const pendingStudentCookie = cookieFrom(pendingFirstSignIn.response);
    assert(
      pendingFirstSignIn.response.status === 303 && pendingFirstSignIn.response.headers.get("location") === "/dashboard" && pendingStudentCookie,
      "A new student cannot sign in directly with the administrator-assigned password"
    );
    await waitForCondition(
      () => readDb().notifications.find((note) => note.id === deferredAssignmentNotice.id)?.status === "sent",
      "Deferred course assignment email was not delivered after first sign-in"
    );
    assert(readDb().users.find((item) => item.id === pendingStudent.id)?.courseNotificationsEnabled === true, "Pending student notifications remain disabled after first sign-in");
    const resetStudentPassword = "RegressionResetPassword123!";
    await expectRedirect(
      postForm("/admin/users/reset-password", { id: pendingStudent.id, password: resetStudentPassword }, adminCookie),
      "/admin/users"
    );
    database = readDb();
    const resetNotice = database.notifications.find((note) => note.recipientUserId === pendingStudent.id && note.type === "password_reset");
    assert(resetNotice?.status === "sent", "Administrator password reset details were not sent by e-mail");
    assert(!resetNotice.payload.includes(resetStudentPassword), "The reset password is retained in notification history");
    const resetStudentSignIn = await postForm("/login", { email: pendingStudentEmail, password: resetStudentPassword });
    assert(resetStudentSignIn.response.status === 303 && resetStudentSignIn.response.headers.get("location") === "/dashboard", "Student cannot sign in directly with an administrator-reset password");

    const courseList = await request("/admin/courses", { headers: { cookie: adminCookie } });
    assert(courseList.body.includes("admin-course-avatar") && !courseList.body.includes(alphaDescription), "Course list should show compact avatars and titles without descriptions");
    assert(courseList.body.includes('href="/admin/courses/new"'), "Course list does not provide the New course page");
    assert(courseList.body.includes('href="/admin/courses/merge"'), "Course list does not provide the Merge courses page");
    const seededBeforeMerge = readDb().courses.filter((course) => ["course_maritime_safety", "course_first_aid"].includes(course.id));
    const expectedMergedLessons = seededBeforeMerge.reduce((sum, course) => sum + (course.lessons?.length ?? 0), 0);
    const expectedMergedQuestions = seededBeforeMerge.reduce((sum, course) => sum + (course.test?.questions?.length ?? 0), 0);
    const mergedTitle = `Regression Merged Course ${runId}`;
    const mergedResponse = await postForm("/admin/courses/merge", {
      title: mergedTitle,
      shortDescription: "Combined course regression",
      testTitle: "Combined final assessment",
      courseIds: ["course_maritime_safety", "course_first_aid"]
    }, adminCookie);
    assert(mergedResponse.response.status === 303, "Course merge did not redirect to the merged course");
    database = readDb();
    const mergedCourse = database.courses.find((course) => course.title === mergedTitle);
    assert(mergedCourse, "Merged course was not created");
    assert(mergedResponse.response.headers.get("location") === `/admin/courses/${mergedCourse.id}`, "Course merge did not redirect to the new course editor");
    assert((mergedCourse.lessons?.length ?? 0) === expectedMergedLessons, "Merged course did not copy all lessons");
    assert((mergedCourse.test?.questions?.length ?? 0) === expectedMergedQuestions, "Merged course did not copy all assessment questions");
    assert(mergedCourse.source?.mergedFromCourseIds?.includes("course_maritime_safety") && mergedCourse.source?.mergedFromCourseIds?.includes("course_first_aid"), "Merged course does not keep source course references");
    const coursePrices = await request("/admin/course-prices", { headers: { cookie: adminCookie } });
    assert(coursePrices.body.includes("Automatic certificate") && coursePrices.body.includes(`autoIssueCertificate:${alpha.id}`), "Course prices do not provide automatic certificate controls");
    await expectRedirect(postForm("/admin/course-prices/update", {
      [`oldPrice:${alpha.id}`]: "100",
      [`newPrice:${alpha.id}`]: "80",
      [`certificateSetting:${alpha.id}`]: "1"
    }, adminCookie), "/admin/course-prices");
    assert(readDb().courses.find((course) => course.id === alpha.id).autoIssueCertificate === false, "Automatic certificate setting was not disabled from course prices");
    await expectRedirect(postForm("/admin/course-prices/update", {
      [`certificateSetting:${alpha.id}`]: "1",
      [`autoIssueCertificate:${alpha.id}`]: "on"
    }, adminCookie), "/admin/course-prices");
    assert(readDb().courses.find((course) => course.id === alpha.id).autoIssueCertificate === true, "Automatic certificate setting was not restored for certificate flow tests");
    const homepageEditor = await request("/admin/homepage", { headers: { cookie: adminCookie } });
    assert(homepageEditor.body.includes("admin-course-avatar") && !homepageEditor.body.includes(alphaDescription), "Homepage editor should show compact course avatars without descriptions");
    const removableEditor = await request(`/admin/courses/${removable.id}`, { headers: { cookie: adminCookie } });
    assert(removableEditor.body.includes(`/admin/courses/${removable.id}/delete`), "Course editor does not offer deletion for an unused course");
    await expectRedirect(postForm(`/admin/courses/${removable.id}/delete`, {}, adminCookie), "/admin/courses");
    assert(!readDb().courses.some((course) => course.id === removable.id), "Unused course was not deleted");

    const certificateEditor = await request(`/admin/courses/${alpha.id}`, { headers: { cookie: adminCookie } });
    assert(certificateEditor.body.includes('name="autoIssueCertificate"') && certificateEditor.body.includes("Automatically issue a certificate"), "Course certificate settings do not provide the automatic issue control");

    await expectRedirect(postForm(`/admin/courses/${alpha.id}/update`, {
      title: alpha.title, shortDescription: alpha.shortDescription, fullDescription: "", goals: alpha.goals,
      oldPrice: "100", newPrice: "80", status: "active", catalogCategory: "Navigation",
      catalogPositions: ["Master", "Deck Officer"], homeSortOrder: 999
    }, adminCookie), `/admin/courses/${alpha.id}`);
    await expectRedirect(postForm(`/admin/courses/${beta.id}/update`, {
      title: beta.title, shortDescription: beta.shortDescription, fullDescription: "", goals: beta.goals,
      oldPrice: "100", newPrice: "90", status: "active", catalogCategory: "Safety",
      catalogPositions: ["Engine Officer"], homeSortOrder: 999
    }, adminCookie), `/admin/courses/${beta.id}`);

    const catalog = await request("/courses?position=Master&category=Navigation");
    assert(catalog.body.includes(alphaTitle), "Catalog does not show a matching filtered course");
    assert(!catalog.body.includes(betaTitle), "Catalog shows a course outside its filters");
    assert(catalog.body.includes('name="position"') && catalog.body.includes('name="category"') && !catalog.body.includes('name="author"'), "Catalog filters are incorrect");

    const applicationsBefore = readDb().applications.length;
    await expectRedirect(postForm("/apply", { courseId: alpha.id, comment: "Request from dashboard" }, studentCookie), "/apply?success=1");
    database = readDb();
    const application = database.applications[0];
    assert(database.applications.length === applicationsBefore + 1, "Student application was not saved");
    assert(application.email === "student@example.com" && application.courseId === alpha.id, "Student application did not use profile data");
    assert(database.notifications.some((note) => note.type === "new_application"), "Admin notification was not created for student application");
    const blockedDelete = await postForm(`/admin/courses/${alpha.id}/delete`, {}, adminCookie);
    assert(blockedDelete.response.status === 409 && readDb().courses.some((course) => course.id === alpha.id), "Course with a student application can be deleted");

    await expectRedirect(postForm("/admin/homepage/footer", {
      policiesTitle: "Regression policies", termsLabel: "Terms", termsUrl: "/terms", privacyLabel: "Privacy", privacyUrl: "/privacy",
      userPolicyLabel: "User policy", userPolicyUrl: "/user-policy", feedbackTitle: "Regression feedback title",
      termsContent: "Regression terms\nSecond line", privacyContent: "Regression privacy", userPolicyContent: "Regression user policy",
      namePlaceholder: "Name", emailPlaceholder: "Email", subjectPlaceholder: "Subject", messagePlaceholder: "Message", submitLabel: "Send"
    }, adminCookie), "/admin/homepage");
    const configuredHome = await request("/");
    assert(configuredHome.body.includes("Regression feedback title"), "Footer settings were not rendered");
    const termsPage = await request("/terms");
    assert(termsPage.body.includes("Regression terms") && termsPage.body.includes("Second line"), "Policy page content was not rendered");
    await expectRedirect(postForm("/feedback", { name: "Regression", email: "feedback@example.com", subject: "Smoke", message: "Footer message" }), "/?feedback=1");
    assert(readDb().notifications.some((note) => note.type === "feedback_message"), "Footer feedback did not notify admins");

    await expectRedirect(postForm(`/admin/courses/${alpha.id}/lessons/create`, { title: "Regression lesson", description: "" }, adminCookie), `/admin/courses/${alpha.id}`);
    database = readDb();
    const lesson = database.courses.find((course) => course.id === alpha.id).lessons[0];
    await expectRedirect(postForm(`/admin/courses/${alpha.id}/materials/create`, { lessonId: lesson.id, title: "Inline text", type: "text", content: "Read this inline", isRequired: "on" }, adminCookie), `/admin/courses/${alpha.id}`);
    await expectRedirect(postForm(`/admin/courses/${alpha.id}/materials/create`, { lessonId: lesson.id, title: "Inline video", type: "video", content: "/uploads/regression-video.mp4", isRequired: "on" }, adminCookie), `/admin/courses/${alpha.id}`);
    await expectRedirect(postForm(`/admin/courses/${alpha.id}/test/questions/create`, { questionText: "Regression question", option1: "Correct", option2: "Wrong", correct: 1 }, adminCookie), `/admin/courses/${alpha.id}`);
    const assignmentResponse = await postForm("/admin/assignments/create", { userId: "user_student", courseId: alpha.id }, adminCookie);
    assert(assignmentResponse.response.status === 303, "Course assignment did not redirect");
    database = readDb();
    const assignment = database.assignments.find((item) => item.userId === "user_student" && item.courseId === alpha.id);
    const firstMaterial = database.courses.find((course) => course.id === alpha.id).lessons[0].materials[0];
    await expectRedirect(postForm("/dashboard/materials/complete", { assignmentId: assignment.id, materialId: firstMaterial.id }, studentCookie), `/dashboard/courses/${assignment.id}`);
    const courseAfterText = await request(`/dashboard/courses/${assignment.id}`, { headers: { cookie: studentCookie } });
    assert(courseAfterText.body.includes("material-text"), "Inline text material is not rendered in the student course");
    assert(courseAfterText.body.includes("student-course-cover"), "Student course uses an oversized generic course cover");
    const secondMaterial = readDb().courses.find((course) => course.id === alpha.id).lessons[0].materials[1];
    await expectRedirect(postForm("/dashboard/materials/complete", { assignmentId: assignment.id, materialId: secondMaterial.id }, studentCookie), `/dashboard/courses/${assignment.id}`);
    const courseAfterVideo = await request(`/dashboard/courses/${assignment.id}`, { headers: { cookie: studentCookie } });
    assert(courseAfterVideo.body.includes("<video controls"), "Inline video player is not rendered in the student course");

    const question = readDb().courses.find((course) => course.id === alpha.id).test.questions[0];
    const testPage = await request(`/dashboard/tests/${assignment.id}`, { headers: { cookie: studentCookie } });
    assert(testPage.response.status === 200 && testPage.body.includes("Regression question"), "Student test is unavailable after materials");
    const certificatePhoto = await sharp({
      create: { width: 64, height: 80, channels: 3, background: { r: 224, g: 236, b: 244 } }
    }).png().toBuffer();
    const photoUpload = await postMultipart(
      "/admin/users/photo",
      { id: "user_student" },
      { name: "regression-photo.png", type: "image/png", buffer: certificatePhoto },
      adminCookie
    );
    assert(photoUpload.response.status === 303, "Student certificate photo upload did not redirect");
    await expectRedirect(postForm(`/dashboard/tests/${assignment.id}`, { [question.id]: question.options[0].id }, studentCookie), `/dashboard/courses/${assignment.id}#test-result`);
    const resultPage = await request(`/dashboard/courses/${assignment.id}`, { headers: { cookie: studentCookie } });
    assert(resultPage.body.includes('id="test-result"'), "Test result anchor is missing");
    database = readDb();
    const automaticCertificate = database.certificates.find((certificate) => certificate.assignmentId === assignment.id && certificate.status === "issued");
    assert(automaticCertificate, "Passed course did not issue an automatic certificate");
    assert(
      database.notifications.some((note) => note.type === "certificate_available" && note.certificateId === automaticCertificate.id),
      "Automatic certificate notification was not created"
    );

    await expectRedirect(
      postForm("/admin/certificates/issue-manual", { userId: "user_student", courseId: beta.id, issuedAt: "2026-07-22" }, adminCookie),
      "/admin/certificates?userId=user_student"
    );
    database = readDb();
    const manualCertificate = database.certificates.find((certificate) => certificate.userId === "user_student" && certificate.courseId === beta.id && certificate.status === "issued");
    assert(manualCertificate, "Manual certificate issue did not create a certificate");
    assert(
      database.notifications.some((note) => note.type === "certificate_manual_issue" && note.certificateId === manualCertificate.id),
      "Manual certificate issue notification was not created"
    );
    await expectRedirect(
      postForm("/admin/certificates/issue-manual", { userId: "user_student", courseId: beta.id, issuedAt: "2026-07-22" }, adminCookie),
      "/admin/certificates?userId=user_student"
    );
    database = readDb();
    assert(
      database.notifications.some((note) => note.type === "certificate_resent" && note.certificateId === manualCertificate.id),
      "Reissuing an existing manual certificate did not create a resend notification"
    );
    await expectRedirect(postForm("/admin/certificates/reissue", { id: manualCertificate.id }, adminCookie), "/admin/certificates");
    database = readDb();
    const reissuedCertificate = database.certificates.find((certificate) => certificate.replacesCertificateId === manualCertificate.id);
    assert(reissuedCertificate, "Certificate reissue did not create a replacement certificate");
    assert(
      database.notifications.some((note) => note.type === "certificate_reissued" && note.certificateId === reissuedCertificate.id),
      "Certificate reissue notification was not created"
    );

    if (smtpFixture) {
      await waitForCondition(() => {
        const current = readDb();
        const required = [
          ["user_registered", newAdminEmail],
          ["password_reset", pendingStudentEmail],
          ["course_assigned", pendingStudentEmail],
          ["certificate_available", "student@example.com"],
          ["certificate_manual_issue", "student@example.com"],
          ["certificate_resent", "student@example.com"],
          ["certificate_reissued", "student@example.com"]
        ];
        return required.every(([type, recipientEmail]) => current.notifications.some(
          (note) => note.type === type && note.recipientEmail === recipientEmail && note.status === "sent"
        ));
      }, "Registration, password, or certificate email was not delivered through SMTP");
      const registrationMessage = smtpFixture.messages.find((message) => message.includes("Subject: Welcome to Maritime Portal - your account details"));
      assert(
        registrationMessage?.includes("Content-Type: multipart/alternative"),
        "Account details email is not a valid multipart message"
      );
      const registrationText = decodedSmtpText(registrationMessage).replaceAll("**", "");
      assert(registrationText.includes(`Login: ${newAdminEmail}`), "Account details email does not contain the assigned login");
      assert(registrationText.includes(`Password: ${newAdminPassword}`), "Account details email does not contain the assigned password");
      assert(registrationText.includes(`Sign in: ${baseUrl}/login`), "Account details email does not contain the sign-in link");
      const resetMessage = [...smtpFixture.messages].reverse().find((message) => message.includes("Subject: Your Maritime Portal password was reset"));
      const resetText = decodedSmtpText(resetMessage).replaceAll("**", "");
      assert(resetText.includes(`Login: ${pendingStudentEmail}`) && resetText.includes(`Password: ${resetStudentPassword}`), "Password-reset email does not contain fresh login details");
      assert(
        smtpFixture.messages.some((message) => message.includes("Subject: Your certificate has been issued") && message.includes("Content-Type: application/pdf")),
        "Issued certificate email does not contain the PDF attachment"
      );

      smtpFixture.state.rateLimited = true;
      await expectRedirect(postForm("/admin/notifications/test-smtp", { email: "rate-limit@example.com" }, adminCookie), "/admin/notifications");
      let rateLimitDb = readDb();
      const rateLimitNote = rateLimitDb.notifications.find((note) => note.recipientEmail === "rate-limit@example.com" && note.type === "smtp_test");
      assert(rateLimitNote?.status === "queued" && rateLimitNote.errorMessage.includes("Automatic retry"), "SMTP rate limit did not preserve the email in the queue");
      assert(Date.parse(rateLimitDb.settings.emailDeliveryPausedUntil) > Date.now(), "SMTP rate limit did not persist a delivery cooldown");
      const attemptsAfterLimit = smtpFixture.state.rcptCommands;
      await expectRedirect(postForm("/admin/notifications/test-smtp", { email: "rate-limit-second@example.com" }, adminCookie), "/admin/notifications");
      assert(smtpFixture.state.rcptCommands === attemptsAfterLimit, "SMTP cooldown allowed another delivery attempt");
      const pausedNotificationsPage = await request("/admin/notifications", { headers: { cookie: adminCookie } });
      assert(pausedNotificationsPage.body.includes("Delivery is paused until") && pausedNotificationsPage.body.includes("disabled"), "SMTP cooldown is not visible in the admin panel");
      smtpFixture.state.rateLimited = false;
    }

    const audit = await request("/admin/audit", { headers: { cookie: adminCookie } });
    assert(audit.body.includes('href="/admin/audit/'), "Audit log does not include event detail links");
    const auditEvent = readDb().auditEvents.at(-1);
    const auditDetail = await request(`/admin/audit/${auditEvent.id}`, { headers: { cookie: adminCookie } });
    assert(auditDetail.response.status === 200 && auditDetail.body.includes("audit-detail"), "Audit details page is unavailable");

    const purgePage = await request("/admin/users", { headers: { cookie: adminCookie } });
    assert(purgePage.body.includes("Delete permanently") && purgePage.body.includes("confirmPermanentDelete"), "Permanent user deletion warning is unavailable");
    await expectRedirect(postForm("/admin/users/purge", { id: "user_student", confirmPermanentDelete: "delete" }, adminCookie), "/admin/users?purged=1");
    database = readDb();
    assert(!database.users.some((item) => item.id === "user_student"), "Student was not permanently deleted");
    assert(!database.assignments.some((item) => item.userId === "user_student"), "Student course assignments were not permanently deleted");
    assert(!database.testAttempts.some((item) => item.userId === "user_student"), "Student test attempts were not permanently deleted");
    assert(!database.certificates.some((item) => item.userId === "user_student"), "Student certificates were not permanently deleted");
    assert(!database.notifications.some((item) => item.recipientUserId === "user_student" || item.recipientEmail === "student@example.com"), "Student notifications were not permanently deleted");
    assert(!database.passwordResetTokens.some((item) => item.userId === "user_student"), "Student recovery links were not permanently deleted");

    console.log(`Regression test passed: ${assertions} assertions`);
    console.log(`Temporary JSON test database: ${dbPath}`);
  } finally {
    if (server) {
      await stopServer(server);
    }
    await stopSmtpFixture(smtpFixture);
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  runRegressionTest().catch((error) => {
    console.error(`Regression test failed after ${assertions} assertions: ${error.message}`);
    process.exitCode = 1;
  });
}
