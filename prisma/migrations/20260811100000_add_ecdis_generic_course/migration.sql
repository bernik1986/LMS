-- Add the empty ECDIS Generic course and its generated Maritime Portal cover.
INSERT INTO "Course" (
  "id",
  "title",
  "shortDescription",
  "fullDescription",
  "goals",
  "requirements",
  "oldPrice",
  "newPrice",
  "status",
  "isSequential",
  "imageUrl",
  "showOnHome",
  "homeSortOrder",
  "autoIssueCertificate",
  "certificateTemplateHtml",
  "source",
  "createdAt",
  "updatedAt"
)
SELECT
  'course_6bc52739',
  'ECDIS Generic',
  '',
  '',
  '',
  'Complete the required materials and pass the test.',
  '',
  '',
  'active',
  true,
  '/assets/course-covers/course_6bc52739.png',
  false,
  999,
  true,
  $certificate$<span class="eyebrow">Marine LMS Certificate</span>
<h1>Certificate of Completion</h1>
<p class="muted">This certifies that</p>
<div class="certificate-name">{{firstName}} {{lastName}}</div>
{{photoImage}}
<p class="muted">{{position}}</p>
<p>Date of birth: {{birthDate}}</p>
<p>successfully completed</p>
<h2>{{courseTitle}}</h2>
<p class="muted">Certificate No. {{certificateNumber}}</p>
<p class="muted">Issued: {{issuedAt}}</p>
<p class="muted">Valid until: {{expiresAt}}</p>
<p class="muted">Verification: {{verificationUrl}}</p>
{{qrCode}}$certificate$,
  '{"catalog":{"category":"Navigation","positions":["Master","Chief Mate","Deck Officer","2nd Mate"]},"generatedCover":{"source":"exec-3cdabcd9-581a-4d4b-929b-0524e5dea75e.png","style":"maritime-portal-manual"}}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Course" WHERE LOWER("title") = LOWER('ECDIS Generic')
)
ON CONFLICT ("id") DO NOTHING;

UPDATE "Course"
SET "imageUrl" = '/assets/course-covers/course_6bc52739.png',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE LOWER("title") = LOWER('ECDIS Generic')
  AND "imageUrl" = '';

WITH "targetCourse" AS (
  SELECT "id"
  FROM "Course"
  WHERE LOWER("title") = LOWER('ECDIS Generic')
  ORDER BY "createdAt", "id"
  LIMIT 1
)
INSERT INTO "Test" (
  "id",
  "courseId",
  "title",
  "description",
  "attemptsLimit",
  "passingPercent",
  "timeLimitMinutes",
  "showResultToUser",
  "allowRetake",
  "status"
)
SELECT
  'test_6bc52739',
  "id",
  'Final test',
  '',
  3,
  80,
  0,
  true,
  true,
  'active'
FROM "targetCourse"
WHERE NOT EXISTS (
    SELECT 1 FROM "Test" WHERE "Test"."courseId" = "targetCourse"."id"
  )
ON CONFLICT ("id") DO NOTHING;
