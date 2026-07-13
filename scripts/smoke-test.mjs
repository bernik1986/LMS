import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "./env.mjs";
import { loadPrismaDb, resolveConnectionString } from "./prisma-db.mjs";

loadLocalEnv();

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const unique = Date.now();
const storageDriver = (process.env.LMS_STORAGE ?? (process.env.DATABASE_URL ? "prisma" : "json")).toLowerCase();
const usePrismaStorage = ["prisma", "postgres", "postgresql"].includes(storageDriver);
const dbPath = resolve(process.env.LMS_DB_PATH ?? "data/db.json");
const csrfTokens = new Map();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieFrom(response) {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function db() {
  if (usePrismaStorage) {
    return loadPrismaDb({ connectionString: resolveConnectionString() });
  }
  return JSON.parse(readFileSync(dbPath, "utf8"));
}

async function request(path, options = {}) {
  const response = await fetch(base + path, {
    redirect: "manual",
    ...options,
    headers: {
      ...(options.headers ?? {})
    }
  });
  const body = await response.text();
  return { response, body };
}

async function postForm(path, fields, cookie = "") {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  const csrfToken = csrfTokens.get(cookie);
  if (csrfToken && !form.has("_csrf")) form.set("_csrf", csrfToken);
  return request(path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: base,
      ...(cookie ? { cookie } : {})
    },
    body: form
  });
}

async function postMultipart(path, fields, file, cookie = "") {
  const boundary = `----marine-lms-smoke-${Date.now()}`;
  const parts = [];
  const protectedFields = { ...fields };
  const csrfToken = csrfTokens.get(cookie);
  if (csrfToken && !protectedFields._csrf) protectedFields._csrf = csrfToken;
  for (const [key, value] of Object.entries(protectedFields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.buffer);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return request(path, {
    method: "POST",
    headers: {
      cookie,
      origin: base,
      "content-type": `multipart/form-data; boundary=${boundary}`
    },
    body: Buffer.concat(parts)
  });
}

async function cacheCsrfToken(path, cookie) {
  const { response, body } = await request(path, { headers: { cookie } });
  const match = body.match(/name="_csrf" value="([^"]+)"/);
  assert(response.status === 200 && match, `CSRF token is unavailable on ${path}`);
  csrfTokens.set(cookie, match[1]);
}

async function login(email, password) {
  const { response } = await postForm("/login", { email, password });
  const cookie = cookieFrom(response);
  assert(cookie, `Login failed for ${email}`);
  return cookie;
}

async function run() {
  const home = await request("/");
  assert(home.response.status === 200, "Home page is not available");

  const adminCookie = await login("admin@example.com", "Admin123!");
  const studentCookie = await login("student@example.com", "Student123!");
  await cacheCsrfToken("/admin", adminCookie);
  await cacheCsrfToken("/dashboard", studentCookie);

  const studentDashboard = await request("/dashboard", { headers: { cookie: studentCookie } });
  assert(studentDashboard.body.includes("photo-warning"), "Student should see certificate photo warning");

  const email = `smoke.student.${unique}@example.com`;
  await postForm(
    "/admin/users/create",
    {
      firstNameEn: "Smoke",
      lastNameEn: "Student",
      birthDate: "1990-01-02",
      email,
      position: "Deck Officer",
      company: "",
      phone: "+10000000000",
      password: "SmokeStudent123!"
    },
    adminCookie
  );
  let database = await db();
  const user = database.users.find((item) => item.email === email);
  assert(user, "Admin user creation failed");

  await postForm("/admin/users/update", {
    id: user.id,
    firstNameEn: "Smoke",
    lastNameEn: "Updated",
    birthDate: "1991-03-04",
    email,
    position: "Chief Officer",
    company: "Blue Fleet",
    phone: "+10000000001"
  }, adminCookie);
  database = await db();
  assert(database.users.find((item) => item.id === user.id)?.position === "Chief Officer", "Admin user update failed");

  const courseTitle = `Smoke Course ${unique}`;
  await postForm("/admin/courses/create", {
    title: courseTitle,
    shortDescription: "Smoke course",
    goals: "Validate editor"
  }, adminCookie);
  database = await db();
  const course = database.courses.find((item) => item.title === courseTitle);
  assert(course, "Course creation failed");

  await postForm(`/admin/courses/${course.id}/lessons/create`, {
    title: "Smoke Lesson",
    description: "Smoke lesson"
  }, adminCookie);
  database = await db();
  let lesson = database.courses.find((item) => item.id === course.id).lessons[0];
  assert(lesson, "Lesson creation failed");

  await postMultipart(
    `/admin/courses/${course.id}/materials/create`,
    {
      lessonId: lesson.id,
      title: "Smoke File",
      type: "pdf",
      content: "",
      isRequired: "on"
    },
    { filename: "brief.txt", type: "text/plain", buffer: Buffer.from("Smoke file") },
    adminCookie
  );
  database = await db();
  lesson = database.courses.find((item) => item.id === course.id).lessons[0];
  assert(lesson.materials[0]?.content.startsWith("/uploads/"), "Material upload failed");

  await postForm("/admin/assignments/create", { userId: user.id, courseId: course.id }, adminCookie);
  database = await db();
  const assignment = database.assignments.find((item) => item.userId === user.id && item.courseId === course.id);
  assert(assignment, "Assignment creation failed");

  const notifications = await request("/admin/notifications?q=course", { headers: { cookie: adminCookie } });
  assert(notifications.body.includes("course_assigned"), "Notification search failed");

  console.log(`Smoke test passed against ${base}`);
  console.log("Run npm run reset:data after smoke testing if you want to clean generated demo records.");
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
