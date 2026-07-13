import {
  Award,
  BookOpenCheck,
  ClipboardList,
  FileCheck2,
  GraduationCap,
  UserRoundCheck
} from "lucide-react";

/** Mock-данные только для Next.js-каркаса в src/app/. Рабочее приложение использует data/db.json или PostgreSQL. */
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
    label: "Новые заявки",
    value: "12",
    hint: "ожидают обработки",
    icon: ClipboardList
  },
  {
    label: "Активные студенты",
    value: "48",
    hint: "имеют доступ к платформе",
    icon: UserRoundCheck
  },
  {
    label: "Активные курсы",
    value: "7",
    hint: "доступны для назначения",
    icon: GraduationCap
  },
  {
    label: "Выданные сертификаты",
    value: "136",
    hint: "за все время",
    icon: Award
  }
];

export const demoCourses: DemoCourse[] = [
  {
    id: "maritime-safety-basics",
    title: "Basic Maritime Safety",
    shortDescription: "Базовый курс по безопасности на борту и обязательным процедурам.",
    status: "active",
    lessonsCount: 5,
    requiredMaterialsCount: 9,
    assignmentsCount: 28
  },
  {
    id: "first-aid-at-sea",
    title: "First Aid at Sea",
    shortDescription: "Курс по первой помощи на море с финальным тестированием.",
    status: "active",
    lessonsCount: 6,
    requiredMaterialsCount: 12,
    assignmentsCount: 16
  },
  {
    id: "vessel-equipment-intro",
    title: "Vessel Equipment Introduction",
    shortDescription: "Вводный курс по работе с судовым оборудованием.",
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
    label: "Назначенные курсы",
    value: "3",
    icon: BookOpenCheck
  },
  {
    label: "Доступные тесты",
    value: "1",
    icon: ClipboardList
  },
  {
    label: "Сертификаты",
    value: "1",
    icon: FileCheck2
  }
];
