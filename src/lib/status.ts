import type { AssignmentStatus, CourseStatus } from "@/lib/mock-data";

export function getCourseStatusLabel(status: CourseStatus) {
  return status === "active" ? "Активен" : "Отключен";
}

export function getAssignmentStatusLabel(status: AssignmentStatus) {
  const labels: Record<AssignmentStatus, string> = {
    not_started: "Не начат",
    in_progress: "В процессе",
    materials_completed: "Материалы пройдены",
    test_available: "Тест доступен",
    test_failed: "Тест не сдан",
    completed: "Завершен"
  };

  return labels[status];
}
