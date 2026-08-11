UPDATE "Course"
SET
  "imageUrl" = '/assets/course-covers/course_e32f6dc0.png',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "id" = 'course_e32f6dc0'
  OR LOWER("title") = LOWER('Gas measuring instruments use and calibration');
