import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import { startTestServer } from "../helpers/test-server.mjs";

let app;
let adminCookie;
let studentCookie;
let course;
let lesson;

before(async () => {
  app = await startTestServer({
    inProcess: true,
    env: {
      MAX_MATERIAL_UPLOAD_MB: "0.00003",
      MAX_VIDEO_UPLOAD_MB: "0.00004",
      MAX_REQUEST_BODY_MB: "1"
    }
  });
  const db = app.readDb();
  const student = db.users.find((user) => user.email === "student@example.com");
  const assignment = db.assignments.find((item) => item.userId === student.id);
  course = db.courses.find((item) => item.id === assignment.courseId);
  lesson = course.lessons[0];
  adminCookie = await app.login("admin@example.com", "Admin123!");
  studentCookie = await app.login("student@example.com", "Student123!");
  await app.cacheCsrf(`/admin/courses/${course.id}`, adminCookie);
  await app.cacheCsrf("/dashboard/profile", studentCookie);
});

after(async () => {
  await app?.stop();
});

test("material upload accepts detected safe content and rejects spoofed or oversized files", async () => {
  const validText = Buffer.from("safe text material");
  const accepted = await app.postMultipart(
    `/admin/courses/${course.id}/materials/create`,
    {
      lessonId: lesson.id,
      type: "text",
      title: "Verified upload",
      content: "",
      isRequired: "on"
    },
    {
      file: {
        name: "briefing.txt",
        type: "text/plain",
        buffer: validText
      }
    },
    adminCookie
  );
  assert.equal(accepted.response.status, 303);

  let db = app.readDb();
  let savedCourse = db.courses.find((item) => item.id === course.id);
  let material = savedCourse.lessons[0].materials.find((item) => item.title === "Verified upload");
  assert.match(material.content, /^\/uploads\/material_[a-z0-9-]+\.txt$/);
  const storedPath = `${app.uploadsDir}/${material.content.slice("/uploads/".length)}`;
  assert.ok(existsSync(storedPath));
  assert.deepEqual(readFileSync(storedPath), validText);

  await app.postMultipart(
    `/admin/courses/${course.id}/materials/create`,
    {
      lessonId: lesson.id,
      type: "pdf",
      title: "Spoofed PDF",
      content: "",
      isRequired: "on"
    },
    {
      file: {
        name: "malware.pdf",
        type: "application/pdf",
        buffer: Buffer.from("MZ executable content")
      }
    },
    adminCookie
  );
  await app.postMultipart(
    `/admin/courses/${course.id}/materials/create`,
    {
      lessonId: lesson.id,
      type: "text",
      title: "Oversized text",
      content: "",
      isRequired: "on"
    },
    {
      file: {
        name: "oversized.txt",
        type: "text/plain",
        buffer: Buffer.alloc(80, 0x61)
      }
    },
    adminCookie
  );

  db = app.readDb();
  savedCourse = db.courses.find((item) => item.id === course.id);
  const spoofed = savedCourse.lessons[0].materials.find((item) => item.title === "Spoofed PDF");
  const oversized = savedCourse.lessons[0].materials.find((item) => item.title === "Oversized text");
  assert.equal(spoofed.content, "");
  assert.equal(oversized.content, "");
});

test("assigned students can stream uploaded materials with byte ranges while anonymous access is denied", async () => {
  const db = app.readDb();
  const material = db.courses
    .find((item) => item.id === course.id)
    .lessons[0].materials.find((item) => item.title === "Verified upload");

  const anonymous = await app.request(material.content);
  assert.equal(anonymous.response.status, 403);

  const full = await app.request(material.content, { headers: { cookie: studentCookie } });
  assert.equal(full.response.status, 200);
  assert.equal(full.response.headers.get("accept-ranges"), "bytes");
  assert.equal(full.response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(full.body, Buffer.from("safe text material"));

  const range = await app.request(material.content, {
    headers: { cookie: studentCookie, range: "bytes=5-8" }
  });
  assert.equal(range.response.status, 206);
  assert.equal(range.response.headers.get("content-range"), "bytes 5-8/18");
  assert.deepEqual(range.body, Buffer.from("text"));

  const invalidRange = await app.request(material.content, {
    headers: { cookie: studentCookie, range: "bytes=50-80" }
  });
  assert.equal(invalidRange.response.status, 416);
  assert.equal(invalidRange.response.headers.get("content-range"), "bytes */18");
});

test("certificate photo upload validates file signatures and stores a valid image for the student", async () => {
  const invalid = await app.postMultipart(
    "/dashboard/profile/photo",
    {},
    {
      photo: {
        name: "fake.jpg",
        type: "image/jpeg",
        buffer: Buffer.from("this is not a jpeg")
      }
    },
    studentCookie
  );
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.text, /Upload an image file/i);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
  const valid = await app.postMultipart(
    "/dashboard/profile/photo",
    {},
    {
      photo: {
        name: "certificate-photo.png",
        type: "image/png",
        buffer: png
      }
    },
    studentCookie
  );
  assert.equal(valid.response.status, 303);
  assert.equal(valid.response.headers.get("location"), "/dashboard/profile");

  const student = app.readDb().users.find((user) => user.email === "student@example.com");
  assert.match(student.photoUrl, /^\/uploads\/user_student-\d+\.png$/);
  const stored = `${app.uploadsDir}/${student.photoUrl.slice("/uploads/".length)}`;
  assert.ok(existsSync(stored));
  assert.deepEqual(readFileSync(stored), png);

  const ownPhoto = await app.request(student.photoUrl, { headers: { cookie: studentCookie } });
  assert.equal(ownPhoto.response.status, 200);
  assert.equal(ownPhoto.response.headers.get("content-type"), "image/png");
  assert.deepEqual(ownPhoto.body, png);
});
