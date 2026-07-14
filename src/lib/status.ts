import type { AssignmentStatus, CourseStatus } from "@/lib/mock-data";

export function getCourseStatusLabel(status: CourseStatus) {
  return status === "active" ? "Active" : "Inactive";
}

export function getAssignmentStatusLabel(status: AssignmentStatus) {
  const labels: Record<AssignmentStatus, string> = {
    not_started: "Not started",
    in_progress: "In progress",
    materials_completed: "Materials completed",
    test_available: "Test available",
    test_failed: "Test failed",
    completed: "Completed"
  };

  return labels[status];
}
