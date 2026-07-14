import {
  Award,
  BookOpenCheck,
  ClipboardList,
  FileCheck2,
  GraduationCap,
  UserRoundCheck
} from "lucide-react";

/** Mock data for the Next.js scaffold in src/app/. The live application uses data/db.json or PostgreSQL. */
export type CourseStatus = "active" | "inactive";
export type AssignmentStatus =
  | "not_started"
  | "in_progress"
  | "materials_completed"
  | "test_available"
  | "test_failed"
  | "completed";

export type DemoCourse = {
  id: string;
  title: string;
  shortDescription: string;
  status: CourseStatus;
  lessonsCount: number;
  requiredMaterialsCount: number;
  assignmentsCount: number;
};

export type DemoAssignment = {
  id: string;
  courseTitle: string;
  assignedAt: string;
  status: AssignmentStatus;
  progressPercent: number;
  testAvailable: boolean;
  testResult?: number;
};

export const platformStats = [
  {
    label: "New applications",
    value: "12",
    hint: "awaiting review",
    icon: ClipboardList
  },
  {
    label: "Active students",
    value: "48",
    hint: "have platform access",
    icon: UserRoundCheck
  },
  {
    label: "Active courses",
    value: "7",
    hint: "available to assign",
    icon: GraduationCap
  },
  {
    label: "Issued certificates",
    value: "136",
    hint: "all time",
    icon: Award
  }
];

export const demoCourses: DemoCourse[] = [
  {
    id: "maritime-safety-basics",
    title: "Basic Maritime Safety",
    shortDescription: "Basic onboard safety and mandatory procedures course.",
    status: "active",
    lessonsCount: 5,
    requiredMaterialsCount: 9,
    assignmentsCount: 28
  },
  {
    id: "first-aid-at-sea",
    title: "First Aid at Sea",
    shortDescription: "Maritime first aid course with a final test.",
    status: "active",
    lessonsCount: 6,
    requiredMaterialsCount: 12,
    assignmentsCount: 16
  },
  {
    id: "vessel-equipment-intro",
    title: "Vessel Equipment Introduction",
    shortDescription: "Introductory course on vessel equipment operations.",
    status: "inactive",
    lessonsCount: 4,
    requiredMaterialsCount: 7,
    assignmentsCount: 0
  }
];

export const demoAssignments: DemoAssignment[] = [
  {
    id: "assignment-1",
    courseTitle: "Basic Maritime Safety",
    assignedAt: "2026-06-10",
    status: "in_progress",
    progressPercent: 64,
    testAvailable: false
  },
  {
    id: "assignment-2",
    courseTitle: "First Aid at Sea",
    assignedAt: "2026-06-12",
    status: "test_available",
    progressPercent: 100,
    testAvailable: true
  },
  {
    id: "assignment-3",
    courseTitle: "Vessel Fire Safety Annual Check",
    assignedAt: "2026-05-03",
    status: "completed",
    progressPercent: 100,
    testAvailable: true,
    testResult: 92
  }
];

export const studentHighlights = [
  {
    label: "Assigned courses",
    value: "3",
    icon: BookOpenCheck
  },
  {
    label: "Available tests",
    value: "1",
    icon: ClipboardList
  },
  {
    label: "Certificates",
    value: "1",
    icon: FileCheck2
  }
];
