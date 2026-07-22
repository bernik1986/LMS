UPDATE "Course"
SET "imageUrl" = CASE "id"
  WHEN 'catalog_bridge-team-and-resource-management_c7627137' THEN '/assets/course-covers/catalog_bridge-team-and-resource-management_c7627137.png'
  WHEN 'catalog_cargo-handling_f2792b8f' THEN '/assets/course-covers/catalog_cargo-handling_f2792b8f.png'
  WHEN 'catalog_digital-publications_61225e1c' THEN '/assets/course-covers/catalog_digital-publications_61225e1c.png'
  WHEN 'catalog_engine-room-emergencies-recovery-from-a-bl_e494554a' THEN '/assets/course-covers/catalog_engine-room-emergencies-recovery-from-a-bl_e494554a.png'
  WHEN 'catalog_gas-measurement-measutring-instruments_38487aa7' THEN '/assets/course-covers/catalog_gas-measurement-measutring-instruments_38487aa7.png'
  WHEN 'wp_course_592' THEN '/assets/course-covers/wp_course_592.png'
  WHEN 'catalog_hazardous-atmosphere-monitoring_62140697' THEN '/assets/course-covers/catalog_hazardous-atmosphere-monitoring_62140697.png'
  WHEN 'wp_course_661' THEN '/assets/course-covers/wp_course_661.png'
  WHEN 'catalog_environmental-management-system_770be066' THEN '/assets/course-covers/catalog_environmental-management-system_770be066.png'
  WHEN 'catalog_media-response_5f4ecc4c' THEN '/assets/course-covers/catalog_media-response_5f4ecc4c.png'
  WHEN 'catalog_incident-investigation_d219b1c0' THEN '/assets/course-covers/catalog_incident-investigation_d219b1c0.png'
  WHEN 'catalog_search-and-rescue_acb32124' THEN '/assets/course-covers/catalog_search-and-rescue_acb32124.png'
  WHEN 'catalog_train-the-trainer_474f0954' THEN '/assets/course-covers/catalog_train-the-trainer_474f0954.png'
END
WHERE "id" IN (
  'catalog_bridge-team-and-resource-management_c7627137',
  'catalog_cargo-handling_f2792b8f',
  'catalog_digital-publications_61225e1c',
  'catalog_engine-room-emergencies-recovery-from-a-bl_e494554a',
  'catalog_gas-measurement-measutring-instruments_38487aa7',
  'wp_course_592',
  'catalog_hazardous-atmosphere-monitoring_62140697',
  'wp_course_661',
  'catalog_environmental-management-system_770be066',
  'catalog_media-response_5f4ecc4c',
  'catalog_incident-investigation_d219b1c0',
  'catalog_search-and-rescue_acb32124',
  'catalog_train-the-trainer_474f0954'
);
