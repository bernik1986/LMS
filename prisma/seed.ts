import { pbkdf2Sync, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/marine_lms?schema=public";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin123!";
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      id: "user_admin",
      email: adminEmail,
      passwordHash: hashPassword(adminPassword),
      firstNameEn: "Marine",
      lastNameEn: "Admin",
      role: "admin",
      position: "Administrator",
      company: "Marine Training Center",
      status: "active"
    }
  });

  const student = await prisma.user.upsert({
    where: { email: "student@example.com" },
    update: {},
    create: {
      id: "user_student",
      email: "student@example.com",
      passwordHash: hashPassword("Student123!"),
      firstNameEn: "Alex",
      lastNameEn: "Seafarer",
      birthDate: new Date("1995-04-12T00:00:00.000Z"),
      company: "Bluewater Crew",
      position: "Deck Cadet",
      phone: "+10000000002",
      status: "active"
    }
  });

  const course = await prisma.course.upsert({
    where: { id: "course_maritime_safety" },
    update: {},
    create: {
      id: "course_maritime_safety",
      title: "Basic Maritime Safety",
      shortDescription: "Базовый курс по безопасности на борту.",
      fullDescription: "Закрытый морской учебный курс с обязательными материалами и финальным тестом.",
      goals: "Познакомить студента с ключевыми правилами безопасности на борту.",
      requirements: "Просмотреть все обязательные материалы и сдать тест.",
      status: "active",
      isSequential: true,
      showOnHome: true,
      homeSortOrder: 1,
      certificateTemplateHtml: "<h1>Certificate of Completion</h1><p>{{fullName}}</p><p>{{courseTitle}}</p>",
      lessons: {
        create: [
          {
            id: "lesson_intro",
            title: "Как проходит курс",
            sortOrder: 1,
            materials: {
              create: [
                {
                  id: "material_intro_text",
                  type: "text",
                  title: "Правила прохождения",
                  content: "Материалы проходят последовательно. Тест откроется после завершения учебной части.",
                  sortOrder: 1
                }
              ]
            }
          }
        ]
      },
      test: {
        create: {
          id: "test_safety",
          title: "Финальный тест",
          passingPercent: 80,
          attemptsLimit: 3,
          questions: {
            create: [
              {
                id: "q_test_access",
                questionText: "Когда открывается финальный тест?",
                sortOrder: 1,
                options: {
                  create: [
                    {
                      id: "q1_o1",
                      optionText: "Сразу после назначения курса",
                      sortOrder: 1
                    },
                    {
                      id: "q1_o2",
                      optionText: "После прохождения обязательных материалов",
                      isCorrect: true,
                      sortOrder: 2
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    }
  });

  await prisma.courseAssignment.upsert({
    where: {
      userId_courseId: {
        userId: student.id,
        courseId: course.id
      }
    },
    update: {},
    create: {
      id: "assign_student_safety",
      userId: student.id,
      courseId: course.id,
      assignedById: admin.id,
      status: "not_started",
      materialProgress: {}
    }
  });

  await prisma.appSetting.upsert({
    where: { key: "settings" },
    update: {},
    create: {
      key: "settings",
      value: {
        homepageCourseSelectionEnabled: false,
        emailTemplates: {}
      }
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
