UPDATE "Course"
SET "imageUrl" = CASE "id"
  WHEN 'wp_course_595' THEN '/assets/course-covers/wp_course_595.png'
  WHEN 'wp_course_732' THEN '/assets/course-covers/wp_course_732.png'
  WHEN 'wp_course_162' THEN '/assets/course-covers/wp_course_162.png'
  WHEN 'wp_course_177' THEN '/assets/course-covers/wp_course_177.png'
  WHEN 'wp_course_168' THEN '/assets/course-covers/wp_course_168.png'
  WHEN 'wp_course_724' THEN '/assets/course-covers/wp_course_724.png'
  WHEN 'wp_course_589' THEN '/assets/course-covers/wp_course_589.png'
  WHEN 'wp_course_3519' THEN '/assets/course-covers/wp_course_3519.png'
  WHEN 'wp_course_3562' THEN '/assets/course-covers/wp_course_3562.png'
  WHEN 'wp_course_982' THEN '/assets/course-covers/wp_course_982.png'
  WHEN 'wp_course_180' THEN '/assets/course-covers/wp_course_180.png'
  WHEN 'wp_course_313' THEN '/assets/course-covers/wp_course_313.png'
  WHEN 'wp_course_174' THEN '/assets/course-covers/wp_course_174.png'
  WHEN 'wp_course_448' THEN '/assets/course-covers/wp_course_448.png'
  WHEN 'wp_course_986' THEN '/assets/course-covers/wp_course_986.png'
  WHEN 'wp_course_165' THEN '/assets/course-covers/wp_course_165.png'
  WHEN 'wp_course_984' THEN '/assets/course-covers/wp_course_984.png'
  WHEN 'wp_course_352' THEN '/assets/course-covers/wp_course_352.png'
  WHEN 'wp_course_159' THEN '/assets/course-covers/wp_course_159.png'
  WHEN 'course_first_aid' THEN '/assets/course-covers/course_first_aid.png'
  WHEN 'wp_course_316' THEN '/assets/course-covers/wp_course_316.png'
  WHEN 'wp_course_3516' THEN '/assets/course-covers/wp_course_3516.png'
  WHEN 'wp_course_326' THEN '/assets/course-covers/wp_course_326.png'
  WHEN 'wp_course_488' THEN '/assets/course-covers/wp_course_488.png'
  WHEN 'wp_course_3522' THEN '/assets/course-covers/wp_course_3522.png'
  WHEN 'wp_course_983' THEN '/assets/course-covers/wp_course_983.png'
  WHEN 'wp_course_605' THEN '/assets/course-covers/wp_course_605.png'
  WHEN 'wp_course_156' THEN '/assets/course-covers/wp_course_156.png'
  WHEN 'wp_course_3427' THEN '/assets/course-covers/wp_course_3427.png'
  WHEN 'wp_course_3478' THEN '/assets/course-covers/wp_course_3478.png'
  WHEN 'wp_course_338' THEN '/assets/course-covers/wp_course_338.png'
  WHEN 'wp_course_171' THEN '/assets/course-covers/wp_course_171.png'
  WHEN 'wp_course_3637' THEN '/assets/course-covers/wp_course_3637.png'
  WHEN 'wp_course_647' THEN '/assets/course-covers/wp_course_647.png'
END
WHERE "id" IN (
  'wp_course_595', 'wp_course_732', 'wp_course_162', 'wp_course_177', 'wp_course_168',
  'wp_course_724', 'wp_course_589', 'wp_course_3519', 'wp_course_3562', 'wp_course_982',
  'wp_course_180', 'wp_course_313', 'wp_course_174', 'wp_course_448', 'wp_course_986',
  'wp_course_165', 'wp_course_984', 'wp_course_352', 'wp_course_159', 'course_first_aid',
  'wp_course_316', 'wp_course_3516', 'wp_course_326', 'wp_course_488', 'wp_course_3522',
  'wp_course_983', 'wp_course_605', 'wp_course_156', 'wp_course_3427', 'wp_course_3478',
  'wp_course_338', 'wp_course_171', 'wp_course_3637', 'wp_course_647'
);
