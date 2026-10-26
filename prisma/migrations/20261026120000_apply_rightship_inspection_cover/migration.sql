UPDATE "Course"
SET
  "imageUrl" = '/assets/course-covers/course_0bbe1e76.png',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'course_0bbe1e76'
  AND lower(trim("title")) = lower('Rightship Inspection');
