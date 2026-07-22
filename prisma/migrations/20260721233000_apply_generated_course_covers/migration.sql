UPDATE "Course"
SET "imageUrl" = CASE "id"
  WHEN 'wp_course_728' THEN '/assets/course-covers/wp_course_728.png'
  WHEN 'course_maritime_safety' THEN '/assets/course-covers/course_maritime_safety.png'
  WHEN 'wp_course_3604' THEN '/assets/course-covers/wp_course_3604.png'
  WHEN 'wp_course_519' THEN '/assets/course-covers/wp_course_519.png'
  WHEN 'wp_course_730' THEN '/assets/course-covers/wp_course_730.png'
  WHEN 'wp_course_3413' THEN '/assets/course-covers/wp_course_3413.png'
  WHEN 'wp_course_742' THEN '/assets/course-covers/wp_course_742.png'
  WHEN 'wp_course_320' THEN '/assets/course-covers/wp_course_320.png'
  WHEN 'wp_course_513' THEN '/assets/course-covers/wp_course_513.png'
  WHEN 'wp_course_582' THEN '/assets/course-covers/wp_course_582.png'
  WHEN 'wp_course_497' THEN '/assets/course-covers/wp_course_497.png'
  WHEN 'wp_course_736' THEN '/assets/course-covers/wp_course_736.png'
  WHEN 'wp_course_959' THEN '/assets/course-covers/wp_course_959.png'
  WHEN 'wp_course_144' THEN '/assets/course-covers/wp_course_144.png'
  WHEN 'wp_course_720' THEN '/assets/course-covers/wp_course_720.png'
  WHEN 'wp_course_718' THEN '/assets/course-covers/wp_course_718.png'
  WHEN 'wp_course_431' THEN '/assets/course-covers/wp_course_431.png'
  WHEN 'wp_course_726' THEN '/assets/course-covers/wp_course_726.png'
  WHEN 'wp_course_288' THEN '/assets/course-covers/wp_course_288.png'
  WHEN 'wp_course_434' THEN '/assets/course-covers/wp_course_434.png'
  WHEN 'wp_course_738' THEN '/assets/course-covers/wp_course_738.png'
  WHEN 'wp_course_744' THEN '/assets/course-covers/wp_course_744.png'
  WHEN 'wp_course_516' THEN '/assets/course-covers/wp_course_516.png'
  WHEN 'wp_course_147' THEN '/assets/course-covers/wp_course_147.png'
  WHEN 'wp_course_150' THEN '/assets/course-covers/wp_course_150.png'
  WHEN 'wp_course_153' THEN '/assets/course-covers/wp_course_153.png'
  WHEN 'wp_course_961' THEN '/assets/course-covers/wp_course_961.png'
  WHEN 'wp_course_713' THEN '/assets/course-covers/wp_course_713.png'
  WHEN 'wp_course_442' THEN '/assets/course-covers/wp_course_442.png'
  WHEN 'wp_course_722' THEN '/assets/course-covers/wp_course_722.png'
END
WHERE "id" IN (
  'wp_course_728', 'course_maritime_safety', 'wp_course_3604', 'wp_course_519', 'wp_course_730',
  'wp_course_3413', 'wp_course_742', 'wp_course_320', 'wp_course_513', 'wp_course_582',
  'wp_course_497', 'wp_course_736', 'wp_course_959', 'wp_course_144', 'wp_course_720',
  'wp_course_718', 'wp_course_431', 'wp_course_726', 'wp_course_288', 'wp_course_434',
  'wp_course_738', 'wp_course_744', 'wp_course_516', 'wp_course_147', 'wp_course_150',
  'wp_course_153', 'wp_course_961', 'wp_course_713', 'wp_course_442', 'wp_course_722'
);
