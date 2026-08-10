-- Add the empty Hazmat 1.45 course and its generated Maritime Portal cover.
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
  'course_0cf28602',
  'Hazmat 1.45',
  '',
  '',
  '',
  'Complete the required materials and pass the test.',
  '',
  '',
  'active',
  true,
  '/assets/course-covers/course_0cf28602.png',
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
  '{"catalog":{"category":"Safety","positions":["All Seafarers"]},"generatedCover":{"source":"exec-bef60304-0f0f-42cc-9800-bafae436e00a.png","style":"maritime-portal-manual"}}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Course" WHERE LOWER("title") = LOWER('Hazmat 1.45')
)
ON CONFLICT ("id") DO NOTHING;

UPDATE "Course"
SET "imageUrl" = '/assets/course-covers/course_0cf28602.png',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE LOWER("title") = LOWER('Hazmat 1.45')
  AND "imageUrl" = '';

WITH "targetCourse" AS (
  SELECT "id"
  FROM "Course"
  WHERE LOWER("title") = LOWER('Hazmat 1.45')
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
  'test_0cf28602',
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
