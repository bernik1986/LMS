UPDATE "Course"
SET
  "imageUrl" = '/assets/course-covers/course_4c9584bf.png',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'course_4c9584bf'
  AND lower(trim("title")) = lower('INERT GAS SYSTEM');
