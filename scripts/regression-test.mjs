import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const suppliedBaseUrl = process.env.TEST_BASE_URL?.replace(/\/$/, "");
const port = Number(process.env.TEST_PORT ?? 4300 + (Date.now() % 1000));
const baseUrl = suppliedBaseUrl ?? `http://127.0.0.1:${port}`;
const dbPath = resolve(process.env.LMS_DB_PATH ?? resolve("data/test-artifacts", `regression-${runId}.json`));
const imoFixturePath = resolve("data/test-artifacts", `imo-news-${runId}.html`);
const csrfTokens = new Map();
let assertions = 0;

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

async function waitForServer(server) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Regression server stopped before becoming ready.");
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

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill();
  await Promise.race([once(server, "exit"), new Promise((resolveDelay) => setTimeout(resolveDelay, 3000))]);
}

async function run() {
  createImoNewsFixture();
  const server = suppliedBaseUrl ? null : spawn(process.execPath, ["scripts/lms-server.mjs"], {
    cwd: resolve("."),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_BASE_URL: baseUrl,
      LMS_STORAGE: "json",
      LMS_DB_PATH: dbPath,
      IMO_NEWS_FIXTURE_PATH: imoFixturePath,
      SMTP_HOST: "",
      SMTP_FROM: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverOutput = "";
  server?.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server?.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

  try {
    if (server) await waitForServer(server);
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

    const adminCookie = await login("admin@example.com", "Admin123!");
    const studentCookie = await login("student@example.com", "Student123!");
    await cacheCsrfToken("/admin", adminCookie);
    await cacheCsrfToken("/dashboard", studentCookie);
    const studentAdmin = await request("/admin", { headers: { cookie: studentCookie } });
    assert(studentAdmin.response.status === 403, "Student can access the admin area");
    for (const path of ["/admin/checks", "/admin/course-prices"]) {
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
    let database = readDb();
    const alpha = database.courses.find((course) => course.title === alphaTitle);
    const beta = database.courses.find((course) => course.title === betaTitle);
    const removable = database.courses.find((course) => course.title === removableTitle);
    assert(alpha && beta && removable, "Regression courses were not created");
    const courseList = await request("/admin/courses", { headers: { cookie: adminCookie } });
    assert(courseList.body.includes("admin-course-avatar") && !courseList.body.includes(alphaDescription), "Course list should show compact avatars and titles without descriptions");
    const homepageEditor = await request("/admin/homepage", { headers: { cookie: adminCookie } });
    assert(homepageEditor.body.includes("admin-course-avatar") && !homepageEditor.body.includes(alphaDescription), "Homepage editor should show compact course avatars without descriptions");
    const removableEditor = await request(`/admin/courses/${removable.id}`, { headers: { cookie: adminCookie } });
    assert(removableEditor.body.includes(`/admin/courses/${removable.id}/delete`), "Course editor does not offer deletion for an unused course");
    await expectRedirect(postForm(`/admin/courses/${removable.id}/delete`, {}, adminCookie), "/admin/courses");
    assert(!readDb().courses.some((course) => course.id === removable.id), "Unused course was not deleted");

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
    const secondMaterial = readDb().courses.find((course) => course.id === alpha.id).lessons[0].materials[1];
    await expectRedirect(postForm("/dashboard/materials/complete", { assignmentId: assignment.id, materialId: secondMaterial.id }, studentCookie), `/dashboard/courses/${assignment.id}`);
    const courseAfterVideo = await request(`/dashboard/courses/${assignment.id}`, { headers: { cookie: studentCookie } });
    assert(courseAfterVideo.body.includes("<video controls"), "Inline video player is not rendered in the student course");

    const question = readDb().courses.find((course) => course.id === alpha.id).test.questions[0];
    const testPage = await request(`/dashboard/tests/${assignment.id}`, { headers: { cookie: studentCookie } });
    assert(testPage.response.status === 200 && testPage.body.includes("Regression question"), "Student test is unavailable after materials");
    await expectRedirect(postForm(`/dashboard/tests/${assignment.id}`, { [question.id]: question.options[0].id }, studentCookie), `/dashboard/courses/${assignment.id}#test-result`);
    const resultPage = await request(`/dashboard/courses/${assignment.id}`, { headers: { cookie: studentCookie } });
    assert(resultPage.body.includes('id="test-result"'), "Test result anchor is missing");

    const audit = await request("/admin/audit", { headers: { cookie: adminCookie } });
    assert(audit.body.includes('href="/admin/audit/'), "Audit log does not include event detail links");
    const auditEvent = readDb().auditEvents.at(-1);
    const auditDetail = await request(`/admin/audit/${auditEvent.id}`, { headers: { cookie: adminCookie } });
    assert(auditDetail.response.status === 200 && auditDetail.body.includes("audit-detail"), "Audit details page is unavailable");

    console.log(`Regression test passed: ${assertions} assertions`);
    console.log(`Temporary JSON test database: ${dbPath}`);
  } finally {
    if (server) {
      await stopServer(server);
      if (server.exitCode && !serverOutput.includes("Marine LMS is ready")) process.stderr.write(serverOutput);
    }
  }
}

run().catch((error) => {
  console.error(`Regression test failed after ${assertions} assertions: ${error.message}`);
  process.exit(1);
});
