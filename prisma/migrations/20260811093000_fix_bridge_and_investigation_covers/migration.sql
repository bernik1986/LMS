UPDATE "Course"
SET
  "imageUrl" = '/assets/course-covers/catalog_bridge-team-and-resource-management_c7627137.png',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "id" = 'catalog_bridge-resource-management-and-bridge-team_4319e8ac'
  OR LOWER("title") = LOWER('BRIDGE TEAM AND RESOURCE MANAGEMENT');

UPDATE "Course"
SET
  "imageUrl" = '/assets/course-covers/catalog_incident-investigation_d219b1c0.png',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "id" = 'course_e481ef48'
  OR LOWER("title") = LOWER('Marine Incident Investigation');
