import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test, { after, before } from "node:test";
import sharp from "sharp";
import { startTestServer } from "../helpers/test-server.mjs";

let app;
let adminCookie;
let sourceCourseId;
let sourceLessonId;
let sourceMaterialId;
let sourceQuestionId;
let secondCourseId;
let mergedCourseId;

before(async () => {
  app = await startTestServer({ inProcess: true });
  adminCookie = await app.login("admin@example.com", "Admin123!");
  await app.cacheCsrf("/admin/courses", adminCookie);
});

after(async () => {
  await app?.stop();
});

test("course creation and update validate images and persist catalogue metadata", async () => {
  const invalid = await app.postMultipart(
    "/admin/courses/create",
    {
      title: "Rejected cover course",
      shortDescription: "This course must not be saved.",
      goals: "Validate uploads"
    },
    {
      imageFile: {
        name: "fake-course.jpg",
        type: "image/jpeg",
        buffer: Buffer.from("not an image")
      }
    },
    adminCookie
  );
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.text, /Upload a course image/i);
  assert.ok(!app.readDb().courses.some((course) => course.title === "Rejected cover course"));

  const cover = await sharp({
    create: {
      width: 640,
      height: 400,
      channels: 3,
      background: { r: 11, g: 82, b: 117 }
    }
  }).png().toBuffer();
  const create = await app.postMultipart(
    "/admin/courses/create",
    {
      title: "Automated Course Alpha",
      shortDescription: "Initial automated description",
      goals: "Create, edit, merge, and delete",
      oldPrice: "180",
      newPrice: "125",
      catalogCategory: "Safety",
      catalogPositions: ["Master", "Deck Officer"],
      showOnHome: "on",
      homeSortOrder: "4"
    },
    {
      imageFile: {
        name: "automated-course.png",
        type: "image/png",
        buffer: cover
      }
    },
    adminCookie
  );
  assert.equal(create.response.status, 303);
  assert.match(create.response.headers.get("location"), /^\/admin\/courses\/course_/);
  sourceCourseId = create.response.headers.get("location").split("/").at(-1);

  let course = app.readDb().courses.find((item) => item.id === sourceCourseId);
  assert.equal(course.title, "Automated Course Alpha");
  assert.equal(course.oldPrice, "180 USD");
  assert.equal(course.newPrice, "125 USD");
  assert.equal(course.showOnHome, true);
  assert.equal(course.homeSortOrder, 4);
  assert.equal(course.source.catalog.category, "Safety");
  assert.deepEqual(course.source.catalog.positions, ["Master", "Deck Officer"]);
  assert.match(course.imageUrl, /^\/uploads\/course_course_.*\.png$/);
  assert.ok(existsSync(`${app.uploadsDir}/${course.imageUrl.slice("/uploads/".length)}`));

  const editor = await app.request(`/admin/courses/${sourceCourseId}`, {
    headers: { cookie: adminCookie }
  });
  assert.equal(editor.response.status, 200);
  assert.match(editor.text, /Automated Course Alpha/);

  const publicPage = await app.request(`/courses/${sourceCourseId}`);
  assert.equal(publicPage.response.status, 200);
  assert.match(publicPage.text, /Automated Course Alpha/);

  const update = await app.postMultipart(
    `/admin/courses/${sourceCourseId}/update`,
    {
      title: "Automated Course Alpha Updated",
      shortDescription: "Updated short description",
      fullDescription: "Updated full course description.",
      goals: "Updated learning goals",
      oldPrice: "200",
      newPrice: "140",
      status: "active",
      catalogCategory: "Navigation",
      catalogPositions: ["Chief Mate", "2nd Mate"],
      homeSortOrder: "7",
      removeImage: "on"
    },
    {},
    adminCookie
  );
  assert.equal(update.response.status, 303);
  course = app.readDb().courses.find((item) => item.id === sourceCourseId);
  assert.equal(course.title, "Automated Course Alpha Updated");
  assert.equal(course.fullDescription, "Updated full course description.");
  assert.equal(course.oldPrice, "200 USD");
  assert.equal(course.newPrice, "140 USD");
  assert.equal(course.imageUrl, "");
  assert.equal(course.showOnHome, false);
  assert.equal(course.homeSortOrder, 7);
  assert.equal(course.source.catalog.category, "Navigation");
  assert.deepEqual(course.source.catalog.positions, ["Chief Mate", "2nd Mate"]);
});

test("lesson, material, test settings, and question CRUD preserve validation rules", async () => {
  const lessonCreate = await app.postForm(
    `/admin/courses/${sourceCourseId}/lessons/create`,
    {
      title: "Automated lesson",
      description: "Lesson created by the integration suite"
    },
    adminCookie
  );
  assert.equal(lessonCreate.response.status, 303);
  let course = app.readDb().courses.find((item) => item.id === sourceCourseId);
  let lesson = course.lessons.find((item) => item.title === "Automated lesson");
  assert.ok(lesson);
  sourceLessonId = lesson.id;

  const lessonUpdate = await app.postForm(
    `/admin/courses/${sourceCourseId}/lessons/${sourceLessonId}/update`,
    {
      title: "Automated lesson updated",
      description: "Updated lesson description",
      status: "inactive",
      sortOrder: "3"
    },
    adminCookie
  );
  assert.equal(lessonUpdate.response.status, 303);
  lesson = app.readDb().courses
    .find((item) => item.id === sourceCourseId)
    .lessons.find((item) => item.id === sourceLessonId);
  assert.equal(lesson.title, "Automated lesson updated");
  assert.equal(lesson.status, "inactive");
  assert.equal(lesson.sortOrder, 3);

  const materialCreate = await app.postMultipart(
    `/admin/courses/${sourceCourseId}/materials/create`,
    {
      lessonId: sourceLessonId,
      type: "text",
      title: "Automated reading",
      content: "Read this required learning material.",
      isRequired: "on"
    },
    {},
    adminCookie
  );
  assert.equal(materialCreate.response.status, 303);
  course = app.readDb().courses.find((item) => item.id === sourceCourseId);
  let material = course.lessons
    .find((item) => item.id === sourceLessonId)
    .materials.find((item) => item.title === "Automated reading");
  assert.ok(material);
  sourceMaterialId = material.id;
  assert.equal(material.isRequired, true);

  const materialUpdate = await app.postMultipart(
    `/admin/courses/${sourceCourseId}/materials/${sourceMaterialId}/update`,
    {
      type: "text",
      title: "Automated reading updated",
      content: "Updated multiline material.\nSecond line.",
      sortOrder: "5"
    },
    {},
    adminCookie
  );
  assert.equal(materialUpdate.response.status, 303);
  material = app.readDb().courses
    .find((item) => item.id === sourceCourseId)
    .lessons.find((item) => item.id === sourceLessonId)
    .materials.find((item) => item.id === sourceMaterialId);
  assert.equal(material.title, "Automated reading updated");
  assert.equal(material.content.replace(/\r\n/g, "\n"), "Updated multiline material.\nSecond line.");
  assert.equal(material.isRequired, false);
  assert.equal(material.sortOrder, 5);

  const invalidSettings = await app.postForm(
    `/admin/courses/${sourceCourseId}/test/settings`,
    {
      title: "Automated final assessment",
      attemptsLimit: "2",
      passingPercent: "75",
      timeLimitMinutes: "20",
      status: "active",
      showResultToUser: "on",
      allowRetake: "on"
    },
    adminCookie
  );
  assert.equal(invalidSettings.response.status, 303);
  assert.equal(app.readDb().courses.find((item) => item.id === sourceCourseId).test.status, "inactive");

  const invalidQuestion = await app.postForm(
    `/admin/courses/${sourceCourseId}/test/questions/create`,
    {
      questionText: "Question with one option",
      option1: "Only option",
      correct: "1"
    },
    adminCookie
  );
  assert.equal(invalidQuestion.response.status, 303);
  assert.equal(app.readDb().courses.find((item) => item.id === sourceCourseId).test.questions.length, 0);

  const questionCreate = await app.postForm(
    `/admin/courses/${sourceCourseId}/test/questions/create`,
    {
      questionText: "Which answer is correct?",
      option1: "First answer",
      option2: "Second answer",
      option3: "Third answer",
      correct: "2"
    },
    adminCookie
  );
  assert.equal(questionCreate.response.status, 303);
  course = app.readDb().courses.find((item) => item.id === sourceCourseId);
  let question = course.test.questions.find((item) => item.questionText === "Which answer is correct?");
  assert.ok(question);
  sourceQuestionId = question.id;
  assert.equal(question.options.length, 3);
  assert.equal(question.options.find((option) => option.isCorrect).optionText, "Second answer");

  const questionUpdate = await app.postForm(
    `/admin/courses/${sourceCourseId}/test/questions/${sourceQuestionId}/update`,
    {
      questionText: "Which updated answer is correct?",
      sortOrder: "4",
      optionId1: question.options[0].id,
      optionId2: question.options[1].id,
      option1: "Updated first",
      option2: "Updated second",
      correct: "1"
    },
    adminCookie
  );
  assert.equal(questionUpdate.response.status, 303);
  question = app.readDb().courses
    .find((item) => item.id === sourceCourseId)
    .test.questions.find((item) => item.id === sourceQuestionId);
  assert.equal(question.questionText, "Which updated answer is correct?");
  assert.equal(question.sortOrder, 4);
  assert.equal(question.options.find((option) => option.isCorrect).optionText, "Updated first");

  const activeSettings = await app.postForm(
    `/admin/courses/${sourceCourseId}/test/settings`,
    {
      title: "Automated final assessment",
      attemptsLimit: "2",
      passingPercent: "75",
      timeLimitMinutes: "20",
      status: "active",
      showResultToUser: "on",
      allowRetake: "on"
    },
    adminCookie
  );
  assert.equal(activeSettings.response.status, 303);
  const savedTest = app.readDb().courses.find((item) => item.id === sourceCourseId).test;
  assert.equal(savedTest.status, "active");
  assert.equal(savedTest.attemptsLimit, 2);
  assert.equal(savedTest.passingPercent, 75);
  assert.equal(savedTest.timeLimitMinutes, 20);

  const preview = await app.request(`/admin/courses/${sourceCourseId}/test/preview`, {
    headers: { cookie: adminCookie }
  });
  assert.equal(preview.response.status, 200);
  assert.match(preview.text, /Which updated answer is correct/);
  assert.match(preview.text, /Updated first/);
});

test("course merge clones lessons, materials, assessments, and source metadata", async () => {
  const secondCreate = await app.postMultipart(
    "/admin/courses/create",
    {
      title: "Automated Course Beta",
      shortDescription: "Second merge source",
      goals: "Provide a second source",
      oldPrice: "90",
      newPrice: "70",
      catalogCategory: "Engineering",
      catalogPositions: ["Engine Officer"]
    },
    {},
    adminCookie
  );
  assert.equal(secondCreate.response.status, 303);
  secondCourseId = secondCreate.response.headers.get("location").split("/").at(-1);

  const lessonCreate = await app.postForm(
    `/admin/courses/${secondCourseId}/lessons/create`,
    { title: "Beta lesson", description: "Second source lesson" },
    adminCookie
  );
  assert.equal(lessonCreate.response.status, 303);
  const betaLesson = app.readDb().courses.find((item) => item.id === secondCourseId).lessons[0];
  await app.postMultipart(
    `/admin/courses/${secondCourseId}/materials/create`,
    {
      lessonId: betaLesson.id,
      type: "text",
      title: "Beta material",
      content: "Second source material",
      isRequired: "on"
    },
    {},
    adminCookie
  );
  await app.postForm(
    `/admin/courses/${secondCourseId}/test/questions/create`,
    {
      questionText: "Beta merge question?",
      option1: "Yes",
      option2: "No",
      correct: "1"
    },
    adminCookie
  );

  const merge = await app.postForm(
    "/admin/courses/merge",
    {
      courseIds: [sourceCourseId, secondCourseId],
      title: "Combined Automated Course",
      shortDescription: "Combined by integration tests",
      oldPrice: "290",
      newPrice: "200",
      status: "active",
      testTitle: "Combined final test"
    },
    adminCookie
  );
  assert.equal(merge.response.status, 303);
  mergedCourseId = merge.response.headers.get("location").split("/").at(-1);

  const merged = app.readDb().courses.find((item) => item.id === mergedCourseId);
  assert.equal(merged.title, "Combined Automated Course");
  assert.deepEqual(merged.source.mergedFromCourseIds, [sourceCourseId, secondCourseId]);
  assert.equal(merged.lessons.length, 2);
  assert.equal(merged.test.questions.length, 2);
  assert.ok(merged.lessons.some((lesson) => lesson.title.includes("Automated Course Alpha Updated")));
  assert.ok(merged.lessons.some((lesson) => lesson.title.includes("Automated Course Beta")));
  const clonedMaterial = merged.lessons.flatMap((lesson) => lesson.materials).find((item) => item.title === "Automated reading updated");
  assert.ok(clonedMaterial);
  assert.notEqual(clonedMaterial.id, sourceMaterialId);
  assert.equal(clonedMaterial.source.mergedFromCourseId, sourceCourseId);
  assert.ok(merged.test.questions.every((question) => ![sourceQuestionId].includes(question.id)));

  const mergePage = await app.request(`/admin/courses/${mergedCourseId}`, {
    headers: { cookie: adminCookie }
  });
  assert.equal(mergePage.response.status, 200);
  assert.match(mergePage.text, /Combined Automated Course/);
});

test("nested resources and unused courses can be deleted, while referenced courses are protected", async () => {
  const blocked = await app.postForm(
    "/admin/courses/course_maritime_safety/delete",
    {},
    adminCookie
  );
  assert.equal(blocked.response.status, 409);
  assert.match(blocked.text, /cannot be deleted/i);
  assert.match(blocked.text, /assignments:/i);
  assert.ok(app.readDb().courses.some((course) => course.id === "course_maritime_safety"));

  const questionDelete = await app.postForm(
    `/admin/courses/${sourceCourseId}/test/questions/${sourceQuestionId}/delete`,
    {},
    adminCookie
  );
  assert.equal(questionDelete.response.status, 303);
  assert.equal(app.readDb().courses.find((item) => item.id === sourceCourseId).test.questions.length, 0);
  assert.equal(app.readDb().courses.find((item) => item.id === sourceCourseId).test.status, "inactive");

  const materialDelete = await app.postForm(
    `/admin/courses/${sourceCourseId}/materials/${sourceMaterialId}/delete`,
    {},
    adminCookie
  );
  assert.equal(materialDelete.response.status, 303);
  assert.equal(
    app.readDb().courses
      .find((item) => item.id === sourceCourseId)
      .lessons.find((item) => item.id === sourceLessonId)
      .materials.length,
    0
  );

  const lessonDelete = await app.postForm(
    `/admin/courses/${sourceCourseId}/lessons/${sourceLessonId}/delete`,
    {},
    adminCookie
  );
  assert.equal(lessonDelete.response.status, 303);
  assert.equal(app.readDb().courses.find((item) => item.id === sourceCourseId).lessons.length, 0);

  for (const courseId of [mergedCourseId, secondCourseId, sourceCourseId]) {
    const removed = await app.postForm(`/admin/courses/${courseId}/delete`, {}, adminCookie);
    assert.equal(removed.response.status, 303);
    assert.ok(!app.readDb().courses.some((course) => course.id === courseId));
    const missing = await app.request(`/admin/courses/${courseId}`, {
      headers: { cookie: adminCookie }
    });
    assert.equal(missing.response.status, 404);
  }
});
