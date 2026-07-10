import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { PDFDocument as PdfLibDocument, rgb, StandardFonts } from "pdf-lib";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { loadLocalEnv } from "./env.mjs";
import { loadPrismaDb, maskedConnectionString, replacePrismaDb, resolveConnectionString } from "./prisma-db.mjs";

loadLocalEnv();

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://${host}:${port}`;
const dbPath = resolve("data/db.json");
const uploadsDir = resolve("data/uploads");
const cssPath = resolve("src/app/globals.css");
const databaseUrl = resolveConnectionString();
const storageDriver = (process.env.LMS_STORAGE ?? (process.env.DATABASE_URL ? "prisma" : "json")).toLowerCase();
const usePrismaStorage = ["prisma", "postgres", "postgresql"].includes(storageDriver);
const maxMaterialUploadBytes = Number(process.env.MAX_MATERIAL_UPLOAD_MB ?? 25) * 1024 * 1024;
const maxVideoUploadBytes = Number(process.env.MAX_VIDEO_UPLOAD_MB ?? 512) * 1024 * 1024;
const maxPhotoUploadBytes = Number(process.env.MAX_PHOTO_UPLOAD_MB ?? 3) * 1024 * 1024;
const maxCourseImageUploadBytes = Number(process.env.MAX_COURSE_IMAGE_MB ?? 8) * 1024 * 1024;
const maxCertificateBackgroundUploadBytes = Number(process.env.MAX_CERTIFICATE_TEMPLATE_MB ?? 20) * 1024 * 1024;
const sessions = new Map();
const loginAttempts = new Map();
const csrfTokens = new Map();
let saveQueue = Promise.resolve();
let lastSaveError = null;

const baseCss = readFileSync(cssPath, "utf8");
const productCss = `
.auth-note { display: grid; gap: 6px; border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 14px; border-radius: var(--radius); }
.notice { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); color: var(--primary-strong); padding: 14px; }
.danger { color: #a23b3b; }
.stack { display: grid; gap: 16px; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.inline-form { display: inline-flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.inline-form input, .inline-form select { min-height: 36px; border: 1px solid var(--line); border-radius: var(--radius); padding: 8px 10px; }
.inline-form .field { display: inline-grid; gap: 4px; color: var(--muted); font-size: 12px; font-weight: 800; }
.inline-form .field input { min-width: 150px; }
.admin-user-list { display: grid; gap: 16px; }
.admin-user-card { display: grid; grid-template-columns: minmax(220px, 0.75fr) minmax(0, 1.45fr); gap: 18px; align-items: start; }
.admin-user-summary { display: grid; gap: 10px; }
.admin-edit-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
.course-cover { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border: 1px solid var(--line); border-radius: var(--radius); background: linear-gradient(135deg, var(--primary-soft), var(--surface-muted)); }
.course-cover.placeholder { display: grid; place-items: center; color: var(--primary-strong); font-weight: 850; }
.course-cover.thumb { width: 104px; min-width: 104px; }
.course-cover.editor { max-width: 420px; }
.course-title-cell { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 12px; align-items: center; }
.course-detail-side { display: grid; gap: 12px; min-width: min(320px, 100%); }
.course-public-hero { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr); gap: 24px; align-items: start; }
.course-public-cover { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--radius); border: 1px solid var(--line); box-shadow: var(--shadow); }
.course-meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.course-outline { display: grid; gap: 12px; }
.course-outline-item { border: 1px solid var(--line); border-radius: var(--radius); background: white; padding: 14px; }
.course-material-list { margin: 8px 0 0; padding-left: 18px; color: var(--muted); }
.assignment-chip { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-muted); padding: 10px 12px; }
.course-editor-list { display: grid; gap: 14px; }
.lesson-editor { display: grid; gap: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: white; padding: 16px; }
.material-editor { display: grid; gap: 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-muted); padding: 12px; }
.material-edit-grid { display: grid; grid-template-columns: minmax(170px, 1fr) minmax(120px, 0.45fr) minmax(180px, 1fr); gap: 10px; align-items: end; }
.checkbox-row { display: inline-flex; gap: 8px; align-items: center; font-weight: 800; color: var(--primary-strong); }
.link-line { color: var(--primary); font-weight: 800; word-break: break-word; }
.table-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.small-button { display: inline-flex; min-height: 34px; align-items: center; border: 1px solid var(--line); border-radius: var(--radius); background: white; color: var(--primary-strong); font-weight: 800; padding: 7px 10px; cursor: pointer; }
.small-button.primary { border-color: var(--primary); background: var(--primary); color: white; }
.small-button.warning { border-color: #f2d5a8; background: #fff7e8; color: var(--warning); }
.small-button.danger { border-color: #f2b8b8; background: #fff0f0; color: #a23b3b; }
.small-button:disabled { opacity: 0.55; cursor: not-allowed; }
.certificate { max-width: 900px; margin: 24px auto; border: 10px solid var(--primary); background: white; padding: 48px; text-align: center; box-shadow: var(--shadow); }
.certificate h1 { max-width: none; color: var(--primary-strong); font-size: clamp(36px, 6vw, 64px); }
.certificate-name { margin: 28px 0 8px; color: var(--accent); font-size: clamp(28px, 4vw, 46px); font-weight: 850; }
.certificate-photo { width: 118px; height: 150px; object-fit: cover; border: 4px solid var(--line); border-radius: var(--radius); margin: 22px auto 0; }
.certificate-qr { width: 126px; height: 126px; margin: 16px auto 0; }
.certificate-template { display: grid; gap: 14px; }
.certificate-template textarea { min-height: 300px; font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 13px; }
.certificate-preview-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.certificate-preview-frame { max-width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-muted); padding: 12px; }
.certificate.certificate-preview { width: 900px; margin: 0; box-shadow: none; transform: scale(0.72); transform-origin: top left; }
.certificate.visual-certificate-page { max-width: 1123px; border: 0; padding: 0; background: transparent; box-shadow: var(--shadow); }
.certificate.visual-certificate-page.certificate-preview { width: 1123px; transform: scale(0.62); transform-origin: top left; }
.visual-certificate { position: relative; width: 100%; aspect-ratio: 1123 / 794; overflow: hidden; background: #fff; background-size: cover; background-position: center; border: 1px solid var(--line); }
.visual-certificate.no-background { background: linear-gradient(135deg, #f8fbfd, #e7f1f8); }
.visual-certificate.has-pdf-background { background: #fff; }
.visual-cert-pdf-bg { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; z-index: 0; }
.visual-cert-field { position: absolute; z-index: 1; display: flex; align-items: center; justify-content: center; min-width: 24px; min-height: 18px; white-space: normal; line-height: 1.12; overflow: hidden; }
.visual-cert-field.is-stamp { z-index: 5; }
.visual-cert-field.align-left { justify-content: flex-start; text-align: left; }
.visual-cert-field.align-center { justify-content: center; text-align: center; }
.visual-cert-field.align-right { justify-content: flex-end; text-align: right; }
.visual-cert-field .certificate-photo, .visual-cert-field img, .visual-cert-field svg { width: 100%; height: 100%; max-width: 100%; max-height: 100%; object-fit: contain; margin: 0; border: 0; border-radius: 0; }
.certificate-designer-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 320px); gap: 16px; align-items: start; }
.certificate-designer-stage { overflow: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-muted); padding: 12px; }
.certificate-designer-canvas { position: relative; width: min(100%, 1123px); aspect-ratio: 1123 / 794; overflow: hidden; background: #fff; background-size: cover; background-position: center; border: 1px solid var(--line); box-shadow: var(--shadow); touch-action: none; }
.certificate-designer-canvas.no-background { background: linear-gradient(135deg, #f8fbfd, #dcecf6); }
.certificate-designer-canvas.has-pdf-background { background: #fff; }
.certificate-designer-pdf-bg { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; z-index: 0; }
.certificate-designer-field { position: absolute; z-index: 1; display: flex; align-items: center; justify-content: center; min-width: 24px; min-height: 18px; border: 1px dashed rgba(11, 79, 122, 0.6); background: rgba(255, 255, 255, 0.58); cursor: move; line-height: 1.1; overflow: hidden; user-select: none; }
.certificate-designer-field.is-stamp { z-index: 5; }
.certificate-designer-field.is-selected { border: 2px solid var(--accent); background: rgba(255, 255, 255, 0.78); box-shadow: 0 0 0 3px rgba(14, 159, 189, 0.18); }
.certificate-designer-field.is-hidden { opacity: 0.35; }
.certificate-designer-field.align-left { justify-content: flex-start; text-align: left; }
.certificate-designer-field.align-center { justify-content: center; text-align: center; }
.certificate-designer-field.align-right { justify-content: flex-end; text-align: right; }
.certificate-designer-tools { display: grid; gap: 12px; border: 1px solid var(--line); border-radius: var(--radius); background: white; padding: 14px; }
.certificate-designer-tools .field input, .certificate-designer-tools .field select { width: 100%; }
.certificate-designer-help { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-muted); padding: 10px; color: var(--muted); font-size: 13px; }
@media (max-width: 980px) { .certificate-designer-layout { grid-template-columns: 1fr; } }
.certificate-event-detail { max-width: 300px; color: var(--muted); font-size: 13px; }
.template-token-list { display: flex; flex-wrap: wrap; gap: 8px; }
.template-token-list code { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-muted); color: var(--primary-strong); padding: 5px 7px; }
.profile-photo { width: 132px; height: 132px; object-fit: cover; border: 4px solid var(--primary-soft); border-radius: var(--radius); background: var(--surface-muted); }
.photo-warning { border: 1px solid #f1c27d; border-left: 4px solid var(--warning); border-radius: var(--radius); background: #fff7e8; color: #70480f; padding: 14px; }
.lesson-list { display: grid; gap: 12px; }
.material-row { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; border: 1px solid var(--line); border-radius: var(--radius); background: white; padding: 14px; }
.quiz-option { display: flex; gap: 10px; align-items: center; border: 1px solid var(--line); border-radius: var(--radius); background: white; padding: 12px; }
.status-pill { display: inline-flex; width: fit-content; border-radius: 999px; background: var(--primary-soft); color: var(--primary-strong); font-size: 12px; font-weight: 850; padding: 6px 10px; }
@media (max-width: 820px) { .course-public-hero { grid-template-columns: 1fr; } }
@media print { .topbar, .sidebar, .actions, .button { display: none !important; } body { background: white; } .certificate { box-shadow: none; } }
`;

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = hashPassword(password, salt).split(":")[1];
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

function createSeedData() {
  const admin = {
    id: "user_admin",
    role: "admin",
    email: "admin@example.com",
    passwordHash: hashPassword("Admin123!"),
    firstNameEn: "Marine",
    lastNameEn: "Admin",
    birthDate: "",
    company: "Marine Training Center",
    position: "Administrator",
    phone: "+10000000001",
    photoUrl: "",
    status: "active",
    createdAt: now()
  };

  const student = {
    id: "user_student",
    role: "student",
    email: "student@example.com",
    passwordHash: hashPassword("Student123!"),
    firstNameEn: "Alex",
    lastNameEn: "Seafarer",
    birthDate: "1995-04-12",
    company: "Bluewater Crew",
    position: "Deck Cadet",
    phone: "+10000000002",
    photoUrl: "",
    status: "active",
    createdAt: now()
  };

  const safetyCourse = {
    id: "course_maritime_safety",
    title: "Basic Maritime Safety",
    shortDescription: "Базовый курс по безопасности на борту и обязательным процедурам.",
    fullDescription:
      "Закрытый морской курс с последовательным прохождением материалов, финальным тестом и сертификатом.",
    goals: "Подготовить студента к базовым процедурам безопасности на судне.",
    requirements: "Завершить обязательные материалы и сдать финальный тест.",
    status: "active",
    isSequential: true,
    imageUrl: "",
    showOnHome: true,
    homeSortOrder: 1,
    lessons: [
      {
        id: "lesson_intro",
        title: "Введение в безопасность на борту",
        description: "Общие правила и порядок прохождения курса.",
        sortOrder: 1,
        isRequired: true,
        status: "active",
        materials: [
          {
            id: "material_intro_text",
            type: "text",
            title: "Правила прохождения",
            content:
              "Материалы проходят последовательно. Финальный тест откроется после завершения обязательной учебной части.",
            isRequired: true,
            sortOrder: 1
          },
          {
            id: "material_intro_video",
            type: "video",
            title: "Safety briefing",
            content: "https://example.com/maritime-safety-briefing",
            isRequired: true,
            sortOrder: 2
          }
        ]
      },
      {
        id: "lesson_emergency",
        title: "Действия при аварийной ситуации",
        description: "Маршруты эвакуации, сигналы тревоги и сборные пункты.",
        sortOrder: 2,
        isRequired: true,
        status: "active",
        materials: [
          {
            id: "material_emergency_text",
            type: "text",
            title: "Алгоритм действий",
            content:
              "Студент должен знать сигналы тревоги, маршруты эвакуации и порядок доклада ответственному офицеру.",
            isRequired: true,
            sortOrder: 1
          }
        ]
      }
    ],
    test: {
      id: "test_safety",
      title: "Финальный тест по безопасности",
      description: "Проверка обязательных знаний после учебных материалов.",
      attemptsLimit: 3,
      passingPercent: 80,
      timeLimitMinutes: 0,
      showResultToUser: true,
      allowRetake: true,
      status: "active",
      questions: [
        {
          id: "q_test_access",
          questionText: "Когда студент получает доступ к финальному тесту?",
          sortOrder: 1,
          options: [
            { id: "q1_o1", optionText: "Сразу после назначения курса", isCorrect: false, sortOrder: 1 },
            {
              id: "q1_o2",
              optionText: "После завершения обязательных материалов",
              isCorrect: true,
              sortOrder: 2
            }
          ]
        },
        {
          id: "q_alarm",
          questionText: "Что нужно сделать при сигнале тревоги?",
          sortOrder: 2,
          options: [
            { id: "q2_o1", optionText: "Следовать утвержденному аварийному порядку", isCorrect: true, sortOrder: 1 },
            { id: "q2_o2", optionText: "Продолжить обычную работу", isCorrect: false, sortOrder: 2 }
          ]
        }
      ]
    },
    createdAt: now()
  };

  const firstAidCourse = {
    id: "course_first_aid",
    title: "First Aid at Sea",
    shortDescription: "Курс по первой помощи на море с финальным тестированием.",
    fullDescription: "Обязательные действия при травмах и неотложных состояниях на борту.",
    goals: "Закрепить порядок первичной помощи до прибытия медицинской поддержки.",
    requirements: "Завершить материалы и пройти тест.",
    status: "active",
    isSequential: true,
    imageUrl: "",
    showOnHome: true,
    homeSortOrder: 2,
    lessons: [
      {
        id: "lesson_aid_intro",
        title: "Первичная оценка состояния",
        description: "Безопасность места, оценка сознания, дыхания и кровотечения.",
        sortOrder: 1,
        isRequired: true,
        status: "active",
        materials: [
          {
            id: "material_aid_text",
            type: "text",
            title: "Первичный осмотр",
            content: "Проверьте безопасность, сознание, дыхание и наличие сильного кровотечения.",
            isRequired: true,
            sortOrder: 1
          }
        ]
      }
    ],
    test: {
      id: "test_first_aid",
      title: "Финальный тест по первой помощи",
      description: "Базовая проверка знаний.",
      attemptsLimit: 2,
      passingPercent: 75,
      timeLimitMinutes: 0,
      showResultToUser: true,
      allowRetake: true,
      status: "active",
      questions: [
        {
          id: "q_aid_1",
          questionText: "С чего начинается оказание первой помощи?",
          sortOrder: 1,
          options: [
            { id: "q_aid_1_o1", optionText: "С оценки безопасности места", isCorrect: true, sortOrder: 1 },
            { id: "q_aid_1_o2", optionText: "С заполнения отчета", isCorrect: false, sortOrder: 2 }
          ]
        }
      ]
    },
    createdAt: now()
  };

  return {
    users: [admin, student],
    applications: [
      {
        id: "app_demo",
        lastName: "Taylor",
        firstName: "Morgan",
        phone: "+10000000003",
        email: "morgan.taylor@example.com",
        courseId: safetyCourse.id,
        comment: "Need onboarding for deck crew.",
        status: "new",
        adminNote: "",
        createdAt: now()
      }
    ],
    courses: [safetyCourse, firstAidCourse],
    assignments: [
      {
        id: "assign_demo",
        userId: student.id,
        courseId: safetyCourse.id,
        assignedById: admin.id,
        status: "in_progress",
        assignedAt: now(),
        startedAt: now(),
        completedAt: "",
        progressPercent: 0,
        materialProgress: {}
      }
    ],
    testAttempts: [],
    certificates: [],
    notifications: [],
    auditEvents: [],
    certificateEvents: [],
    settings: {
      emailTemplates: defaultEmailTemplates()
    }
  };
}

function normalizeDb(data) {
  let changed = false;
  for (const user of data.users ?? []) {
    if (user.position === undefined) {
      user.position = user.role === "admin" ? "Administrator" : "Trainee";
      changed = true;
    }
    if (user.photoUrl === undefined) {
      user.photoUrl = "";
      changed = true;
    }
  }
  for (const course of data.courses ?? []) {
    if (course.imageUrl === undefined) {
      course.imageUrl = "";
      changed = true;
    }
    if (course.showOnHome === undefined) {
      course.showOnHome = false;
      changed = true;
    }
    if (!Number.isFinite(Number(course.homeSortOrder))) {
      course.homeSortOrder = 999;
      changed = true;
    }
    if (!course.certificateTemplateHtml) {
      course.certificateTemplateHtml = defaultCertificateTemplate();
      changed = true;
    }
  }
  for (const certificate of data.certificates ?? []) {
    if (!certificate.expiresAt) {
      certificate.expiresAt = addYearsIso(certificate.issuedAt, 5);
      changed = true;
    }
    if (!certificate.snapshotCertificateTemplateHtml) {
      certificate.snapshotCertificateTemplateHtml = defaultCertificateTemplate();
      changed = true;
    }
    if (!certificate.certificateHtml) {
      certificate.certificateHtml = renderCertificateTemplate(certificate, certificate.snapshotCertificateTemplateHtml);
      changed = true;
    }
  }
  if (!data.settings) {
    data.settings = {};
    changed = true;
  }
  if (data.settings.homepageCourseSelectionEnabled === undefined) {
    data.settings.homepageCourseSelectionEnabled = false;
    changed = true;
  }
  if (!Array.isArray(data.auditEvents)) {
    data.auditEvents = [];
    changed = true;
  }
  if (!Array.isArray(data.certificateEvents)) {
    data.certificateEvents = [];
    changed = true;
  }
  if (!data.settings.emailTemplates) {
    data.settings.emailTemplates = defaultEmailTemplates();
    changed = true;
  } else {
    const defaults = defaultEmailTemplates();
    for (const [type, template] of Object.entries(defaults)) {
      if (!data.settings.emailTemplates[type]) {
        data.settings.emailTemplates[type] = template;
        changed = true;
      }
    }
  }
  if (data.settings.defaultCertificateDesigner) {
    const normalizedDefaultDesigner = normalizeCertificateDesigner(data.settings.defaultCertificateDesigner);
    if (JSON.stringify(data.settings.defaultCertificateDesigner) !== JSON.stringify(normalizedDefaultDesigner)) {
      data.settings.defaultCertificateDesigner = normalizedDefaultDesigner;
      changed = true;
    }
  }
  return changed;
}

async function loadDb() {
  if (usePrismaStorage) {
    await saveQueue;
    if (lastSaveError) throw lastSaveError;
    const data = await loadPrismaDb({ connectionString: databaseUrl });
    if (!(data.users?.length || data.courses?.length)) {
      const seedData = createSeedData();
      normalizeDb(seedData);
      await replacePrismaDb(seedData, { connectionString: databaseUrl });
      return seedData;
    }
    const changed = normalizeDb(data);
    if (changed) saveDb(data);
    return data;
  }

  if (!existsSync(dbPath)) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const seedData = createSeedData();
    normalizeDb(seedData);
    writeFileSync(dbPath, JSON.stringify(seedData, null, 2), "utf8");
  }

  const data = JSON.parse(readFileSync(dbPath, "utf8"));
  const changed = normalizeDb(data);
  if (changed) {
    writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf8");
  }
  return data;
}

function cloneDb(data) {
  return JSON.parse(JSON.stringify(data));
}

function saveDb(data) {
  if (!usePrismaStorage) {
    writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf8");
    return;
  }

  const snapshot = cloneDb(data);
  const write = saveQueue
    .catch(() => {})
    .then(() => replacePrismaDb(snapshot, { connectionString: databaseUrl }));

  saveQueue = write
    .then(() => {
      lastSaveError = null;
    })
    .catch((error) => {
      lastSaveError = error;
      console.error("Failed to save LMS data to PostgreSQL:", error);
    });
}

let db = await loadDb();

function defaultCertificateTemplate() {
  return `<span class="eyebrow">Marine LMS Certificate</span>
<h1>Certificate of Completion</h1>
<p class="muted">This certifies that</p>
<div class="certificate-name">{{firstName}} {{lastName}}</div>
{{photoImage}}
<p class="muted">{{position}}</p>
<p>Date of birth: {{birthDate}}</p>
<p>successfully completed</p>
<h2>{{courseTitle}}</h2>
<p class="muted">Certificate No. {{certificateNumber}}</p>
<p class="muted">Issued: {{issuedAt}}</p>
<p class="muted">Valid until: {{expiresAt}}</p>
<p class="muted">Verification: {{verificationUrl}}</p>
{{qrCode}}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeCertificateTemplate(html) {
  return String(html)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
}

function addYearsIso(value, years) {
  const date = value ? new Date(value) : new Date();
  date.setFullYear(date.getFullYear() + years);
  return date.toISOString();
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("ru-RU") : "";
}

function dateInputValue(value = now()) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function parseIssueDateInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return now();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw
    ? null
    : date.toISOString();
}

function certificateVerificationUrl(certificate) {
  return new URL(`/verify/${encodeURIComponent(certificate.certificateNumber)}`, publicBaseUrl).toString();
}

function qrSvg(value) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M", margin: 1 });
  const size = qr.modules.size;
  const cells = qr.modules.data;
  const rects = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (cells[y * size + x]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
  }
  return `<svg class="certificate-qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="Certificate verification QR" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="#fff"/>${rects.join("")}</svg>`;
}

function certificateTemplateValues(certificate) {
  const photoUrl = certificate.snapshotPhotoUrl || "";
  const escapedPhotoUrl = escapeHtml(photoUrl);
  return {
    firstName: escapeHtml(certificate.snapshotFirstName),
    lastName: escapeHtml(certificate.snapshotLastName),
    fullName: escapeHtml(`${certificate.snapshotFirstName} ${certificate.snapshotLastName}`.trim()),
    birthDate: escapeHtml(formatDate(certificate.snapshotBirthDate)),
    position: escapeHtml(certificate.snapshotPosition || ""),
    company: escapeHtml(certificate.snapshotCompany || ""),
    courseTitle: escapeHtml(certificate.snapshotCourseTitle),
    certificateNumber: escapeHtml(certificate.certificateNumber),
    issuedAt: escapeHtml(formatDate(certificate.issuedAt)),
    expiresAt: escapeHtml(formatDate(certificate.expiresAt)),
    photoUrl: escapedPhotoUrl,
    photoImage: photoUrl ? `<img class="certificate-photo" src="${escapedPhotoUrl}" alt="Certificate photo" />` : "",
    verificationUrl: escapeHtml(certificateVerificationUrl(certificate)),
    qrCode: qrSvg(certificateVerificationUrl(certificate))
  };
}

function renderCertificateTemplate(certificate, template = "") {
  const values = certificateTemplateValues(certificate);
  const safeTemplate = sanitizeCertificateTemplate(template || defaultCertificateTemplate());
  return safeTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? "");
}

function certificateDesignerFieldDefinitions() {
  return [
    { key: "fullName", label: "Full name", x: 18, y: 34, width: 64, height: 8, fontSize: 42, color: "#0b4f7a", align: "center", fontWeight: "800", visible: true },
    { key: "courseTitle", label: "Course title", x: 19, y: 52, width: 62, height: 8, fontSize: 28, color: "#06395d", align: "center", fontWeight: "800", visible: true },
    { key: "birthDate", label: "Birth date", x: 24, y: 44, width: 24, height: 4, fontSize: 15, color: "#0d1b2a", align: "center", fontWeight: "500", visible: true },
    { key: "position", label: "Position", x: 52, y: 44, width: 24, height: 4, fontSize: 15, color: "#0d1b2a", align: "center", fontWeight: "500", visible: true },
    { key: "certificateNumber", label: "Certificate number", x: 18, y: 66, width: 28, height: 4, fontSize: 14, color: "#0d1b2a", align: "left", fontWeight: "600", visible: true },
    { key: "issuedAt", label: "Issued date", x: 18, y: 72, width: 20, height: 4, fontSize: 14, color: "#0d1b2a", align: "left", fontWeight: "500", visible: true },
    { key: "expiresAt", label: "Expires date", x: 18, y: 77, width: 20, height: 4, fontSize: 14, color: "#0d1b2a", align: "left", fontWeight: "500", visible: true },
    { key: "company", label: "Company", x: 39, y: 83, width: 22, height: 4, fontSize: 13, color: "#587087", align: "center", fontWeight: "500", visible: false },
    { key: "photoImage", label: "Student photo", x: 8, y: 31, width: 12, height: 19, fontSize: 12, color: "#0d1b2a", align: "center", fontWeight: "500", visible: true },
    { key: "qrCode", label: "QR code", x: 82, y: 68, width: 10, height: 14, fontSize: 12, color: "#0d1b2a", align: "center", fontWeight: "500", visible: true },
    { key: "verificationUrl", label: "Verification URL", x: 54, y: 86, width: 36, height: 4, fontSize: 10, color: "#587087", align: "right", fontWeight: "500", visible: false },
    { key: "stampImage", label: "Stamp", x: 70, y: 62, width: 14, height: 18, fontSize: 12, color: "#0d1b2a", align: "center", fontWeight: "500", visible: false }
  ];
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanColor(value, fallback = "#0d1b2a") {
  const text = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

function cleanAlign(value) {
  return ["left", "center", "right"].includes(value) ? value : "center";
}

function cleanFontWeight(value) {
  return ["400", "500", "600", "700", "800", "900"].includes(String(value)) ? String(value) : "700";
}

function cleanBackgroundUrl(value = "") {
  const text = String(value ?? "").trim();
  return text.startsWith("/uploads/") ? text : "";
}

function cleanStampUrl(value = "") {
  return cleanBackgroundUrl(value);
}

function certificateDesignerBackgroundIsPdf(backgroundUrl = "") {
  return String(backgroundUrl ?? "").split(/[?#]/)[0].toLowerCase().endsWith(".pdf");
}

function cleanBackgroundType(value = "", backgroundUrl = "") {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "pdf" || text === "image") return text;
  return certificateDesignerBackgroundIsPdf(backgroundUrl) ? "pdf" : "image";
}

function defaultCertificateDesigner(backgroundUrl = "", backgroundType = "", stampUrl = "") {
  const cleanUrl = cleanBackgroundUrl(backgroundUrl);
  return {
    version: 1,
    backgroundUrl: cleanUrl,
    backgroundType: cleanBackgroundType(backgroundType, cleanUrl),
    stampUrl: cleanStampUrl(stampUrl),
    fields: certificateDesignerFieldDefinitions()
  };
}

function normalizeCertificateDesigner(input = {}) {
  const existing = input && typeof input === "object" ? input : {};
  const backgroundUrl = cleanBackgroundUrl(existing.backgroundUrl);
  const stampUrl = cleanStampUrl(existing.stampUrl);
  const fieldsByKey = new Map((Array.isArray(existing.fields) ? existing.fields : []).map((field) => [field.key, field]));
  return {
    version: 1,
    backgroundUrl,
    backgroundType: cleanBackgroundType(existing.backgroundType, backgroundUrl),
    stampUrl,
    fields: certificateDesignerFieldDefinitions().map((definition) => {
      const field = fieldsByKey.get(definition.key) ?? {};
      return {
        key: definition.key,
        label: definition.label,
        x: clampNumber(field.x, 0, 98, definition.x),
        y: clampNumber(field.y, 0, 98, definition.y),
        width: clampNumber(field.width, 2, 100, definition.width),
        height: clampNumber(field.height, 2, 100, definition.height),
        fontSize: clampNumber(field.fontSize, 6, 96, definition.fontSize),
        color: cleanColor(field.color, definition.color),
        align: cleanAlign(field.align ?? definition.align),
        fontWeight: cleanFontWeight(field.fontWeight ?? definition.fontWeight),
        visible: field.visible === undefined ? definition.visible : Boolean(field.visible)
      };
    })
  };
}

function certificateDesignerForCourse(course) {
  return normalizeCertificateDesigner(course?.source?.certificateDesigner ?? db.settings?.defaultCertificateDesigner ?? {});
}

function defaultCertificateDesignerForNewCourse() {
  return db.settings?.defaultCertificateDesigner ? normalizeCertificateDesigner(db.settings.defaultCertificateDesigner) : null;
}

function defaultCertificateTemplateForNewCourse() {
  const designer = defaultCertificateDesignerForNewCourse();
  return designer ? certificateTemplateFromDesigner(designer) : defaultCertificateTemplate();
}

function defaultCertificateSourceForNewCourse() {
  const designer = defaultCertificateDesignerForNewCourse();
  return designer ? { certificateDesigner: designer } : undefined;
}

function applyCertificateDesignerToCourse(course, designerInput) {
  const designer = normalizeCertificateDesigner(designerInput);
  course.source ??= {};
  course.source.certificateDesigner = designer;
  course.certificateTemplateHtml = certificateTemplateFromDesigner(designer);
  course.certificateTemplateUpdatedAt = now();
}

function setDefaultCertificateDesigner(designerInput) {
  db.settings ??= {};
  db.settings.defaultCertificateDesigner = normalizeCertificateDesigner(designerInput);
}

function certificateDesignerFieldStyle(field) {
  return [
    `left:${field.x}%`,
    `top:${field.y}%`,
    `width:${field.width}%`,
    `height:${field.height}%`,
    `font-size:${field.fontSize}px`,
    `color:${field.color}`,
    `font-weight:${field.fontWeight}`,
    `text-align:${field.align}`
  ].join(";");
}

function certificateDesignerFieldClasses(field, baseClass) {
  const classes = [baseClass, `align-${field.align}`];
  if (field.key === "stampImage") classes.push("is-stamp");
  return classes.join(" ");
}

function certificateDesignerFieldsForRender(fields = []) {
  return [...fields].sort((a, b) => Number(a.key === "stampImage") - Number(b.key === "stampImage"));
}

function certificateDesignerToken(field, designer = {}) {
  if (field.key === "stampImage") {
    return designer.stampUrl ? `<img class="certificate-stamp" src="${escapeHtml(designer.stampUrl)}" alt="Stamp" />` : "";
  }
  return `{{${field.key}}}`;
}

function certificateTemplateFromDesigner(designerInput) {
  const designer = normalizeCertificateDesigner(designerInput);
  const hasBackground = Boolean(designer.backgroundUrl);
  const hasPdfBackground = hasBackground && designer.backgroundType === "pdf";
  const backgroundStyle = hasBackground && !hasPdfBackground
    ? ` style="background-image:url('${escapeHtml(designer.backgroundUrl)}')"`
    : "";
  const backgroundLayer = hasPdfBackground
    ? `<object class="visual-cert-pdf-bg" data="${escapeHtml(designer.backgroundUrl)}#toolbar=0&navpanes=0&scrollbar=0" type="application/pdf" aria-hidden="true"></object>`
    : "";
  const fields = certificateDesignerFieldsForRender(designer.fields.filter((field) => field.visible))
    .map((field) => `<div class="${certificateDesignerFieldClasses(field, "visual-cert-field")}" style="${certificateDesignerFieldStyle(field)}">${certificateDesignerToken(field, designer)}</div>`)
    .join("");
  return `<div class="visual-certificate${hasBackground ? "" : " no-background"}${hasPdfBackground ? " has-pdf-background" : ""}" data-visual-certificate="1" data-background-type="${hasPdfBackground ? "pdf" : "image"}" data-background-url="${escapeHtml(designer.backgroundUrl)}"${backgroundStyle}>${backgroundLayer}${fields}</div>`;
}

function certificateShellClass(certificateHtml, extra = "") {
  const classes = ["certificate"];
  if (extra) classes.push(extra);
  if (String(certificateHtml).includes("data-visual-certificate")) classes.push("visual-certificate-page");
  return classes.join(" ");
}

function saveCertificateDesignerBackground(course, file) {
  if (!file || typeof file === "string" || !file.buffer?.length) return { ok: true, skipped: true };
  const type = String(file.contentType ?? "").toLowerCase().split(";")[0];
  const ext = extname(file.filename || "").toLowerCase();
  const isPdf = type === "application/pdf" || ext === ".pdf";
  if (!isPdf && !imageUploadAllowed(file)) {
    return { ok: false, message: "Upload certificate background as PDF, JPG, PNG, WebP or GIF." };
  }
  const limit = isPdf ? maxCertificateBackgroundUploadBytes : maxCourseImageUploadBytes;
  if (file.buffer.length > limit) {
    return { ok: false, message: `Certificate background is too large. Maximum size: ${Math.round(limit / 1024 / 1024)} MB.` };
  }
  mkdirSync(uploadsDir, { recursive: true });
  const fileName = `certificate_template_${course.id}-${Date.now()}${isPdf ? ".pdf" : imageExtension(file)}`;
  writeFileSync(resolve(uploadsDir, fileName), file.buffer);
  return { ok: true, backgroundUrl: `/uploads/${fileName}`, backgroundType: isPdf ? "pdf" : "image" };
}

function saveCertificateDesignerStamp(course, file) {
  if (!file || typeof file === "string" || !file.buffer?.length) return { ok: true, skipped: true };
  if (!imageUploadAllowed(file)) {
    return { ok: false, message: "Upload stamp as JPG, PNG, WebP or GIF. Transparent PNG is recommended." };
  }
  if (file.buffer.length > maxCourseImageUploadBytes) {
    return { ok: false, message: `Stamp image is too large. Maximum size: ${Math.round(maxCourseImageUploadBytes / 1024 / 1024)} MB.` };
  }
  mkdirSync(uploadsDir, { recursive: true });
  const fileName = `certificate_stamp_${course.id}-${Date.now()}${imageExtension(file)}`;
  writeFileSync(resolve(uploadsDir, fileName), file.buffer);
  return { ok: true, stampUrl: `/uploads/${fileName}` };
}

function certificateDesignerEditorFieldHtml(field) {
  return `<div class="${certificateDesignerFieldClasses(field, "certificate-designer-field")} ${field.visible ? "" : "is-hidden"}" data-designer-field="${escapeHtml(field.key)}" style="${certificateDesignerFieldStyle(field)}">${escapeHtml(field.label)}</div>`;
}

function certificateDesignerEditorHtml(course, previewCertificate) {
  const designer = certificateDesignerForCourse(course);
  const designerJson = escapeHtml(JSON.stringify(designer));
  const hasPdfBackground = Boolean(designer.backgroundUrl) && designer.backgroundType === "pdf";
  const backgroundStyle = designer.backgroundUrl && !hasPdfBackground ? ` style="background-image:url('${escapeHtml(designer.backgroundUrl)}')"` : "";
  const backgroundLayer = hasPdfBackground
    ? `<object class="certificate-designer-pdf-bg" data="${escapeHtml(designer.backgroundUrl)}#toolbar=0&navpanes=0&scrollbar=0" type="application/pdf" aria-hidden="true"></object>`
    : "";
  const fieldOptions = designer.fields.map((field) => `<option value="${escapeHtml(field.key)}">${escapeHtml(field.label)}</option>`).join("");
  const previewClass = certificateShellClass(previewCertificate.certificateHtml, "certificate-preview");
  return `<article class="panel certificate-template">
        <h2>Visual certificate designer</h2>
        <p class="muted">Upload a certificate PDF or image, drag fields on the canvas, tune size and color, then save.</p>
        <form class="stack" method="post" action="/admin/courses/${course.id}/certificate-designer" enctype="multipart/form-data" data-certificate-designer>
          <textarea name="designerJson" data-designer-json hidden>${designerJson}</textarea>
          <div class="certificate-designer-layout">
            <div class="certificate-designer-stage">
              <div class="certificate-designer-canvas ${designer.backgroundUrl ? "" : "no-background"}${hasPdfBackground ? " has-pdf-background" : ""}" data-designer-canvas${backgroundStyle}>
                ${backgroundLayer}
                ${certificateDesignerFieldsForRender(designer.fields).map(certificateDesignerEditorFieldHtml).join("")}
              </div>
            </div>
            <div class="certificate-designer-tools">
              <div class="field"><label>Field</label><select data-field-select>${fieldOptions}</select></div>
              <label class="checkbox-row"><input type="checkbox" data-field-visible /> Show field</label>
              <div class="admin-edit-grid">
                <div class="field"><label>X %</label><input type="number" step="0.1" min="0" max="98" data-field-x /></div>
                <div class="field"><label>Y %</label><input type="number" step="0.1" min="0" max="98" data-field-y /></div>
                <div class="field"><label>Width %</label><input type="number" step="0.1" min="2" max="100" data-field-width /></div>
                <div class="field"><label>Height %</label><input type="number" step="0.1" min="2" max="100" data-field-height /></div>
              </div>
              <div class="admin-edit-grid">
                <div class="field"><label>Font size</label><input type="number" min="6" max="96" data-field-font-size /></div>
                <div class="field"><label>Color</label><input type="color" data-field-color /></div>
                <div class="field"><label>Align</label><select data-field-align><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></div>
                <div class="field"><label>Weight</label><select data-field-weight><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option><option value="800">800</option><option value="900">900</option></select></div>
              </div>
              <div class="field"><label>PDF or background image</label><input name="backgroundFile" type="file" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/gif" /></div>
              <div class="field"><label>Stamp image, always top layer</label><input name="stampFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></div>
              <label class="checkbox-row"><input name="removeStamp" type="checkbox" /> Remove stamp</label>
              <label class="checkbox-row"><input name="removeBackground" type="checkbox" /> Remove background</label>
              <label class="checkbox-row"><input name="resetDesigner" type="checkbox" /> Reset layout</label>
              <label class="checkbox-row"><input name="applyToAllCourses" type="checkbox" /> Apply this template to all courses and new courses</label>
              <button class="button" type="submit">Save visual template</button>
              <div class="certificate-designer-help">Drag fields with the mouse. Stamp is always rendered above text, photo and QR. Existing issued certificates keep their old snapshot.</div>
            </div>
          </div>
        </form>
        <div class="certificate-preview-actions">
          <a class="small-button primary" href="/admin/courses/${course.id}/certificate-template/preview">Open preview</a>
        </div>
        <div class="certificate-preview-frame">
          <div class="${previewClass}">${previewCertificate.certificateHtml}</div>
        </div>
        ${certificateDesignerScript()}
      </article>`;
}

function certificateDesignerScript() {
  return `<script>
(() => {
  const root = document.querySelector("[data-certificate-designer]");
  if (!root || root.dataset.ready === "1") return;
  root.dataset.ready = "1";
  const jsonInput = root.querySelector("[data-designer-json]");
  const canvas = root.querySelector("[data-designer-canvas]");
  const select = root.querySelector("[data-field-select]");
  const inputs = {
    visible: root.querySelector("[data-field-visible]"),
    x: root.querySelector("[data-field-x]"),
    y: root.querySelector("[data-field-y]"),
    width: root.querySelector("[data-field-width]"),
    height: root.querySelector("[data-field-height]"),
    fontSize: root.querySelector("[data-field-font-size]"),
    color: root.querySelector("[data-field-color]"),
    align: root.querySelector("[data-field-align]"),
    fontWeight: root.querySelector("[data-field-weight]")
  };
  let designer = JSON.parse(jsonInput.value || "{}");
  let selectedKey = designer.fields?.[0]?.key || "";
  const byKey = (key) => designer.fields.find((field) => field.key === key);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  function selected() { return byKey(selectedKey) || designer.fields[0]; }
  function fieldNode(key) { return canvas.querySelector('[data-designer-field="' + CSS.escape(key) + '"]'); }
  function applyField(field) {
    const node = fieldNode(field.key);
    if (!node) return;
    node.style.left = field.x + "%";
    node.style.top = field.y + "%";
    node.style.width = field.width + "%";
    node.style.height = field.height + "%";
    node.style.fontSize = field.fontSize + "px";
    node.style.color = field.color;
    node.style.fontWeight = field.fontWeight;
    node.style.textAlign = field.align;
    node.classList.toggle("is-hidden", !field.visible);
    node.classList.toggle("is-selected", field.key === selectedKey);
    node.classList.toggle("align-left", field.align === "left");
    node.classList.toggle("align-center", field.align === "center");
    node.classList.toggle("align-right", field.align === "right");
  }
  function syncPanel() {
    const field = selected();
    if (!field) return;
    select.value = field.key;
    inputs.visible.checked = !!field.visible;
    inputs.x.value = field.x;
    inputs.y.value = field.y;
    inputs.width.value = field.width;
    inputs.height.value = field.height;
    inputs.fontSize.value = field.fontSize;
    inputs.color.value = field.color;
    inputs.align.value = field.align;
    inputs.fontWeight.value = field.fontWeight;
    for (const item of designer.fields) applyField(item);
    jsonInput.value = JSON.stringify(designer);
  }
  function updateFromPanel() {
    const field = selected();
    if (!field) return;
    field.visible = inputs.visible.checked;
    field.x = clamp(inputs.x.value, 0, 98);
    field.y = clamp(inputs.y.value, 0, 98);
    field.width = clamp(inputs.width.value, 2, 100);
    field.height = clamp(inputs.height.value, 2, 100);
    field.fontSize = clamp(inputs.fontSize.value, 6, 96);
    field.color = inputs.color.value;
    field.align = inputs.align.value;
    field.fontWeight = inputs.fontWeight.value;
    syncPanel();
  }
  select.addEventListener("change", () => { selectedKey = select.value; syncPanel(); });
  Object.values(inputs).forEach((input) => input.addEventListener("input", updateFromPanel));
  Object.values(inputs).forEach((input) => input.addEventListener("change", updateFromPanel));
  canvas.addEventListener("pointerdown", (event) => {
    const node = event.target.closest("[data-designer-field]");
    if (!node) return;
    selectedKey = node.dataset.designerField;
    const field = selected();
    const rect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = field.x;
    const startTop = field.y;
    node.setPointerCapture(event.pointerId);
    syncPanel();
    const move = (moveEvent) => {
      field.x = clamp(startLeft + ((moveEvent.clientX - startX) / rect.width) * 100, 0, 98);
      field.y = clamp(startTop + ((moveEvent.clientY - startY) / rect.height) * 100, 0, 98);
      syncPanel();
    };
    const up = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  });
  root.addEventListener("submit", () => { jsonInput.value = JSON.stringify(designer); });
  syncPanel();
})();
</script>`;
}

function pdfText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function decodeHtmlText(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

function styleNumber(style = "", name, fallback = 0) {
  const match = String(style).match(new RegExp(`${name}\\s*:\\s*([0-9.]+)`));
  return match ? Number(match[1]) : fallback;
}

function styleText(style = "", name, fallback = "") {
  const match = String(style).match(new RegExp(`${name}\\s*:\\s*([^;]+)`));
  return match ? match[1].trim() : fallback;
}

function htmlAttributeValue(html = "", name = "") {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(html).match(pattern);
  return decodeHtmlText(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function drawQrOnPdf(doc, value, x, y, size) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M", margin: 1 });
  const cellSize = size / qr.modules.size;
  doc.save();
  doc.rect(x, y, size, size).fill("#ffffff");
  doc.fillColor("#0d1b2a");
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (qr.modules.data[row * qr.modules.size + column]) {
        doc.rect(x + column * cellSize, y + row * cellSize, cellSize, cellSize).fill();
      }
    }
  }
  doc.restore();
}

function uploadPathForRenderedUrl(value = "") {
  const text = String(value ?? "").split(/[?#]/)[0];
  if (!text.startsWith("/uploads/")) return "";
  return uploadPathFromPublicPath(text.slice("/uploads/".length));
}

function renderedCertificateBackgroundUrl(html = "") {
  const dataUrl = htmlAttributeValue(html, "data-background-url");
  if (dataUrl) return dataUrl;
  const embedMatch = String(html).match(/<(?:object|iframe)[^>]+(?:data|src)\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  if (embedMatch) return String(embedMatch[1] ?? embedMatch[2] ?? "").split(/[?#]/)[0];
  const backgroundMatch = String(html).match(/background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i);
  return backgroundMatch ? backgroundMatch[1] : "";
}

function renderedCertificateBackgroundType(html = "", backgroundUrl = "") {
  const type = htmlAttributeValue(html, "data-background-type").toLowerCase();
  if (type === "pdf" || type === "image") return type;
  return certificateDesignerBackgroundIsPdf(backgroundUrl) ? "pdf" : "image";
}

function pdfLibColor(value = "#0d1b2a") {
  const color = cleanColor(value, "#0d1b2a").slice(1);
  return rgb(
    parseInt(color.slice(0, 2), 16) / 255,
    parseInt(color.slice(2, 4), 16) / 255,
    parseInt(color.slice(4, 6), 16) / 255
  );
}

async function pdfLibCertificateFonts(pdfDoc) {
  const regularFontPath = "C:/Windows/Fonts/arial.ttf";
  const boldFontPath = "C:/Windows/Fonts/arialbd.ttf";
  try {
    if (existsSync(regularFontPath)) {
      pdfDoc.registerFontkit(fontkit);
      const regularFont = await pdfDoc.embedFont(readFileSync(regularFontPath), { subset: true });
      const boldFont = existsSync(boldFontPath)
        ? await pdfDoc.embedFont(readFileSync(boldFontPath), { subset: true })
        : regularFont;
      return { regularFont, boldFont };
    }
  } catch {
    // Fall back to built-in fonts if local font embedding is unavailable.
  }
  return {
    regularFont: await pdfDoc.embedFont(StandardFonts.Helvetica),
    boldFont: await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  };
}

async function embedPdfLibRasterImage(pdfDoc, imagePath) {
  if (!imagePath || !existsSync(imagePath)) return null;
  const bytes = readFileSync(imagePath);
  const ext = extname(imagePath).toLowerCase();
  try {
    if (ext === ".png" || (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
      return await pdfDoc.embedPng(bytes);
    }
    if ([".jpg", ".jpeg"].includes(ext) || (bytes[0] === 0xff && bytes[1] === 0xd8)) {
      return await pdfDoc.embedJpg(bytes);
    }
    const convertedPng = await sharp(bytes, { animated: false }).png().toBuffer();
    return await pdfDoc.embedPng(convertedPng);
  } catch {
    return null;
  }
}

function drawPdfLibImageFit(page, image, x, y, width, height) {
  if (!image || width <= 0 || height <= 0) return;
  const sourceWidth = image.width || width;
  const sourceHeight = image.height || height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  page.drawImage(image, {
    x: x + Math.max(0, (width - drawWidth) / 2),
    y: y + Math.max(0, (height - drawHeight) / 2),
    width: drawWidth,
    height: drawHeight
  });
}

function drawPdfLibText(page, text, options) {
  let value = pdfText(text);
  if (!value) return;
  const { x, y, width, height, font, fontSize, color, align } = options;
  let size = Math.max(6, Number(fontSize) || 12);
  let textWidth = 0;
  try {
    textWidth = font.widthOfTextAtSize(value, size);
  } catch {
    value = value.replace(/[^\x20-\x7E]/g, "?");
    textWidth = font.widthOfTextAtSize(value, size);
  }
  while (textWidth > width && size > 6) {
    size -= 0.5;
    textWidth = font.widthOfTextAtSize(value, size);
  }
  const drawX =
    align === "right"
      ? x + Math.max(0, width - textWidth)
      : align === "left"
        ? x
        : x + Math.max(0, (width - textWidth) / 2);
  const drawY = y + Math.max(0, (height - size) / 2);
  try {
    page.drawText(value, { x: drawX, y: drawY, size, font, color });
  } catch {
    const fallback = value.replace(/[^\x20-\x7E]/g, "?");
    page.drawText(fallback, { x: drawX, y: drawY, size, font, color });
  }
}

async function drawQrOnPdfLib(pdfDoc, page, value, x, y, size) {
  if (size <= 0) return;
  const qrBuffer = await QRCode.toBuffer(value, {
    errorCorrectionLevel: "M",
    margin: 1,
    type: "png",
    color: { dark: "#0d1b2a", light: "#ffffff" }
  });
  const qrImage = await pdfDoc.embedPng(qrBuffer);
  page.drawImage(qrImage, { x, y, width: size, height: size });
}

async function visualCertificatePdfBufferFromPdfTemplate(certificate, html, backgroundPath) {
  const pdfDoc = await PdfLibDocument.load(readFileSync(backgroundPath));
  const page = pdfDoc.getPageCount() > 0 ? pdfDoc.getPage(0) : pdfDoc.addPage([841.89, 595.28]);
  const { regularFont, boldFont } = await pdfLibCertificateFonts(pdfDoc);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const fontScale = Math.min(pageWidth / 1123, pageHeight / 794);

  const fieldPattern = /<div class="visual-cert-field[^"]*" style="([^"]+)">([\s\S]*?)<\/div>/g;
  for (const match of html.matchAll(fieldPattern)) {
    const style = match[1];
    const content = match[2];
    const x = (styleNumber(style, "left") / 100) * pageWidth;
    const top = (styleNumber(style, "top") / 100) * pageHeight;
    const width = (styleNumber(style, "width", 10) / 100) * pageWidth;
    const height = (styleNumber(style, "height", 5) / 100) * pageHeight;
    const y = pageHeight - top - height;
    const fontSize = styleNumber(style, "font-size", 12) * fontScale;
    const color = pdfLibColor(styleText(style, "color", "#0d1b2a"));
    const align = styleText(style, "text-align", "center");
    const fontWeight = Number(styleText(style, "font-weight", "500"));
    const font = fontWeight >= 700 ? boldFont : regularFont;

    const imageMatch = content.match(/<img[^>]+src="([^"]+)"/i);
    if (imageMatch) {
      const image = await embedPdfLibRasterImage(pdfDoc, uploadPathForRenderedUrl(imageMatch[1]));
      drawPdfLibImageFit(page, image, x, y, width, height);
      continue;
    }

    if (content.includes("certificate-qr")) {
      const qrSize = Math.min(width, height);
      await drawQrOnPdfLib(pdfDoc, page, certificateVerificationUrl(certificate), x + Math.max(0, (width - qrSize) / 2), y + Math.max(0, (height - qrSize) / 2), qrSize);
      continue;
    }

    drawPdfLibText(page, decodeHtmlText(content), { x, y, width, height, font, fontSize, color, align });
  }

  return Buffer.from(await pdfDoc.save());
}

function visualCertificatePdfKitBuffer(certificate, html) {
  return new Promise((resolvePdf, rejectPdf) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolvePdf(Buffer.concat(chunks)));
    doc.on("error", rejectPdf);

    const regularFont = "C:/Windows/Fonts/arial.ttf";
    const boldFont = "C:/Windows/Fonts/arialbd.ttf";
    if (existsSync(regularFont)) doc.font(regularFont);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const backgroundUrl = renderedCertificateBackgroundUrl(html);
    const backgroundPath = renderedCertificateBackgroundType(html, backgroundUrl) === "image" ? uploadPathForRenderedUrl(backgroundUrl) : "";
    if (backgroundPath && existsSync(backgroundPath)) {
      try {
        doc.image(backgroundPath, 0, 0, { width: pageWidth, height: pageHeight });
      } catch {
        doc.rect(0, 0, pageWidth, pageHeight).fill("#ffffff");
      }
    } else {
      doc.rect(0, 0, pageWidth, pageHeight).fill("#ffffff");
    }

    const fieldPattern = /<div class="visual-cert-field[^"]*" style="([^"]+)">([\s\S]*?)<\/div>/g;
    for (const match of html.matchAll(fieldPattern)) {
      const style = match[1];
      const content = match[2];
      const x = (styleNumber(style, "left") / 100) * pageWidth;
      const y = (styleNumber(style, "top") / 100) * pageHeight;
      const width = (styleNumber(style, "width", 10) / 100) * pageWidth;
      const height = (styleNumber(style, "height", 5) / 100) * pageHeight;
      const fontSize = styleNumber(style, "font-size", 12);
      const color = styleText(style, "color", "#0d1b2a");
      const align = styleText(style, "text-align", "center");
      const fontWeight = Number(styleText(style, "font-weight", "500"));

      const imageMatch = content.match(/<img[^>]+src="([^"]+)"/i);
      if (imageMatch) {
        const imagePath = uploadPathForRenderedUrl(imageMatch[1]);
        if (imagePath && existsSync(imagePath)) {
          try {
            doc.image(imagePath, x, y, { fit: [width, height], align: "center", valign: "center" });
          } catch {
            // Keep PDF generation resilient if an uploaded image format is not supported by PDFKit.
          }
        }
        continue;
      }

      if (content.includes("certificate-qr")) {
        drawQrOnPdf(doc, certificateVerificationUrl(certificate), x, y, Math.min(width, height));
        continue;
      }

      const text = decodeHtmlText(content);
      if (!text) continue;
      if (fontWeight >= 700 && existsSync(boldFont)) {
        doc.font(boldFont);
      } else if (existsSync(regularFont)) {
        doc.font(regularFont);
      }
      doc.fillColor(color).fontSize(fontSize).text(text, x, y + Math.max(0, (height - fontSize) / 2), {
        width,
        height,
        align: ["left", "right", "center"].includes(align) ? align : "center",
        lineBreak: false
      });
    }

    doc.end();
  });
}

function visualCertificatePdfBuffer(certificate) {
  const html = certificate.certificateHtml || renderCertificateTemplate(certificate, certificate.snapshotCertificateTemplateHtml || defaultCertificateTemplate());
  const backgroundUrl = renderedCertificateBackgroundUrl(html);
  const backgroundPath = uploadPathForRenderedUrl(backgroundUrl);
  if (renderedCertificateBackgroundType(html, backgroundUrl) === "pdf" && backgroundPath && existsSync(backgroundPath)) {
    return visualCertificatePdfBufferFromPdfTemplate(certificate, html, backgroundPath).catch((error) => {
      console.error("PDF certificate template generation failed:", error);
      return visualCertificatePdfKitBuffer(certificate, html);
    });
  }
  return visualCertificatePdfKitBuffer(certificate, html);
}

function certificatePdfBuffer(certificate) {
  if (String(certificate.certificateHtml || certificate.snapshotCertificateTemplateHtml || "").includes("data-visual-certificate")) {
    return visualCertificatePdfBuffer(certificate);
  }
  return new Promise((resolvePdf, rejectPdf) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 42 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolvePdf(Buffer.concat(chunks)));
    doc.on("error", rejectPdf);

    const fontPath = "C:/Windows/Fonts/arial.ttf";
    if (existsSync(fontPath)) {
      doc.font(fontPath);
    }

    doc.rect(24, 24, doc.page.width - 48, doc.page.height - 48).lineWidth(4).stroke("#0b4f7a");
    doc.fillColor("#06395d").fontSize(16).text("Marine LMS Certificate", { align: "center" });
    doc.moveDown(0.6);
    doc.fontSize(34).text("Certificate of Completion", { align: "center" });
    doc.moveDown(0.8);
    doc.fillColor("#587087").fontSize(13).text("This certifies that", { align: "center" });
    doc.moveDown(0.3);
    doc.fillColor("#0e9fbd").fontSize(28).text(pdfText(`${certificate.snapshotFirstName} ${certificate.snapshotLastName}`), { align: "center" });
    doc.fillColor("#0d1b2a").fontSize(12).text(`Date of birth: ${formatDate(certificate.snapshotBirthDate)}`, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(13).text("successfully completed", { align: "center" });
    doc.moveDown(0.2);
    doc.fillColor("#06395d").fontSize(23).text(pdfText(certificate.snapshotCourseTitle), { align: "center" });
    doc.moveDown(0.8);
    doc.fillColor("#0d1b2a").fontSize(11).text(`Certificate No. ${certificate.certificateNumber}`, { align: "center" });
    doc.text(`Issued: ${formatDate(certificate.issuedAt)}   Valid until: ${formatDate(certificate.expiresAt)}`, { align: "center" });
    doc.text(`Verification: ${certificateVerificationUrl(certificate)}`, { align: "center" });

    const qr = QRCode.create(certificateVerificationUrl(certificate), { errorCorrectionLevel: "M", margin: 1 });
    const qrSize = 92;
    const cellSize = qrSize / qr.modules.size;
    const startX = doc.page.width - 140;
    const startY = doc.page.height - 150;
    doc.rect(startX - 8, startY - 8, qrSize + 16, qrSize + 16).fillAndStroke("#ffffff", "#d5e4ef");
    doc.fillColor("#0d1b2a");
    for (let y = 0; y < qr.modules.size; y += 1) {
      for (let x = 0; x < qr.modules.size; x += 1) {
        if (qr.modules.data[y * qr.modules.size + x]) {
          doc.rect(startX + x * cellSize, startY + y * cellSize, cellSize, cellSize).fill();
        }
      }
    }

    const photoPath = certificate.snapshotPhotoUrl?.startsWith("/uploads/")
      ? uploadPathFromPublicPath(certificate.snapshotPhotoUrl.slice("/uploads/".length))
      : "";
    if (photoPath && existsSync(photoPath)) {
      try {
        doc.image(photoPath, 62, doc.page.height - 172, { fit: [82, 106] });
      } catch {
        // Ignore unsupported image formats in PDF export; HTML certificate still shows the photo.
      }
    }

    doc.end();
  });
}

function textFromFormFile(file) {
  if (!file || typeof file === "string" || !file.buffer?.length) return "";
  if (file.buffer.length > 1024 * 1024) return "";
  return file.buffer.toString("utf8");
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function notificationInitialStatus() {
  return smtpConfigured() ? "queued" : "logged";
}

function defaultEmailTemplates() {
  return {
    new_application: {
      subject: "New course application",
      body: "Marine LMS\n\nNew application received.\n\n{{payload}}\n\nDate: {{date}}"
    },
    course_assigned: {
      subject: "Course assigned",
      body: "Marine LMS\n\nYou have been assigned to a course.\n\n{{payload}}\n\nLogin: {{platformUrl}}/login"
    },
    certificate_available: {
      subject: "Certificate available",
      body: "Marine LMS\n\nYour certificate is available.\n\n{{payload}}\n\nOpen your dashboard: {{platformUrl}}/dashboard/certificates"
    },
    certificate_manual_issue: {
      subject: "Certificate manually issued",
      body: "Marine LMS\n\nA certificate was issued by administrator.\n\n{{payload}}\n\nOpen your dashboard: {{platformUrl}}/dashboard/certificates"
    },
    certificate_resent: {
      subject: "Certificate resent",
      body: "Marine LMS\n\nCertificate notification was sent again.\n\n{{payload}}"
    },
    certificate_revoked: {
      subject: "Certificate revoked",
      body: "Marine LMS\n\nA certificate was revoked.\n\n{{payload}}"
    },
    certificate_reissued: {
      subject: "Certificate reissued",
      body: "Marine LMS\n\nA certificate was reissued.\n\n{{payload}}"
    },
    password_reset: {
      subject: "Password reset",
      body: "Marine LMS\n\nYour temporary password was reset.\n\n{{payload}}\n\nLogin: {{platformUrl}}/login"
    },
    password_recovery: {
      subject: "Password recovery",
      body: "Marine LMS\n\nTemporary password: {{temporaryPassword}}\n\nPlease log in and change it in your profile.\n\nLogin: {{platformUrl}}/login"
    },
    password_changed: {
      subject: "Password changed",
      body: "Marine LMS\n\nYour password was changed.\n\n{{payload}}"
    },
    import_video_auto_link: {
      subject: "Video auto-link report",
      body: "Marine LMS\n\n{{payload}}\n\nOpen files report: {{platformUrl}}/admin/files"
    },
    photo_required_for_certificate: {
      subject: "Photo required for certificate",
      body: "Marine LMS\n\nPhoto is required before your certificate can be issued.\n\n{{payload}}\n\nProfile: {{platformUrl}}/dashboard/profile"
    },
    pending_certificates_issued: {
      subject: "Pending certificate issued",
      body: "Marine LMS\n\nPending certificate was issued after photo upload.\n\n{{payload}}"
    },
    smtp_test: {
      subject: "SMTP test",
      body: "Marine LMS\n\nThis is a test email from the admin panel.\n\n{{payload}}\n\nDate: {{date}}"
    }
  };
}

function renderTextTemplate(template = "", values = {}) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? "");
}

function emailTemplate(note) {
  const template = db.settings?.emailTemplates?.[note.type] ?? defaultEmailTemplates()[note.type];
  const values = {
    payload: note.payload || "",
    recipientEmail: note.recipientEmail || "",
    date: formatDate(note.createdAt || now()),
    platformUrl: publicBaseUrl,
    type: note.type || "",
    temporaryPassword: note.temporaryPassword || ""
  };
  const subject = renderTextTemplate(template?.subject ?? "Marine LMS notification", values);
  return {
    subject,
    body: renderTextTemplate(
      template?.body ?? `Marine LMS\n\n{{payload}}\n\nRecipient: {{recipientEmail}}\nDate: {{date}}`,
      values
    )
  };
}

function waitSmtpResponse(socket) {
  let buffer = "";
  return () =>
    new Promise((resolveResponse, rejectResponse) => {
      const onData = (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        const last = lines.at(-1) ?? "";
        if (/^\d{3} /.test(last)) {
          socket.off("data", onData);
          socket.off("error", onError);
          const responseText = buffer;
          buffer = "";
          resolveResponse(responseText);
        }
      };
      const onError = (error) => {
        socket.off("data", onData);
        rejectResponse(error);
      };
      socket.on("data", onData);
      socket.once("error", onError);
    });
}

function writeSmtpLine(socket, line) {
  socket.write(`${line}\r\n`);
}

async function sendSmtpMail({ to, subject, body }) {
  const hostName = process.env.SMTP_HOST;
  const portNumber = Number(process.env.SMTP_PORT ?? (process.env.SMTP_SECURE === "true" ? 465 : 587));
  const secure = process.env.SMTP_SECURE === "true";
  const rejectUnauthorized = process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false";
  const from = process.env.SMTP_FROM;
  let socket = secure
    ? tlsConnect({ host: hostName, port: portNumber, servername: hostName, rejectUnauthorized })
    : netConnect({ host: hostName, port: portNumber });

  await new Promise((resolveSocket, rejectSocket) => {
    socket.once(secure ? "secureConnect" : "connect", resolveSocket);
    socket.once("error", rejectSocket);
  });

  let readResponse = waitSmtpResponse(socket);
  await readResponse();
  writeSmtpLine(socket, `EHLO ${host}`);
  await readResponse();

  if (!secure && process.env.SMTP_STARTTLS === "true") {
    writeSmtpLine(socket, "STARTTLS");
    await readResponse();
    socket = tlsConnect({ socket, servername: hostName, rejectUnauthorized });
    await new Promise((resolveSocket, rejectSocket) => {
      socket.once("secureConnect", resolveSocket);
      socket.once("error", rejectSocket);
    });
    readResponse = waitSmtpResponse(socket);
    writeSmtpLine(socket, `EHLO ${host}`);
    await readResponse();
  }

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    writeSmtpLine(socket, "AUTH LOGIN");
    await readResponse();
    writeSmtpLine(socket, Buffer.from(process.env.SMTP_USER).toString("base64"));
    await readResponse();
    writeSmtpLine(socket, Buffer.from(process.env.SMTP_PASS).toString("base64"));
    await readResponse();
  }

  writeSmtpLine(socket, `MAIL FROM:<${from}>`);
  await readResponse();
  writeSmtpLine(socket, `RCPT TO:<${to}>`);
  await readResponse();
  writeSmtpLine(socket, "DATA");
  await readResponse();
  const safeBody = body.replace(/^\./gm, "..");
  socket.write(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${safeBody}\r\n.\r\n`);
  await readResponse();
  writeSmtpLine(socket, "QUIT");
  socket.end();
}

async function deliverNotification(note) {
  if (!smtpConfigured()) {
    note.status = "logged";
    return;
  }
  const message = emailTemplate(note);
  try {
    await sendSmtpMail({ to: note.recipientEmail, subject: message.subject, body: message.body });
    note.status = "sent";
    note.sentAt = now();
    note.errorMessage = "";
  } catch (error) {
    note.status = "failed";
    note.errorMessage = error.message;
  }
}

async function deliverPendingNotifications() {
  for (const note of db.notifications.filter((item) => ["queued", "failed"].includes(item.status))) {
    await deliverNotification(note);
  }
}

function getCookie(request, name) {
  const cookies = request.headers.cookie?.split(";").map((item) => item.trim()) ?? [];
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}

function clientIp(request) {
  return request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}

function sameOriginPost(request) {
  const proto = request.headers["x-forwarded-proto"] || "http";
  const expected = `${proto}://${request.headers.host}`;
  const origin = request.headers.origin;
  if (origin && origin !== expected) return false;
  const referer = request.headers.referer;
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  return true;
}

function loginRateLimited(request) {
  const key = clientIp(request);
  const windowMs = 10 * 60 * 1000;
  const limit = 8;
  const current = Date.now();
  const bucket = loginAttempts.get(key) ?? [];
  const recent = bucket.filter((timestamp) => current - timestamp < windowMs);
  recent.push(current);
  loginAttempts.set(key, recent);
  return recent.length > limit;
}

function clearLoginRateLimit(request) {
  loginAttempts.delete(clientIp(request));
}

function sessionUserId(sessionRecord) {
  return typeof sessionRecord === "string" ? sessionRecord : sessionRecord?.userId;
}

function currentUser(request) {
  const sessionId = getCookie(request, "sid");
  const userId = sessionUserId(sessions.get(sessionId));
  return db.users.find((user) => user.id === userId && user.status === "active") ?? null;
}

function csrfTokenFor(user) {
  if (!user) return "";
  if (!csrfTokens.has(user.id)) {
    csrfTokens.set(user.id, randomBytes(32).toString("hex"));
  }
  return csrfTokens.get(user.id);
}

function csrfInput(user) {
  return user ? `<input type="hidden" name="_csrf" value="${csrfTokenFor(user)}" />` : "";
}

function injectCsrfTokens(user, html) {
  if (!user) return html;
  return html.replace(/(<form\b[^>]*\bmethod=["']post["'][^>]*>)/gi, `$1${csrfInput(user)}`);
}

function csrfFormValid(user, form) {
  if (!user) return true;
  return form.get("_csrf")?.toString() === csrfTokenFor(user);
}

async function parseBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const contentType = request.headers["content-type"] ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    return parseMultipart(buffer, contentType);
  }
  return new URLSearchParams(buffer.toString("utf8"));
}

function parseMultipart(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  const form = new Map();
  if (!boundary) return form;

  const raw = buffer.toString("binary");
  const parts = raw.split(`--${boundary}`).slice(1, -1);
  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const separatorIndex = trimmed.indexOf("\r\n\r\n");
    if (separatorIndex === -1) continue;

    const headerBlock = trimmed.slice(0, separatorIndex);
    const content = trimmed.slice(separatorIndex + 4);
    const disposition = headerBlock.match(/content-disposition:[^\r\n]+/i)?.[0] ?? "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;

    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    const contentTypeHeader = headerBlock.match(/content-type:\s*([^\r\n]+)/i)?.[1] ?? "application/octet-stream";
    if (filename) {
      form.set(name, {
        filename,
        contentType: contentTypeHeader,
        buffer: Buffer.from(content, "binary")
      });
    } else {
      form.set(name, Buffer.from(content, "binary").toString("utf8"));
    }
  }
  return form;
}

function send(response, body, status = 200, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    ...headers
  });
  response.end(body);
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function redirect(response, location) {
  response.writeHead(303, { Location: location });
  response.end();
}

function contentTypeFor(fileName) {
  const ext = extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function uploadPathFromPublicPath(fileName) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(fileName).replace(/^[/\\]+/, "");
  } catch {
    return "";
  }

  const path = resolve(uploadsDir, decoded);
  const uploadRelativePath = relative(uploadsDir, path);
  if (uploadRelativePath.startsWith("..") || isAbsolute(uploadRelativePath)) return "";
  return path;
}

function normalizeUploadPath(value = "") {
  const text = String(value).trim();
  if (!text.startsWith("/uploads/")) return null;
  return uploadPathFromPublicPath(text.slice("/uploads/".length));
}

function publicPathForUploadFile(path) {
  const uploadRelativePath = relative(uploadsDir, path).replaceAll("\\", "/");
  return `/uploads/${uploadRelativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function listUploadFiles(directory = uploadsDir) {
  if (!existsSync(directory)) return [];
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      entries.push(...listUploadFiles(path));
    } else if (entry.isFile()) {
      entries.push(path);
    }
  }
  return entries;
}

function formatBytes(value = 0) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** index;
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function isVideoFile(path = "") {
  return [".mp4", ".m4v", ".mov", ".webm"].includes(extname(path).toLowerCase());
}

function uploadLimitForFile(file) {
  const ext = extname(file.filename || "").toLowerCase();
  const type = file.contentType ?? "";
  return type.startsWith("video/") || [".mp4", ".m4v", ".mov", ".webm"].includes(ext)
    ? maxVideoUploadBytes
    : maxMaterialUploadBytes;
}

function materialUploadAllowed(file) {
  const ext = extname(file.filename || "").toLowerCase();
  const type = file.contentType ?? "";
  const allowedExtensions = new Set([".mp4", ".m4v", ".mov", ".webm", ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".txt", ".doc", ".docx", ".ppt", ".pptx"]);
  return allowedExtensions.has(ext) || type.startsWith("video/") || type.startsWith("image/") || type === "application/pdf" || type.startsWith("text/");
}

function uploadFromFormFile(file, prefix = "material") {
  if (!file || typeof file === "string" || !file.buffer?.length) return "";
  if (!materialUploadAllowed(file)) return "";
  if (file.buffer.length > uploadLimitForFile(file)) return "";
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  const ext = extname(file.filename || "").toLowerCase() || ".bin";
  const storedName = `${prefix}_${randomUUID().slice(0, 10)}${ext}`;
  writeFileSync(resolve(uploadsDir, storedName), file.buffer);
  return `/uploads/${storedName}`;
}

function imageUploadAllowed(file) {
  const ext = extname(file?.filename || "").toLowerCase();
  const type = file?.contentType ?? "";
  return type.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext);
}

function imageExtension(file) {
  const extensionByType = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  return extensionByType[file.contentType] ?? (extname(file.filename).toLowerCase() || ".jpg");
}

function saveCourseImage(course, image) {
  if (!image || typeof image === "string" || !image.buffer?.length) return { ok: true, skipped: true };
  if (!imageUploadAllowed(image)) {
    return { ok: false, message: "Загрузите изображение курса: JPG, PNG, WebP или GIF." };
  }
  if (image.buffer.length > maxCourseImageUploadBytes) {
    return { ok: false, message: `Обложка слишком большая. Максимальный размер: ${Math.round(maxCourseImageUploadBytes / 1024 / 1024)} MB.` };
  }

  mkdirSync(uploadsDir, { recursive: true });
  const fileName = `course_${course.id}-${Date.now()}${imageExtension(image)}`;
  writeFileSync(resolve(uploadsDir, fileName), image.buffer);
  course.imageUrl = `/uploads/${fileName}`;
  return { ok: true, imageUrl: course.imageUrl };
}

function saveCertificatePhoto(user, photo) {
  if (!photo?.buffer?.length || !photo.contentType?.startsWith("image/")) {
    return { ok: false, message: "Upload an image file: JPG, PNG or WebP." };
  }
  if (photo.buffer.length > maxPhotoUploadBytes) {
    return { ok: false, message: `Photo is too large. Maximum size: ${Math.round(maxPhotoUploadBytes / 1024 / 1024)} MB.` };
  }

  mkdirSync(uploadsDir, { recursive: true });
  const ext = imageExtension(photo);
  const fileName = `${user.id}-${Date.now()}${ext}`;
  writeFileSync(resolve(uploadsDir, fileName), photo.buffer);
  user.photoUrl = `/uploads/${fileName}`;
  return { ok: true, photoUrl: user.photoUrl };
}

function serveUpload(request, response, user, fileName) {
  if (!user && !isPublicCourseImagePath(fileName)) {
    response.writeHead(403);
    response.end("Forbidden");
    return true;
  }
  const path = uploadPathFromPublicPath(fileName);
  if (!path || !existsSync(path)) {
    response.writeHead(404);
    response.end("Not found");
    return true;
  }
  const stats = statSync(path);
  if (!stats.isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return true;
  }

  const range = request.headers.range;
  const contentType = contentTypeFor(path);
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : stats.size - 1;
    if (!match || start >= stats.size || end >= stats.size || start > end) {
      response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
      response.end();
      return true;
    }
    response.writeHead(206, {
      "Content-Type": contentType,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stats.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600"
    });
    createReadStream(path, { start, end }).pipe(response);
    return true;
  }

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stats.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600"
  });
  createReadStream(path).pipe(response);
  return true;
}

function requireUser(request, response) {
  const user = currentUser(request);
  if (!user) {
    redirect(response, "/login?notice=login_required");
    return null;
  }
  return user;
}

function isFullAdmin(user) {
  return user?.role === "admin";
}

function isInstructor(user) {
  return user?.role === "instructor";
}

function canAccessAdminPanel(user) {
  return isFullAdmin(user) || isInstructor(user);
}

function canAssignCourses(user) {
  return isFullAdmin(user) || isInstructor(user);
}

function canEditStudents(user) {
  return isFullAdmin(user) || isInstructor(user);
}

function requireAdmin(request, response) {
  const user = requireUser(request, response);
  if (!user) return null;
  if (!canAccessAdminPanel(user)) {
    send(response, page("Нет доступа", user, `<main class="page"><div class="notice">Админ-панель доступна только администратору или инструктору.</div></main>`), 403);
    return null;
  }
  return user;
}

function courseById(courseId) {
  return db.courses.find((course) => course.id === courseId);
}

function lessonById(course, lessonId) {
  return course?.lessons.find((lesson) => lesson.id === lessonId) ?? null;
}

function materialById(course, materialId) {
  for (const lesson of course?.lessons ?? []) {
    const material = lesson.materials.find((item) => item.id === materialId);
    if (material) return { lesson, material };
  }
  return null;
}

function userById(userId) {
  return db.users.find((user) => user.id === userId);
}

function courseMaterials(course) {
  return course.lessons
    .filter((lesson) => lesson.status !== "inactive")
    .flatMap((lesson) => lesson.materials.map((material) => ({ ...material, lesson })))
    .sort((a, b) => a.lesson.sortOrder - b.lesson.sortOrder || a.sortOrder - b.sortOrder);
}

function requiredMaterials(course) {
  return courseMaterials(course).filter((material) => material.isRequired);
}

function assignmentFor(userId, courseId) {
  return db.assignments.find((assignment) => assignment.userId === userId && assignment.courseId === courseId);
}

function materialContentHtml(material) {
  const content = material.content?.trim() ?? "";
  if (!content) return "";
  if (content.startsWith("/uploads/")) {
    return `<p><a class="small-button primary" href="${escapeHtml(content)}" target="_blank" rel="noopener">Открыть файл</a></p>`;
  }
  if (/^https?:\/\//i.test(content)) {
    return `<p><a class="link-line" href="${escapeHtml(content)}" target="_blank" rel="noopener">${escapeHtml(content)}</a></p>`;
  }
  return `<p>${escapeHtml(content)}</p>`;
}

function courseCoverHtml(course, variant = "") {
  const classes = ["course-cover", variant].filter(Boolean).join(" ");
  if (course?.imageUrl) {
    return `<img class="${classes}" src="${escapeHtml(course.imageUrl)}" alt="${escapeHtml(course.title)}" loading="lazy" />`;
  }
  return `<div class="${classes} placeholder"><span>Marine LMS</span></div>`;
}

function isPublicCourseImagePath(publicPath = "") {
  const normalized = publicPath.startsWith("/uploads/") ? publicPath : `/uploads/${publicPath}`;
  return db.courses.some(
    (course) => course.status === "active" && course.imageUrl === normalized
  );
}

function courseHomeSortValue(course) {
  const value = Number(course?.homeSortOrder);
  return Number.isFinite(value) && value > 0 ? value : 999;
}

function sortHomepageCourses(courses) {
  return [...courses].sort(
    (a, b) =>
      courseHomeSortValue(a) - courseHomeSortValue(b) ||
      a.title.localeCompare(b.title, "ru")
  );
}

function homepageCourses() {
  const activeCourses = db.courses.filter((course) => course.status === "active");
  const selectedCourses = sortHomepageCourses(activeCourses.filter((course) => course.showOnHome));
  if (db.settings?.homepageCourseSelectionEnabled) return selectedCourses;
  if (selectedCourses.length) return selectedCourses;
  return [...activeCourses]
    .sort((a, b) => Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) || a.title.localeCompare(b.title, "ru"))
    .slice(0, 6);
}

function coursePublicUrl(course) {
  return `/courses/${encodeURIComponent(course.id)}`;
}

function courseTimingText(course) {
  const test = course.test;
  const testTime = test?.timeLimitMinutes ? `${test.timeLimitMinutes} мин. на тест` : "тест без лимита времени";
  return `${course.lessons?.length ?? 0} уроков, ${requiredMaterials(course).length} обязательных материалов, ${testTime}`;
}

function publicCourseDetail(user, course) {
  const lessons = (course.lessons ?? [])
    .filter((lesson) => lesson.status !== "inactive")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const materialsCount = lessons.reduce((sum, lesson) => sum + (lesson.materials?.length ?? 0), 0);
  const requiredCount = requiredMaterials(course).length;
  const test = course.test;
  return page(
    course.title,
    user,
    `<main class="page">
      <section class="section">
        <div class="course-public-hero">
          <div>
            <span class="eyebrow">Курс</span>
            <h1>${escapeHtml(course.title)}</h1>
            <p class="lead">${escapeHtml(course.fullDescription || course.shortDescription)}</p>
            <div class="actions">
              <a class="button" href="/apply?courseId=${encodeURIComponent(course.id)}">Оставить заявку</a>
              <a class="button secondary" href="/courses">Все курсы</a>
            </div>
          </div>
          ${course.imageUrl ? `<img class="course-public-cover" src="${escapeHtml(course.imageUrl)}" alt="${escapeHtml(course.title)}" />` : courseCoverHtml(course)}
        </div>
        <div class="course-meta-grid">
          <article class="metric"><span class="muted">Уроки</span><strong class="metric-value">${lessons.length}</strong></article>
          <article class="metric"><span class="muted">Материалы</span><strong class="metric-value">${materialsCount}</strong><span class="muted">${requiredCount} обязательных</span></article>
          <article class="metric"><span class="muted">Тест</span><strong class="metric-value">${test?.questions?.length ?? 0}</strong><span class="muted">проходной ${test?.passingPercent ?? 0}%</span></article>
          <article class="metric"><span class="muted">Тайминг</span><strong class="metric-value">${test?.timeLimitMinutes ? `${test.timeLimitMinutes} мин` : "Без лимита"}</strong><span class="muted">финальный тест</span></article>
        </div>
        <div class="grid two">
          <article class="panel stack">
            <h2>О курсе</h2>
            <p>${escapeHtml(course.shortDescription || course.fullDescription || "")}</p>
            ${course.goals ? `<div><h3>Цели</h3><p class="muted">${escapeHtml(course.goals)}</p></div>` : ""}
            ${course.requirements ? `<div><h3>Требования</h3><p class="muted">${escapeHtml(course.requirements)}</p></div>` : ""}
          </article>
          <article class="panel stack">
            <h2>Как проходит обучение</h2>
            <p class="muted">${escapeHtml(courseTimingText(course))}.</p>
            <p class="muted">Учебные материалы открываются в личном кабинете после назначения курса администратором.</p>
            <p class="muted">После успешного прохождения теста система формирует сертификат, если у студента загружено фото.</p>
          </article>
        </div>
        <article class="panel stack">
          <h2>Что внутри курса</h2>
          <div class="course-outline">
            ${lessons
              .map((lesson) => `<div class="course-outline-item">
                <strong>${escapeHtml(lesson.title)}</strong>
                ${lesson.description ? `<p class="muted">${escapeHtml(lesson.description)}</p>` : ""}
                <ul class="course-material-list">
                  ${(lesson.materials ?? [])
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((material) => `<li>${escapeHtml(material.title)} · ${escapeHtml(material.type)}${material.isRequired ? " · обязательный" : ""}</li>`)
                    .join("") || `<li>Материалы будут добавлены позже</li>`}
                </ul>
              </div>`)
              .join("") || `<div class="notice">Структура курса пока не заполнена.</div>`}
          </div>
        </article>
      </section>
    </main>`
  );
}

function publicCourseCard(course) {
  return `<article class="card">
    ${courseCoverHtml(course)}
    ${badge(course.status)}
    <h3>${escapeHtml(course.title)}</h3>
    <p class="muted">${escapeHtml(course.shortDescription)}</p>
    <p class="muted">${courseTimingText(course)}</p>
    <div class="table-actions">
      <a class="small-button primary" href="${coursePublicUrl(course)}">Подробнее</a>
      <a class="small-button" href="/apply?courseId=${encodeURIComponent(course.id)}">Заявка</a>
    </div>
  </article>`;
}

function publicCoursesCatalog(user, searchParams = new URLSearchParams()) {
  const params = listParams(searchParams);
  const catalogParams = { ...params, perPage: Math.min(24, Math.max(6, params.perPage)) };
  const activeCourses = db.courses
    .filter((course) => course.status === "active")
    .filter((course) =>
      matchesQuery([course.title, course.shortDescription, course.fullDescription, course.goals, course.requirements], params.q)
    )
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
  const pagination = paginateItems(activeCourses, catalogParams);
  return page(
    "Все курсы",
    user,
    `<main class="page">
      <section class="section">
        <div class="section-heading">
          <div><span class="eyebrow">Каталог</span><h1>Все курсы</h1><p class="lead">Полный список активных программ. Каждый курс можно открыть, посмотреть описание и отправить заявку.</p></div>
          <a class="button secondary" href="/">На главную</a>
        </div>
        <form class="inline-form" method="get" action="/courses">
          <input name="q" value="${escapeHtml(params.q)}" placeholder="Поиск по названию или описанию" />
          <button class="small-button primary" type="submit">Найти</button>
          <a class="small-button" href="/courses">Сбросить</a>
        </form>
        <div class="grid three">
          ${pagination.items.map(publicCourseCard).join("") || `<article class="card"><h3>Курсы не найдены</h3><p class="muted">Попробуйте изменить поисковый запрос.</p></article>`}
        </div>
        ${paginationControls("/courses", catalogParams, pagination)}
      </section>
    </main>`
  );
}

function courseMaterialRecords() {
  const records = [];
  for (const course of db.courses) {
    for (const lesson of course.lessons ?? []) {
      for (const material of lesson.materials ?? []) {
        records.push({ course, lesson, material });
      }
    }
  }
  return records;
}

function uploadFileKey(path) {
  return resolve(path).toLowerCase();
}

function fileBadge(found) {
  return `<span class="badge ${found ? "success" : "warning"}">${found ? "Найден" : "Не найден"}</span>`;
}

function uploadReport() {
  const uploadFiles = listUploadFiles().map((path) => {
    const stats = statSync(path);
    return {
      path,
      key: uploadFileKey(path),
      publicPath: publicPathForUploadFile(path),
      relativePath: relative(uploadsDir, path).replaceAll("\\", "/"),
      size: stats.size,
      isVideo: isVideoFile(path),
      modifiedAt: stats.mtime.toISOString()
    };
  });

  const photoFileKeys = new Set(
    [
      ...db.users.map((user) => normalizeUploadPath(user.photoUrl ?? "")),
      ...db.certificates.map((certificate) => normalizeUploadPath(certificate.snapshotPhotoUrl ?? ""))
    ]
      .filter(Boolean)
      .map(uploadFileKey)
  );
  const courseImageFileKeys = new Set(
    db.courses
      .map((course) => normalizeUploadPath(course.imageUrl ?? ""))
      .filter(Boolean)
      .map(uploadFileKey)
  );

  const materialFiles = courseMaterialRecords()
    .map(({ course, lesson, material }) => {
      const path = normalizeUploadPath(material.content ?? "");
      if (!path) return null;
      const exists = existsSync(path) && statSync(path).isFile();
      const stats = exists ? statSync(path) : null;
      return {
        course,
        lesson,
        material,
        path,
        key: uploadFileKey(path),
        relativePath: relative(uploadsDir, path).replaceAll("\\", "/"),
        publicPath: material.content,
        exists,
        size: stats?.size ?? 0,
        isVideo: isVideoFile(path)
      };
    })
    .filter(Boolean);

  const materialFileKeys = new Set(materialFiles.filter((item) => item.exists).map((item) => item.key));
  const unlinkedUploads = uploadFiles
    .filter((file) => !materialFileKeys.has(file.key) && !courseImageFileKeys.has(file.key))
    .map((file) => ({ ...file, usedAsPhoto: photoFileKeys.has(file.key), usedAsCourseImage: courseImageFileKeys.has(file.key) }))
    .sort((a, b) => Number(b.isVideo) - Number(a.isVideo) || b.size - a.size);

  return {
    uploadFiles,
    materialFiles,
    missingMaterialFiles: materialFiles.filter((item) => !item.exists),
    unlinkedUploads,
    unlinkedVideos: unlinkedUploads.filter((file) => file.isVideo)
  };
}

function materialFileMatchesQuery(item, query) {
  return matchesQuery(
    [item.course.title, item.lesson.title, item.material.title, item.material.type, item.relativePath, item.publicPath],
    query
  );
}

function uploadFileMatchesQuery(item, query) {
  return matchesQuery([item.relativePath, item.publicPath, item.usedAsPhoto ? "фото" : "", item.isVideo ? "video" : ""], query);
}

function lessonSelectOptions(selectedLessonId = "") {
  return db.courses
    .flatMap((course) =>
      (course.lessons ?? []).map((lesson) => ({
        course,
        lesson
      }))
    )
    .sort((a, b) => `${a.course.title} ${a.lesson.sortOrder}`.localeCompare(`${b.course.title} ${b.lesson.sortOrder}`, "ru"))
    .map(({ course, lesson }) => `<option value="${course.id}:${lesson.id}" ${selectedLessonId === lesson.id ? "selected" : ""}>${escapeHtml(course.title)} → ${escapeHtml(lesson.title)}</option>`)
    .join("");
}

function importedCourseSummary() {
  return db.courses
    .filter((course) => course.source?.system === "wordpress_tutor")
    .map((course) => {
      const materials = courseMaterialRecords().filter((record) => record.course.id === course.id);
      const videos = materials.filter((record) => record.material.type === "video" || isVideoFile(record.material.content ?? ""));
      const missing = materials.filter((record) => {
        const path = normalizeUploadPath(record.material.content ?? "");
        return path && (!existsSync(path) || !statSync(path).isFile());
      });
      return {
        course,
        lessons: course.lessons?.length ?? 0,
        materials: materials.length,
        videos: videos.length,
        missing: missing.length
      };
    })
    .sort((a, b) => b.missing - a.missing || b.videos - a.videos || a.course.title.localeCompare(b.course.title, "ru"));
}

function importedEmptyLessons() {
  return db.courses
    .filter((course) => course.source?.system === "wordpress_tutor")
    .flatMap((course) =>
      (course.lessons ?? [])
        .filter((lesson) => !lesson.materials?.length)
        .map((lesson) => ({ course, lesson }))
    );
}

function importQualityCsv() {
  const rows = [
    ["Course", "WP ID", "Lessons", "Materials", "Videos", "Missing files", "Empty lessons"],
    ...importedCourseSummary().map((item) => [
      item.course.title,
      item.course.source?.wpCourseId ?? "",
      item.lessons,
      item.materials,
      item.videos,
      item.missing,
      (item.course.lessons ?? []).filter((lesson) => !lesson.materials?.length).length
    ])
  ];
  return `\uFEFF${rows.map((row) => row.map(csvValue).join(";")).join("\r\n")}`;
}

function sendImportQualityCsv(response) {
  const fileDate = new Date().toISOString().slice(0, 10);
  response.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="wordpress-tutor-import-${fileDate}.csv"`
  });
  response.end(importQualityCsv());
}

function textTokens(value = "") {
  const stop = new Set(["the", "and", "for", "part", "basic", "course", "lesson", "video", "with", "from", "into", "your", "you"]);
  return new Set(
    String(value)
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .split(/[^a-z0-9а-яё]+/i)
      .map((item) => item.trim())
      .filter((item) => item.length > 2 && !stop.has(item))
  );
}

function tokenSimilarity(left, right) {
  const leftTokens = textTokens(left);
  const rightTokens = textTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function autoLinkUnlinkedVideos(limit = 100) {
  const report = uploadReport();
  const lessons = db.courses.flatMap((course) =>
    (course.lessons ?? []).map((lesson) => ({
      course,
      lesson,
      text: `${course.title} ${course.shortDescription ?? ""} ${lesson.title} ${lesson.description ?? ""} ${(lesson.materials ?? []).map((material) => material.title).join(" ")}`
    }))
  );
  const linked = [];
  for (const file of report.unlinkedVideos.slice(0, limit)) {
    let best = null;
    for (const candidate of lessons) {
      const score = tokenSimilarity(file.relativePath, candidate.text);
      if (!best || score > best.score) {
        best = { ...candidate, score };
      }
    }
    if (best && best.score >= 0.28 && !best.lesson.materials.some((material) => material.content === file.publicPath)) {
      best.lesson.materials.push({
        id: id("material"),
        type: "video",
        title: file.relativePath.split("/").at(-1) ?? "Video",
        content: file.publicPath,
        isRequired: true,
        sortOrder: best.lesson.materials.length + 1,
        source: {
          system: "auto_video_match",
          score: Number(best.score.toFixed(3)),
          linkedAt: now()
        }
      });
      linked.push({ file, course: best.course, lesson: best.lesson, score: best.score });
    }
  }
  return linked;
}

function sortedQuestionOptions(question) {
  return [...(question.options ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
}

function parseQuestionOptions(form) {
  const options = [];
  for (let index = 1; index <= 6; index += 1) {
    const optionText = form.get(`option${index}`)?.toString().trim() ?? "";
    if (optionText) {
      options.push({
        id: form.get(`optionId${index}`)?.toString() || id("option"),
        optionText,
        isCorrect: form.get("correct")?.toString() === String(index),
        sortOrder: index
      });
    }
  }
  if (!options.some((option) => option.isCorrect) && options[0]) {
    options[0].isCorrect = true;
  }
  return options;
}

function isQuestionValid(question) {
  const options = question.options ?? [];
  const correctCount = options.filter((option) => option.isCorrect).length;
  if (!question.questionText?.trim() || options.length < 2) return false;
  return question.type === "multiple_choice" ? correctCount >= 1 : correctCount === 1;
}

function isTestValid(test) {
  return Boolean(test?.questions?.length) && test.questions.every(isQuestionValid);
}

function questionEditorFields(question = null) {
  const options = sortedQuestionOptions(question ?? { options: [] });
  const correctIndex = Math.max(1, options.findIndex((option) => option.isCorrect) + 1);
  const fields = [];
  for (let index = 1; index <= 6; index += 1) {
    const option = options[index - 1];
    fields.push(`<div class="field">
      <label>Вариант ${index}${index > 2 ? " — необязательно" : ""}</label>
      <input name="option${index}" value="${escapeHtml(option?.optionText ?? "")}" ${index <= 2 ? "required" : ""} />
      <input type="hidden" name="optionId${index}" value="${escapeHtml(option?.id ?? "")}" />
    </div>`);
  }
  return `${fields.join("")}
    <div class="field"><label>Правильный ответ</label><select name="correct">${Array.from({ length: 6 }, (_, itemIndex) => {
      const value = itemIndex + 1;
      return `<option value="${value}" ${correctIndex === value ? "selected" : ""}>Вариант ${value}</option>`;
    }).join("")}</select></div>`;
}

function listParams(searchParams = new URLSearchParams()) {
  return {
    q: (searchParams.get("q") ?? "").trim(),
    page: Math.max(1, Number(searchParams.get("page") ?? 1)),
    perPage: Math.min(50, Math.max(5, Number(searchParams.get("perPage") ?? 10)))
  };
}

function matchesQuery(values, query) {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return values.filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized));
}

function paginateItems(items, params) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / params.perPage));
  const page = Math.min(params.page, totalPages);
  const start = (page - 1) * params.perPage;
  return { items: items.slice(start, start + params.perPage), page, totalPages, total };
}

function paginationControls(pathname, params, pagination) {
  if (pagination.totalPages <= 1) return "";
  const base = new URLSearchParams();
  if (params.q) base.set("q", params.q);
  base.set("perPage", String(params.perPage));
  const link = (page, label) => {
    const next = new URLSearchParams(base);
    next.set("page", String(page));
    return `<a class="small-button" href="${pathname}?${next.toString()}">${label}</a>`;
  };
  return `<div class="table-actions">
    ${pagination.page > 1 ? link(pagination.page - 1, "Назад") : ""}
    <span class="muted">Страница ${pagination.page} из ${pagination.totalPages}, всего ${pagination.total}</span>
    ${pagination.page < pagination.totalPages ? link(pagination.page + 1, "Вперед") : ""}
  </div>`;
}

function attemptsFor(assignmentId) {
  return db.testAttempts.filter((attempt) => attempt.assignmentId === assignmentId);
}

function completedRequiredCount(assignment, course) {
  return requiredMaterials(course).filter(
    (material) => assignment.materialProgress?.[material.id]?.status === "completed"
  ).length;
}

function recalculateAssignment(assignment) {
  const course = courseById(assignment.courseId);
  if (!course) return assignment;
  const required = requiredMaterials(course);
  const completed = completedRequiredCount(assignment, course);
  assignment.progressPercent = required.length === 0 ? 100 : Math.round((completed / required.length) * 100);

  if (assignment.status === "completed" || assignment.status === "test_passed") {
    assignment.progressPercent = 100;
    return assignment;
  }

  if (assignment.progressPercent === 100) {
    assignment.status = "test_available";
  } else if (assignment.progressPercent > 0) {
    assignment.status = "in_progress";
  } else {
    assignment.status = "not_started";
  }
  return assignment;
}

function canTakeTest(assignment) {
  const course = courseById(assignment.courseId);
  if (!course?.test || course.test.status !== "active" || !isTestValid(course.test)) return false;
  recalculateAssignment(assignment);
  const attempts = attemptsFor(assignment.id);
  const limitReached = attempts.length >= course.test.attemptsLimit + (assignment.extraTestAttempts ?? 0);
  const retakeBlocked = !course.test.allowRetake && attempts.length > 0;
  return assignment.progressPercent === 100 && !limitReached && !retakeBlocked && assignment.status !== "completed";
}

function certificateNumberDate(value) {
  const date = value ? new Date(value) : new Date();
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function certificateNumber(issuedAt = now()) {
  const firstCertificateNumber = 725645565;
  const numericParts = db.certificates
    .map((certificate) => String(certificate.certificateNumber ?? "").match(/^(\d{9,})\//)?.[1])
    .filter(Boolean)
    .map(Number);
  const nextNumeric = numericParts.length
    ? Math.max(...numericParts) + 1
    : firstCertificateNumber;
  return `${String(nextNumeric).padStart(9, "0")}/${certificateNumberDate(issuedAt)}`;
}

function hasCertificatePhoto(user) {
  return Boolean(user?.photoUrl);
}

function photoRequiredNotice() {
  return `<div class="photo-warning"><strong>Фото для сертификата не загружено.</strong><br>Для получения сертификата в будущем обязательно загрузите фото в личном кабинете.</div>`;
}

function activeCertificateForAssignment(assignmentId) {
  return db.certificates.find((certificate) => certificate.assignmentId === assignmentId && certificate.status === "issued");
}

function certificateActorSnapshot(actor) {
  if (!actor) {
    return {
      actorUserId: "",
      actorEmail: "system",
      actorRole: "system"
    };
  }
  return {
    actorUserId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role
  };
}

function logCertificateEvent(certificate, action, actor = null, details = {}) {
  if (!certificate) return;
  db.certificateEvents ??= [];
  const compactDetails = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    compactDetails[key] = String(value).slice(0, 240);
  }
  db.certificateEvents.push({
    id: id("cert_event"),
    certificateId: certificate.id,
    certificateNumber: certificate.certificateNumber,
    userId: certificate.userId,
    courseId: certificate.courseId,
    action,
    ...certificateActorSnapshot(actor),
    details: compactDetails,
    createdAt: now()
  });
  if (db.certificateEvents.length > 5000) {
    db.certificateEvents = db.certificateEvents.slice(-5000);
  }
}

function createCertificateForAssignment(assignment, options = {}) {
  const user = userById(assignment.userId);
  const course = courseById(assignment.courseId);
  if (!user || !course) return null;
  const issuedAt = options.issuedAt || now();
  const expiresAt = addYearsIso(issuedAt, 5);
  const certificate = {
    id: id("cert"),
    userId: user.id,
    courseId: course.id,
    assignmentId: assignment.id,
    certificateNumber: certificateNumber(issuedAt),
    status: "issued",
    issuedAt,
    expiresAt,
    replacesCertificateId: options.replacesCertificateId ?? "",
    revokedAt: "",
    reissuedAt: "",
    snapshotFirstName: user.firstNameEn,
    snapshotLastName: user.lastNameEn,
    snapshotBirthDate: user.birthDate,
    snapshotPosition: user.position,
    snapshotCompany: user.company,
    snapshotPhotoUrl: user.photoUrl,
    snapshotCourseTitle: course.title,
    snapshotCertificateTemplateHtml: course.certificateTemplateHtml || defaultCertificateTemplate(),
    certificateHtml: ""
  };
  certificate.certificateHtml = renderCertificateTemplate(certificate, certificate.snapshotCertificateTemplateHtml);
  db.certificates.push(certificate);
  logCertificateEvent(certificate, options.action ?? "issued", options.actor ?? null, {
    assignmentId: assignment.id,
    replacesCertificateId: options.replacesCertificateId ?? ""
  });
  return certificate;
}

function certificatePreviewPhotoUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="118" height="150" viewBox="0 0 118 150"><rect width="118" height="150" fill="#e7f1f8"/><circle cx="59" cy="52" r="25" fill="#8bb7d6"/><path d="M22 126c6-26 25-39 37-39s31 13 37 39" fill="#0b4f7a"/><text x="59" y="142" text-anchor="middle" font-family="Arial" font-size="11" fill="#587087">PHOTO</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function sampleCertificateForCourse(course) {
  const issuedAt = now();
  const certificate = {
    id: "cert_preview",
    userId: "",
    courseId: course.id,
    assignmentId: "",
    certificateNumber: certificateNumber(issuedAt),
    status: "issued",
    issuedAt,
    expiresAt: addYearsIso(issuedAt, 5),
    replacesCertificateId: "",
    revokedAt: "",
    reissuedAt: "",
    snapshotFirstName: "Ivan",
    snapshotLastName: "Petrov",
    snapshotBirthDate: "1990-01-01",
    snapshotPosition: "Deck Officer",
    snapshotCompany: "Marine Training Center",
    snapshotPhotoUrl: certificatePreviewPhotoUrl(),
    snapshotCourseTitle: course.title,
    snapshotCertificateTemplateHtml: course.certificateTemplateHtml || defaultCertificateTemplate(),
    certificateHtml: ""
  };
  certificate.certificateHtml = renderCertificateTemplate(certificate, certificate.snapshotCertificateTemplateHtml);
  return certificate;
}

function issueCertificate(assignment, options = {}) {
  const existing = activeCertificateForAssignment(assignment.id);
  if (existing) return existing;
  const user = userById(assignment.userId);
  const course = courseById(assignment.courseId);
  if (!user || !course) return null;
  if (!hasCertificatePhoto(user)) {
    db.notifications.push({
      id: id("note"),
      recipientUserId: user.id,
      recipientEmail: user.email,
      type: "photo_required_for_certificate",
      status: notificationInitialStatus(),
      payload: `Photo is required before certificate can be issued for ${course.title}.`,
      createdAt: now(),
      sentAt: now()
    });
    return null;
  }
  const certificate = createCertificateForAssignment(assignment, options);
  if (!certificate) return null;
  db.notifications.push({
    id: id("note"),
    recipientUserId: user.id,
    recipientEmail: user.email,
    type: "certificate_available",
    status: notificationInitialStatus(),
    payload: `Certificate ${certificate.certificateNumber} is available.`,
    createdAt: now(),
    sentAt: now()
  });
  return certificate;
}

function issuePendingCertificatesForUser(user, options = {}) {
  if (!hasCertificatePhoto(user)) return [];
  const issued = [];
  for (const assignment of db.assignments.filter((item) => item.userId === user.id && item.status === "completed")) {
    if (!activeCertificateForAssignment(assignment.id)) {
      const certificate = issueCertificate(assignment, options);
      if (certificate) issued.push(certificate);
    }
  }
  return issued;
}

function completeAssignmentForManualCertificate(student, course, admin, completedAt = now()) {
  let assignment = assignmentFor(student.id, course.id);
  const materialProgress = {};
  for (const material of requiredMaterials(course)) {
    materialProgress[material.id] = {
      status: "completed",
      viewPercent: 100,
      openedAt: completedAt,
      completedAt
    };
  }

  if (!assignment) {
    assignment = {
      id: id("assign"),
      userId: student.id,
      courseId: course.id,
      assignedById: admin.id,
      status: "completed",
      assignedAt: completedAt,
      startedAt: completedAt,
      completedAt,
      progressPercent: 100,
      materialProgress
    };
    db.assignments.push(assignment);
    return assignment;
  }

  assignment.assignedById ||= admin.id;
  assignment.status = "completed";
  assignment.startedAt ||= completedAt;
  assignment.completedAt ||= completedAt;
  assignment.progressPercent = 100;
  assignment.materialProgress = { ...(assignment.materialProgress ?? {}), ...materialProgress };
  return assignment;
}

function issueManualCertificate(student, course, admin, options = {}) {
  if (!student || student.role !== "student" || !course) return null;
  if (!hasCertificatePhoto(student)) return null;
  const issuedAt = options.issuedAt || now();
  const assignment = completeAssignmentForManualCertificate(student, course, admin, issuedAt);
  const existing = activeCertificateForAssignment(assignment.id);
  const certificate = issueCertificate(assignment, { actor: admin, action: "manual_issue", issuedAt });
  if (certificate && certificate.id !== existing?.id) {
    db.notifications.push({
      id: id("note"),
      recipientUserId: student.id,
      recipientEmail: student.email,
      type: "certificate_manual_issue",
      status: notificationInitialStatus(),
      payload: `Certificate manually issued: ${certificate.certificateNumber} for ${course.title}.`,
      createdAt: now(),
      sentAt: now()
    });
  }
  return certificate;
}

function statusLabel(status) {
  const labels = {
    active: "Активен",
    inactive: "Отключен",
    deleted: "Архив",
    new: "Новая",
    contacted: "Связались",
    accepted: "Принята",
    rejected: "Отклонена",
    converted_to_user: "Пользователь создан",
    not_started: "Не начат",
    in_progress: "В процессе",
    test_available: "Тест доступен",
    test_failed: "Тест не сдан",
    test_passed: "Тест сдан",
    completed: "Завершен",
    issued: "Выдан",
    revoked: "Отозван",
    reissued: "Перевыпущен",
    pending_photo: "Ожидает фото",
    queued: "В очереди",
    logged: "Лог",
    sent: "Отправлено",
    failed: "Ошибка"
  };
  return labels[status] ?? status;
}

function badge(status) {
  const className = ["active", "accepted", "completed", "issued", "test_passed", "sent", "logged"].includes(status)
    ? "success"
    : "warning";
  return `<span class="badge ${className}">${escapeHtml(statusLabel(status))}</span>`;
}

function displayUserName(user) {
  return `${user?.firstNameEn ?? ""} ${user?.lastNameEn ?? ""}`.trim();
}

function roleLabel(role) {
  const labels = {
    admin: "Администратор",
    instructor: "Инструктор",
    student: "Студент"
  };
  return labels[role] ?? role;
}

function topNav(user) {
  return `<header class="topbar">
    <a class="brand" href="/"><span class="brand-mark">M</span><span>Marine LMS</span></a>
    <nav class="nav-links" aria-label="Основная навигация">
      <a class="nav-link" href="/courses">Курсы</a>
      ${user ? `<a class="nav-link" href="/dashboard">Кабинет</a>` : ""}
      ${canAccessAdminPanel(user) ? `<a class="nav-link" href="/admin">Админ</a>` : ""}
      ${user ? `<form method="post" action="/logout"><button class="button secondary" type="submit">Выйти</button></form>` : `<a class="button secondary" href="/login">Войти</a>`}
    </nav>
  </header>`;
}

function page(title, user, body) {
  const content = injectCsrfTokens(user, `<div class="app-shell">
      ${topNav(user)}
      ${body}
    </div>`);
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | Marine LMS</title>
    <style>${baseCss}${productCss}</style>
  </head>
  <body>
    ${content}
  </body>
</html>`;
}

function adminShell(user, title, body) {
  const navLinks = isFullAdmin(user)
    ? `<a href="/admin">Дашборд</a>
          <a href="/admin/applications">Заявки</a>
          <a href="/admin/users">Пользователи</a>
          <a href="/admin/reports">Отчеты</a>
          <a href="/admin/tests">Тесты</a>
          <a href="/admin/courses">Курсы</a>
          <a href="/admin/homepage">Главная</a>
          <a href="/admin/files">Файлы</a>
          <a href="/admin/certificates">Сертификаты</a>
          <a href="/admin/notifications">Уведомления</a>
          <a href="/admin/audit">Аудит</a>`
    : `<a href="/admin">Панель инструктора</a>
          <a href="/admin/users">Пользователи</a>`;
  return page(
    title,
    user,
    `<div class="split-layout">
      <aside class="sidebar">
        <span class="eyebrow">Админ-панель</span>
        <nav class="sidebar-nav">
          ${navLinks}
        </nav>
      </aside>
      <main class="content">${body}</main>
    </div>`
  );
}

function studentShell(user, title, body) {
  const photoNotice = hasCertificatePhoto(user) ? "" : photoRequiredNotice();
  return page(
    title,
    user,
    `<div class="split-layout">
      <aside class="sidebar">
        <span class="eyebrow">Личный кабинет</span>
        <nav class="sidebar-nav">
          <a href="/dashboard">Обзор</a>
          <a href="/dashboard/courses">Мои курсы</a>
          <a href="/dashboard/tests">Пройденные тесты</a>
          <a href="/dashboard/certificates">Сертификаты</a>
          <a href="/dashboard/profile">Профиль</a>
        </nav>
      </aside>
      <main class="content">${photoNotice}${body}</main>
    </div>`
  );
}

function homePage(user) {
  const visibleCourses = homepageCourses();
  return page(
    "Главная",
    user,
    `<main class="home-page">
      <section class="hero">
        <div class="hero-copy">
          <span class="eyebrow">Marine training platform</span>
          <h1>Marine LMS для обучения, тестов и сертификатов</h1>
          <p class="lead">Закрытая учебная платформа для морских курсов: администратор вручную создает студентов, назначает обучение, контролирует прогресс и выдает сертификаты.</p>
          <div class="actions">
            <a class="button" href="/apply">Зарегистрироваться на курс</a>
            <a class="button secondary" href="${user ? "/dashboard" : "/login"}">Войти в кабинет</a>
          </div>
          <div class="hero-meta">
            <div class="hero-meta-item"><strong>Manual access</strong><span>без самостоятельной регистрации</span></div>
            <div class="hero-meta-item"><strong>Course control</strong><span>материалы перед тестом</span></div>
            <div class="hero-meta-item"><strong>Certificates</strong><span>привязка к студенту и курсу</span></div>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="section-heading">
          <div><span class="eyebrow">Курсы</span><h2>Доступные программы обучения</h2></div>
          <div class="actions"><a class="button secondary" href="/courses">Все курсы</a><a class="button secondary" href="/apply">Оставить заявку</a></div>
        </div>
        <div class="grid three">
          ${visibleCourses.length
            ? visibleCourses
            .map(publicCourseCard)
            .join("")
            : `<article class="card"><h3>Курсы скоро появятся</h3><p class="muted">Администратор еще не выбрал курсы для главной страницы.</p></article>`}
        </div>
      </section>
    </main>`
  );
}

function loginPage(user, notice = "") {
  if (user) return redirectPage("/dashboard");
  const message = notice === "login_required" ? `<div class="notice">Войдите, чтобы открыть закрытую часть платформы.</div>` : "";
  return page(
    "Вход",
    null,
    `<main class="page">
      <section class="section">
        <div><span class="eyebrow">Закрытый доступ</span><h1>Вход в Marine LMS</h1><p class="lead">Самостоятельной регистрации нет. Доступ выдает администратор после обработки заявки.</p></div>
        ${message}
        <form class="form-panel" method="post" action="/login">
          <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" required /></div>
          <div class="field"><label for="password">Пароль</label><input id="password" name="password" type="password" required /></div>
          <button class="button" type="submit">Войти</button>
          <a class="link-line" href="/forgot-password">Восстановить пароль</a>
          <div class="auth-note">
            <strong>Демо-доступ</strong>
            <span>Админ: admin@example.com / Admin123!</span>
            <span>Студент: student@example.com / Student123!</span>
          </div>
        </form>
      </section>
    </main>`
  );
}

function forgotPasswordPage(user, success = false) {
  if (user) return redirectPage("/dashboard");
  return page(
    "Восстановление пароля",
    null,
    `<main class="page">
      <section class="section">
        <div><span class="eyebrow">Доступ</span><h1>Восстановление пароля</h1><p class="lead">Если e-mail есть в системе, LMS отправит временный пароль через настроенные уведомления.</p></div>
        ${success ? `<div class="notice">Если такой e-mail зарегистрирован, временный пароль был отправлен.</div>` : ""}
        <form class="form-panel" method="post" action="/forgot-password">
          <div class="field"><label>E-mail</label><input name="email" type="email" required /></div>
          <button class="button" type="submit">Получить временный пароль</button>
          <a class="small-button" href="/login">Вернуться ко входу</a>
        </form>
      </section>
    </main>`
  );
}

function redirectPage(location) {
  return `<html><head><meta http-equiv="refresh" content="0;url=${location}"></head></html>`;
}

function applyPage(user, success = false, selectedCourseId = "") {
  const activeCourses = db.courses.filter((course) => course.status === "active");
  return page(
    "Заявка",
    user,
    `<main class="page">
      <section class="section">
        <div><span class="eyebrow">Заявка на курс</span><h1>Оставить заявку</h1><p class="lead">Заявка не создает аккаунт автоматически. Администратор связывается с кандидатом и вручную создает пользователя.</p></div>
        ${success ? `<div class="notice">Заявка отправлена. Администратор увидит ее в панели управления.</div>` : ""}
        <form class="form-panel" method="post" action="/apply">
          <div class="field"><label>Фамилия</label><input name="lastName" required /></div>
          <div class="field"><label>Имя</label><input name="firstName" required /></div>
          <div class="field"><label>Номер телефона</label><input name="phone" required /></div>
          <div class="field"><label>E-mail</label><input name="email" type="email" required /></div>
          <div class="field"><label>Курс</label><select name="courseId">${activeCourses.map((course) => `<option value="${course.id}" ${selectedCourseId === course.id ? "selected" : ""}>${escapeHtml(course.title)}</option>`).join("")}</select></div>
          <div class="field"><label>Комментарий</label><textarea name="comment"></textarea></div>
          <button class="button" type="submit">Отправить заявку</button>
        </form>
      </section>
    </main>`
  );
}

function adminDashboard(user) {
  if (isInstructor(user)) {
    const students = db.users.filter((item) => item.role === "student" && item.status === "active").length;
    const activeCourses = db.courses.filter((course) => course.status === "active").length;
    return adminShell(
      user,
      "Панель инструктора",
      `<section class="section">
        <div class="section-heading">
          <div><span class="eyebrow">Инструктор</span><h1>Назначение обучения</h1><p class="lead">Инструктор может создать студента, редактировать его данные, загрузить фото и назначить курс. Удаление, отчеты и сертификаты недоступны.</p></div>
          <div class="actions"><a class="button" href="/admin/users">Пользователи</a></div>
        </div>
        <div class="grid three">
          <article class="metric"><span class="muted">Активные студенты</span><strong class="metric-value">${students}</strong></article>
          <article class="metric"><span class="muted">Курсы для назначения</span><strong class="metric-value">${activeCourses}</strong></article>
        </div>
      </section>`
    );
  }
  const activeStudents = db.users.filter((item) => item.role === "student" && item.status === "active").length;
  const activeCourses = db.courses.filter((course) => course.status === "active").length;
  const completed = db.assignments.filter((assignment) => assignment.status === "completed").length;
  const metrics = [
    ["Новые заявки", db.applications.filter((item) => item.status === "new").length, "ожидают обработки"],
    ["Активные студенты", activeStudents, "имеют доступ"],
    ["Активные курсы", activeCourses, "доступны для назначения"],
    ["Завершенные курсы", completed, "успешно пройдены"]
  ];
  return adminShell(
    user,
    "Админ-панель",
    `<section class="section">
      <div class="section-heading">
        <div><span class="eyebrow">Управление обучением</span><h1>Админский дашборд</h1><p class="lead">Операционный центр для заявок, пользователей, курсов, тестов и сертификатов.</p></div>
        <div class="actions"><a class="button" href="/admin/users">Создать пользователя</a><a class="button secondary" href="/admin/courses">Курсы</a></div>
      </div>
      <div class="grid four">${metrics
        .map(
          ([label, value, hint]) => `<article class="metric"><div class="metric-top"><span class="muted">${label}</span><span class="metric-icon">~</span></div><strong class="metric-value">${value}</strong><span class="muted">${hint}</span></article>`
        )
        .join("")}</div>
    </section>`
  );
}

function adminApplications(user, searchParams = new URLSearchParams()) {
  const params = listParams(searchParams);
  const applications = db.applications.filter((application) => {
    const course = courseById(application.courseId);
    return matchesQuery(
      [application.lastName, application.firstName, application.email, application.phone, application.comment, application.status, course?.title],
      params.q
    );
  });
  const pagination = paginateItems(applications, params);
  return adminShell(
    user,
    "Заявки",
    `<section class="section">
      <div><span class="eyebrow">Заявки</span><h1>Заявки на курсы</h1><p class="lead">Заявка сохраняется отдельно и не создает аккаунт автоматически.</p></div>
      <form class="inline-form" method="get" action="/admin/applications">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Поиск заявок" />
        <button class="small-button primary" type="submit">Найти</button>
      </form>
      <table class="table">
        <thead><tr><th>Кандидат</th><th>Контакты</th><th>Курс</th><th>Статус</th><th>Действия</th></tr></thead>
        <tbody>${pagination.items
          .map((application) => {
            const course = courseById(application.courseId);
            return `<tr>
              <td>${escapeHtml(application.lastName)} ${escapeHtml(application.firstName)}<br><span class="muted">${escapeHtml(application.comment)}</span></td>
              <td>${escapeHtml(application.email)}<br><span class="muted">${escapeHtml(application.phone)}</span></td>
              <td>${escapeHtml(course?.title ?? "Курс удален")}</td>
              <td>${badge(application.status)}</td>
              <td><div class="table-actions">
                <form method="post" action="/admin/applications/status" class="inline-form">
                  <input type="hidden" name="id" value="${application.id}" />
                  <select name="status">
                    ${["new", "contacted", "accepted", "rejected"].map((status) => `<option value="${status}" ${application.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
                  </select>
                  <button class="small-button" type="submit">Сохранить</button>
                </form>
                <form method="post" action="/admin/applications/convert">
                  <input type="hidden" name="id" value="${application.id}" />
                  <button class="small-button primary" type="submit">Создать пользователя</button>
                </form>
              </div></td>
            </tr>`;
          })
          .join("") || `<tr><td colspan="5"><span class="muted">Заявки не найдены.</span></td></tr>`}</tbody>
      </table>
      ${paginationControls("/admin/applications", params, pagination)}
    </section>`
  );
}

function adminStudentCard(student, viewer = null) {
  const assignments = db.assignments.filter((assignment) => assignment.userId === student.id);
  const activeCourses = db.courses.filter((course) => course.status === "active");
  const toggleLabel = student.status === "active" ? "Деактивировать" : "Активировать";
  const photoLabel = hasCertificatePhoto(student) ? "Фото загружено" : "Фото не загружено";
  const fullAdmin = isFullAdmin(viewer);
  const canAssign = canAssignCourses(viewer);
  const canEdit = canEditStudents(viewer);
  return `<article class="panel stack admin-user-card">
    <div class="admin-user-summary">
      <div>
        <span class="eyebrow">Студент</span>
        <h2>${escapeHtml(student.firstNameEn)} ${escapeHtml(student.lastNameEn)}</h2>
        <p class="muted">${escapeHtml(student.email)}</p>
      </div>
      <div>${badge(student.status)}</div>
      <p><strong>Должность:</strong> ${escapeHtml(student.position || "-")}</p>
      <p><strong>Компания:</strong> ${escapeHtml(student.company || "-")}</p>
      <p class="muted">${photoLabel}</p>
      ${fullAdmin ? `<a class="small-button" href="/admin/users/${encodeURIComponent(student.id)}">Профиль студента</a>
      <a class="small-button primary" href="/admin/certificates?userId=${encodeURIComponent(student.id)}">Сертификаты студента</a>` : ""}
      ${hasCertificatePhoto(student) ? `<img class="profile-photo" src="${escapeHtml(student.photoUrl)}" alt="Certificate photo" />` : `<div class="profile-photo"></div>`}
      ${canEdit ? `<form class="stack" method="post" action="/admin/users/photo" enctype="multipart/form-data">
        <input type="hidden" name="id" value="${student.id}" />
        <div class="field"><label>Фото для сертификата</label><input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required /></div>
        <button class="small-button primary" type="submit">Загрузить фото</button>
      </form>` : ""}
      ${fullAdmin ? `<div class="table-actions">
        <form method="post" action="/admin/users/toggle">
          <input type="hidden" name="id" value="${student.id}" />
          <button class="small-button" type="submit">${toggleLabel}</button>
        </form>
        <form method="post" action="/admin/users/delete">
          <input type="hidden" name="id" value="${student.id}" />
          <button class="small-button danger" type="submit">Архивировать</button>
        </form>
        <form method="post" action="/admin/users/reset-password" class="inline-form">
          <input type="hidden" name="id" value="${student.id}" />
          <input name="password" value="Student123!" required />
          <button class="small-button warning" type="submit">Сбросить пароль</button>
        </form>
      </div>` : ""}
    </div>
    <div class="stack">
      ${canEdit ? `<form class="stack" method="post" action="/admin/users/update">
        <input type="hidden" name="id" value="${student.id}" />
        <div class="admin-edit-grid">
          <div class="field"><label>Фамилия</label><input name="lastNameEn" value="${escapeHtml(student.lastNameEn)}" required /></div>
          <div class="field"><label>Имя</label><input name="firstNameEn" value="${escapeHtml(student.firstNameEn)}" required /></div>
          <div class="field"><label>Дата рождения</label><input name="birthDate" type="date" value="${escapeHtml(student.birthDate || "")}" required /></div>
          <div class="field"><label>E-mail</label><input name="email" type="email" value="${escapeHtml(student.email)}" required /></div>
          <div class="field"><label>Должность</label><input name="position" value="${escapeHtml(student.position || "")}" required /></div>
          <div class="field"><label>Компания</label><input name="company" value="${escapeHtml(student.company || "")}" /></div>
          <div class="field"><label>Телефон</label><input name="phone" value="${escapeHtml(student.phone || "")}" /></div>
        </div>
        <button class="small-button primary" type="submit">Сохранить профиль</button>
      </form>` : `<div class="notice"><strong>Ограниченный доступ.</strong><br>Недостаточно прав для редактирования профиля.</div>`}
      <div class="stack">
        <h3>Назначенные курсы</h3>
        ${assignments.map((assignment) => {
          recalculateAssignment(assignment);
          const course = courseById(assignment.courseId);
          const hasCertificate = Boolean(activeCertificateForAssignment(assignment.id));
          return `<div class="assignment-chip">
            <span>${escapeHtml(course?.title ?? "Курс удален")}</span>
            <span>${badge(assignment.status)} ${assignment.progressPercent ?? 0}%</span>
            ${hasCertificate
              ? `<span class="muted">Есть сертификат</span>`
              : fullAdmin ? `<form method="post" action="/admin/assignments/${assignment.id}/delete"><button class="small-button danger" type="submit">Удалить</button></form>` : `<span class="muted">Сертификата нет</span>`}
          </div>`;
        }).join("") || `<p class="muted">Назначений пока нет.</p>`}
        ${canAssign && activeCourses.length
          ? `<form method="post" action="/admin/assignments/create" class="inline-form">
              <input type="hidden" name="userId" value="${student.id}" />
              <select name="courseId">${activeCourses.map((course) => `<option value="${course.id}">${escapeHtml(course.title)}</option>`).join("")}</select>
              <button class="small-button primary" type="submit">Назначить курс</button>
            </form>`
          : `<p class="muted">Нет активных курсов для назначения.</p>`}
        ${fullAdmin && activeCourses.length
          ? `<form method="post" action="/admin/certificates/issue-manual" class="inline-form">
              <input type="hidden" name="userId" value="${student.id}" />
              <select name="courseId">${activeCourses.map((course) => `<option value="${course.id}">${escapeHtml(course.title)}</option>`).join("")}</select>
              <label class="field">Дата выдачи<input name="issuedAt" type="date" value="${dateInputValue()}" required /></label>
              <button class="small-button warning" type="submit" ${hasCertificatePhoto(student) ? "" : "disabled"}>Выдать сертификат</button>
              ${hasCertificatePhoto(student) ? `<span class="muted">Курс будет отмечен как завершенный.</span>` : `<span class="muted">Сначала загрузите фото студента.</span>`}
            </form>`
          : ""}
      </div>
    </div>
  </article>`;
}

function adminUsers(user, searchParams = new URLSearchParams()) {
  const params = listParams(searchParams);
  const students = db.users.filter((item) =>
    item.role === "student" &&
    (isFullAdmin(user) || item.status !== "deleted") &&
    matchesQuery([item.firstNameEn, item.lastNameEn, item.email, item.position, item.company, item.status], params.q)
  );
  const staff = db.users.filter((item) => ["admin", "instructor"].includes(item.role));
  const pagination = paginateItems(students, params);
  return adminShell(
    user,
    "Пользователи",
    `<section class="section">
      <div class="section-heading">
        <div><span class="eyebrow">Пользователи</span><h1>Студенты</h1><p class="lead">Администратор создает студентов, редактирует обязательные поля и назначает курсы.</p></div>
      </div>
      <form class="inline-form" method="get" action="/admin/users">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Поиск студентов" />
        <button class="small-button primary" type="submit">Найти</button>
      </form>
      <form class="form-panel" method="post" action="/admin/users/create">
        <h2>${isFullAdmin(user) ? "Создать пользователя" : "Создать студента"}</h2>
        ${isFullAdmin(user)
          ? `<div class="field"><label>Роль</label><select name="role"><option value="student">Студент</option><option value="instructor">Инструктор</option></select></div>`
          : `<input type="hidden" name="role" value="student" />`}
        <div class="field"><label>E-mail</label><input name="email" type="email" required /></div>
        <div class="field"><label>Имя</label><input name="firstNameEn" required /></div>
        <div class="field"><label>Фамилия</label><input name="lastNameEn" required /></div>
        <div class="field"><label>Дата рождения</label><input name="birthDate" type="date" required /></div>
        <div class="field"><label>Должность</label><input name="position" required /></div>
        <div class="field"><label>Компания — необязательно</label><input name="company" /></div>
        <div class="field"><label>Телефон</label><input name="phone" /></div>
        <div class="field"><label>Временный пароль</label><input name="password" value="Student123!" required /></div>
        <button class="button" type="submit">Создать пользователя</button>
      </form>
      ${isFullAdmin(user) ? `<article class="panel stack">
        <h2>Сотрудники админ-панели</h2>
        <table class="table">
          <thead><tr><th>Имя</th><th>E-mail</th><th>Роль</th><th>Статус</th></tr></thead>
          <tbody>${staff
            .map((item) => `<tr><td>${escapeHtml(displayUserName(item))}</td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(roleLabel(item.role))}</td><td>${badge(item.status)}</td></tr>`)
            .join("") || `<tr><td colspan="4"><span class="muted">Сотрудников не найдено.</span></td></tr>`}</tbody>
        </table>
      </article>` : ""}
      <div class="admin-user-list">
        ${pagination.items.map((student) => adminStudentCard(student, user)).join("") || `<article class="panel">Студентов не найдено.</article>`}
      </div>
      ${paginationControls("/admin/users", params, pagination)}
    </section>`
  );
}

function assignmentAdminActions(assignment, returnTo) {
  return `<div class="table-actions">
    <form method="post" action="/admin/assignments/${assignment.id}/unlock-test">
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
      <button class="small-button warning" type="submit">Разблокировать пересдачу</button>
    </form>
    <form method="post" action="/admin/assignments/${assignment.id}/reset-attempts">
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
      <button class="small-button danger" type="submit">Сбросить попытки</button>
    </form>
  </div>`;
}

function attemptWrongAnswersHtml(attempt) {
  const assignment = db.assignments.find((item) => item.id === attempt.assignmentId);
  const course = assignment ? courseById(assignment.courseId) : null;
  const questions = new Map((course?.test?.questions ?? []).map((question) => [question.id, question]));
  const wrongAnswers = (attempt.answers ?? []).filter((answer) => !answer.isCorrect);
  if (!wrongAnswers.length) return `<span class="muted">Ошибок нет.</span>`;
  return `<details><summary>${wrongAnswers.length} неправильных ответов</summary><div class="stack">${wrongAnswers
    .map((answer) => {
      const question = questions.get(answer.questionId);
      const options = question?.options ?? [];
      const selectedIds = answer.selectedOptionIds ?? [answer.selectedOptionId].filter(Boolean);
      const selected = options.filter((option) => selectedIds.includes(option.id)).map((option) => option.optionText).join(", ") || "Нет ответа";
      const correct = options.filter((option) => option.isCorrect).map((option) => option.optionText).join(", ");
      return `<div class="notice">
        <strong>${escapeHtml(question?.questionText ?? "Вопрос удален")}</strong>
        <p class="muted">Ответ студента: ${escapeHtml(selected)}</p>
        <p class="muted">Правильно: ${escapeHtml(correct)}</p>
      </div>`;
    })
    .join("")}</div></details>`;
}

function adminStudentDetail(admin, student) {
  const assignments = db.assignments.filter((assignment) => assignment.userId === student.id).map(recalculateAssignment);
  const attempts = db.testAttempts.filter((attempt) => attempt.userId === student.id).sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime());
  const certificates = db.certificates.filter((certificate) => certificate.userId === student.id);
  const notifications = db.notifications.filter((note) => note.recipientUserId === student.id || note.recipientEmail === student.email);
  const returnTo = `/admin/users/${encodeURIComponent(student.id)}`;
  return adminShell(
    admin,
    displayUserName(student) || student.email,
    `<section class="section">
      <div class="section-heading">
        <div><span class="eyebrow">Профиль студента</span><h1>${escapeHtml(displayUserName(student) || student.email)}</h1><p class="lead">${escapeHtml(student.email)} · ${escapeHtml(student.position || "Должность не указана")}</p></div>
        <div class="actions"><a class="button secondary" href="/admin/users">Все студенты</a><a class="button" href="/admin/certificates?userId=${encodeURIComponent(student.id)}">Сертификаты</a></div>
      </div>
      <div class="grid four">
        <article class="metric"><span class="muted">Курсы</span><strong class="metric-value">${assignments.length}</strong></article>
        <article class="metric"><span class="muted">Завершено</span><strong class="metric-value">${assignments.filter((item) => item.status === "completed").length}</strong></article>
        <article class="metric"><span class="muted">Попытки тестов</span><strong class="metric-value">${attempts.length}</strong></article>
        <article class="metric"><span class="muted">Сертификаты</span><strong class="metric-value">${certificates.length}</strong></article>
      </div>
      ${adminStudentCard(student, admin)}
      <article class="panel stack">
        <h2>Курсы и прогресс</h2>
        <table class="table">
          <thead><tr><th>Курс</th><th>Статус</th><th>Прогресс</th><th>Попытки</th><th>Сертификат</th><th>Действия</th></tr></thead>
          <tbody>${assignments
            .map((assignment) => {
              const course = courseById(assignment.courseId);
              const cert = activeCertificateForAssignment(assignment.id);
              return `<tr>
                <td>${escapeHtml(course?.title ?? "Курс удален")}</td>
                <td>${badge(assignment.status)}</td>
                <td>${assignment.progressPercent ?? 0}%</td>
                <td>${attemptsFor(assignment.id).length} / ${(course?.test?.attemptsLimit ?? 0) + (assignment.extraTestAttempts ?? 0)}</td>
                <td>${cert ? `<a class="small-button" href="/certificates/${cert.id}">${escapeHtml(cert.certificateNumber)}</a>` : `<span class="muted">Нет</span>`}</td>
                <td>${assignmentAdminActions(assignment, returnTo)}</td>
              </tr>`;
            })
            .join("") || `<tr><td colspan="6"><span class="muted">Курсы не назначены.</span></td></tr>`}</tbody>
        </table>
      </article>
      <article class="panel stack">
        <h2>Попытки тестов</h2>
        <table class="table">
          <thead><tr><th>Курс</th><th>Попытка</th><th>Результат</th><th>Дата</th><th>Ошибки</th></tr></thead>
          <tbody>${attempts
            .map((attempt) => {
              const assignment = db.assignments.find((item) => item.id === attempt.assignmentId);
              const course = assignment ? courseById(assignment.courseId) : null;
              return `<tr>
                <td>${escapeHtml(course?.title ?? "Курс удален")}</td>
                <td>${attempt.attemptNumber}</td>
                <td>${attempt.scorePercent}% ${badge(attempt.status === "passed" ? "test_passed" : "test_failed")}</td>
                <td>${new Date(attempt.finishedAt).toLocaleString("ru-RU")}</td>
                <td>${attemptWrongAnswersHtml(attempt)}</td>
              </tr>`;
            })
            .join("") || `<tr><td colspan="5"><span class="muted">Попыток пока нет.</span></td></tr>`}</tbody>
        </table>
      </article>
      <article class="panel stack">
        <h2>Уведомления студента</h2>
        <table class="table">
          <thead><tr><th>Тип</th><th>Событие</th><th>Статус</th><th>Дата</th></tr></thead>
          <tbody>${notifications
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((note) => `<tr><td>${escapeHtml(note.type)}</td><td>${escapeHtml(note.payload || "")}</td><td>${badge(note.status)}</td><td>${new Date(note.createdAt).toLocaleString("ru-RU")}</td></tr>`)
            .join("") || `<tr><td colspan="4"><span class="muted">Уведомлений нет.</span></td></tr>`}</tbody>
        </table>
      </article>
    </section>`
  );
}

function reportParams(searchParams = new URLSearchParams()) {
  return {
    q: (searchParams.get("q") ?? "").trim(),
    userId: searchParams.get("userId") ?? "",
    courseId: searchParams.get("courseId") ?? "",
    status: searchParams.get("status") ?? ""
  };
}

function reportQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

function userSelectOptions(selectedUserId) {
  return db.users
    .filter((item) => item.role === "student")
    .sort((a, b) => displayUserName(a).localeCompare(displayUserName(b), "ru"))
    .map((student) => `<option value="${student.id}" ${selectedUserId === student.id ? "selected" : ""}>${escapeHtml(displayUserName(student) || student.email)} (${escapeHtml(student.email)})</option>`)
    .join("");
}

function courseSelectOptions(selectedCourseId) {
  return [...db.courses]
    .sort((a, b) => a.title.localeCompare(b.title, "ru"))
    .map((course) => `<option value="${course.id}" ${selectedCourseId === course.id ? "selected" : ""}>${escapeHtml(course.title)}</option>`)
    .join("");
}

function assignmentStatusOptions(selectedStatus) {
  const statuses = ["", "not_started", "in_progress", "test_available", "test_failed", "completed"];
  return statuses
    .map((status) => `<option value="${status}" ${selectedStatus === status ? "selected" : ""}>${status ? statusLabel(status) : "Все статусы"}</option>`)
    .join("");
}

function filteredAssignments(params) {
  return db.assignments
    .map(recalculateAssignment)
    .filter((assignment) => {
      const student = userById(assignment.userId);
      const course = courseById(assignment.courseId);
      if (params.userId && assignment.userId !== params.userId) return false;
      if (params.courseId && assignment.courseId !== params.courseId) return false;
      if (params.status && assignment.status !== params.status) return false;
      return matchesQuery([displayUserName(student), student?.email, student?.company, student?.position, course?.title, statusLabel(assignment.status)], params.q);
    });
}

function adminReports(user, searchParams = new URLSearchParams()) {
  const params = reportParams(searchParams);
  const assignments = filteredAssignments(params);
  const returnTo = `/admin/reports${reportQuery(params)}`;
  return adminShell(
    user,
    "Отчеты",
    `<section class="section">
      <div><span class="eyebrow">Отчеты</span><h1>Прогресс обучения</h1><p class="lead">Контроль статусов студентов по курсам, тестам и сертификатам.</p></div>
      <form class="form-panel" method="get" action="/admin/reports">
        <h2>Фильтры</h2>
        <div class="admin-edit-grid">
          <div class="field"><label>Поиск</label><input name="q" value="${escapeHtml(params.q)}" placeholder="Студент, email, курс" /></div>
          <div class="field"><label>Студент</label><select name="userId"><option value="">Все студенты</option>${userSelectOptions(params.userId)}</select></div>
          <div class="field"><label>Курс</label><select name="courseId"><option value="">Все курсы</option>${courseSelectOptions(params.courseId)}</select></div>
          <div class="field"><label>Статус</label><select name="status">${assignmentStatusOptions(params.status)}</select></div>
        </div>
        <div class="table-actions"><button class="small-button primary" type="submit">Применить</button><a class="small-button" href="/admin/reports">Сбросить</a></div>
      </form>
      <div class="grid four">
        <article class="metric"><span class="muted">Не начали</span><strong class="metric-value">${assignments.filter((item) => item.status === "not_started").length}</strong></article>
        <article class="metric"><span class="muted">В процессе</span><strong class="metric-value">${assignments.filter((item) => item.status === "in_progress" || item.status === "test_available").length}</strong></article>
        <article class="metric"><span class="muted">Тест не сдан</span><strong class="metric-value">${assignments.filter((item) => item.status === "test_failed").length}</strong></article>
        <article class="metric"><span class="muted">Завершили</span><strong class="metric-value">${assignments.filter((item) => item.status === "completed").length}</strong></article>
      </div>
      <table class="table">
        <thead><tr><th>Студент</th><th>Курс</th><th>Статус</th><th>Прогресс</th><th>Тесты</th><th>Сертификат</th><th>Действия</th></tr></thead>
        <tbody>${assignments
          .map((assignment) => {
            const student = userById(assignment.userId);
            const course = courseById(assignment.courseId);
            const cert = activeCertificateForAssignment(assignment.id);
            return `<tr>
              <td><a class="link-line" href="/admin/users/${assignment.userId}">${escapeHtml(displayUserName(student) || student?.email || "")}</a><br><span class="muted">${escapeHtml(student?.email ?? "")}</span></td>
              <td>${escapeHtml(course?.title ?? "Курс удален")}</td>
              <td>${badge(assignment.status)}</td>
              <td>${assignment.progressPercent ?? 0}%</td>
              <td>${attemptsFor(assignment.id).length} / ${(course?.test?.attemptsLimit ?? 0) + (assignment.extraTestAttempts ?? 0)}</td>
              <td>${cert ? `<a class="small-button" href="/certificates/${cert.id}">${escapeHtml(cert.certificateNumber)}</a>` : `<span class="muted">Нет</span>`}</td>
              <td>${assignmentAdminActions(assignment, returnTo)}</td>
            </tr>`;
          })
          .join("") || `<tr><td colspan="7"><span class="muted">Назначения не найдены.</span></td></tr>`}</tbody>
      </table>
    </section>`
  );
}

function testReportParams(searchParams = new URLSearchParams()) {
  return {
    q: (searchParams.get("q") ?? "").trim(),
    userId: searchParams.get("userId") ?? "",
    courseId: searchParams.get("courseId") ?? "",
    status: searchParams.get("status") ?? ""
  };
}

function testStatusOptions(selectedStatus) {
  return ["", "passed", "failed"]
    .map((status) => `<option value="${status}" ${selectedStatus === status ? "selected" : ""}>${status ? (status === "passed" ? "Сдан" : "Не сдан") : "Все результаты"}</option>`)
    .join("");
}

function filteredAttempts(params) {
  return db.testAttempts
    .filter((attempt) => {
      const student = userById(attempt.userId);
      const assignment = db.assignments.find((item) => item.id === attempt.assignmentId);
      const course = assignment ? courseById(assignment.courseId) : null;
      if (params.userId && attempt.userId !== params.userId) return false;
      if (params.courseId && assignment?.courseId !== params.courseId) return false;
      if (params.status && attempt.status !== params.status) return false;
      return matchesQuery([displayUserName(student), student?.email, course?.title, attempt.status], params.q);
    })
    .sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime());
}

function adminTests(user, searchParams = new URLSearchParams()) {
  const params = testReportParams(searchParams);
  const attempts = filteredAttempts(params);
  const passed = attempts.filter((attempt) => attempt.status === "passed").length;
  return adminShell(
    user,
    "Тесты",
    `<section class="section">
      <div><span class="eyebrow">Тесты</span><h1>Попытки и ошибки</h1><p class="lead">Здесь можно посмотреть результаты, неправильные ответы и перейти к студенту для сброса или разблокировки пересдачи.</p></div>
      <form class="form-panel" method="get" action="/admin/tests">
        <h2>Фильтры</h2>
        <div class="admin-edit-grid">
          <div class="field"><label>Поиск</label><input name="q" value="${escapeHtml(params.q)}" placeholder="Студент, email, курс" /></div>
          <div class="field"><label>Студент</label><select name="userId"><option value="">Все студенты</option>${userSelectOptions(params.userId)}</select></div>
          <div class="field"><label>Курс</label><select name="courseId"><option value="">Все курсы</option>${courseSelectOptions(params.courseId)}</select></div>
          <div class="field"><label>Результат</label><select name="status">${testStatusOptions(params.status)}</select></div>
        </div>
        <div class="table-actions"><button class="small-button primary" type="submit">Применить</button><a class="small-button" href="/admin/tests">Сбросить</a></div>
      </form>
      <div class="grid three">
        <article class="metric"><span class="muted">Попытки</span><strong class="metric-value">${attempts.length}</strong></article>
        <article class="metric"><span class="muted">Сдано</span><strong class="metric-value">${passed}</strong></article>
        <article class="metric"><span class="muted">Не сдано</span><strong class="metric-value">${attempts.length - passed}</strong></article>
      </div>
      <table class="table">
        <thead><tr><th>Студент</th><th>Курс</th><th>Попытка</th><th>Результат</th><th>Дата</th><th>Ошибки</th></tr></thead>
        <tbody>${attempts
          .map((attempt) => {
            const student = userById(attempt.userId);
            const assignment = db.assignments.find((item) => item.id === attempt.assignmentId);
            const course = assignment ? courseById(assignment.courseId) : null;
            return `<tr>
              <td><a class="link-line" href="/admin/users/${attempt.userId}">${escapeHtml(displayUserName(student) || student?.email || "")}</a><br><span class="muted">${escapeHtml(student?.email ?? "")}</span></td>
              <td>${escapeHtml(course?.title ?? "Курс удален")}</td>
              <td>${attempt.attemptNumber}</td>
              <td>${attempt.scorePercent}% ${badge(attempt.status === "passed" ? "test_passed" : "test_failed")}</td>
              <td>${new Date(attempt.finishedAt).toLocaleString("ru-RU")}</td>
              <td>${attemptWrongAnswersHtml(attempt)}</td>
            </tr>`;
          })
          .join("") || `<tr><td colspan="6"><span class="muted">Попытки не найдены.</span></td></tr>`}</tbody>
      </table>
    </section>`
  );
}

function adminHomepage(user) {
  const courses = [...db.courses].sort(
    (a, b) =>
      Number(Boolean(b.showOnHome)) - Number(Boolean(a.showOnHome)) ||
      courseHomeSortValue(a) - courseHomeSortValue(b) ||
      a.title.localeCompare(b.title, "ru")
  );
  const selectedCount = courses.filter((course) => course.showOnHome && course.status === "active").length;
  const selectionMode = db.settings?.homepageCourseSelectionEnabled
    ? `<div class="notice"><strong>Витрина настроена.</strong><br>На главной показываются только отмеченные активные курсы.</div>`
    : `<div class="notice"><strong>Витрина еще не сохранена.</strong><br>До первого сохранения главная показывает несколько активных курсов автоматически.</div>`;
  return adminShell(
    user,
    "Главная",
    `<section class="section">
      <div>
        <span class="eyebrow">Главная страница</span>
        <h1>Витрина курсов</h1>
        <p class="lead">Выберите, какие курсы показывать на первой странице программы, и задайте порядок отображения.</p>
      </div>
      ${selectionMode}
      <form class="form-panel" method="post" action="/admin/homepage/courses">
        <div class="section-heading">
          <div><h2>Курсы на главной</h2><p class="muted">Сейчас выбрано активных курсов: ${selectedCount}</p></div>
          <button class="button" type="submit">Сохранить витрину</button>
        </div>
        <table class="table">
          <thead><tr><th>Показ</th><th>Курс</th><th>Статус</th><th>Порядок</th></tr></thead>
          <tbody>${courses
            .map(
              (course) => `<tr>
                <td><label class="checkbox-row"><input name="showOnHome" type="checkbox" value="${course.id}" ${course.showOnHome ? "checked" : ""} /> На главной</label></td>
                <td><div class="course-title-cell">${courseCoverHtml(course, "thumb")}<div><strong>${escapeHtml(course.title)}</strong><br><span class="muted">${escapeHtml(course.shortDescription)}</span></div></div></td>
                <td>${badge(course.status)}</td>
                <td><input name="homeSortOrder:${course.id}" type="number" min="1" value="${courseHomeSortValue(course)}" /></td>
              </tr>`
            )
            .join("")}</tbody>
        </table>
        <div class="table-actions"><button class="button" type="submit">Сохранить витрину</button><a class="button secondary" href="/">Открыть главную</a></div>
      </form>
    </section>`
  );
}

function adminCourses(user, searchParams = new URLSearchParams()) {
  const params = listParams(searchParams);
  const courses = db.courses.filter((course) =>
    matchesQuery([course.title, course.shortDescription, course.fullDescription, course.goals, course.status], params.q)
  );
  const pagination = paginateItems(courses, params);
  return adminShell(
    user,
    "Курсы",
    `<section class="section">
      <div class="section-heading">
        <div><span class="eyebrow">Курсы</span><h1>Управление курсами</h1><p class="lead">Курс состоит из уроков, обязательных материалов и финального теста.</p></div>
        <a class="button secondary" href="/admin/homepage">Настроить главную</a>
      </div>
      <form class="inline-form" method="get" action="/admin/courses">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Поиск курсов" />
        <button class="small-button primary" type="submit">Найти</button>
      </form>
      <form class="form-panel" method="post" action="/admin/courses/create" enctype="multipart/form-data">
        <h2>Создать курс</h2>
        <div class="field"><label>Название</label><input name="title" required /></div>
        <div class="field"><label>Краткое описание</label><textarea name="shortDescription" required></textarea></div>
        <div class="field"><label>Цели</label><textarea name="goals"></textarea></div>
        <div class="field"><label>Обложка курса</label><input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></div>
        <div class="admin-edit-grid">
          <label class="checkbox-row"><input name="showOnHome" type="checkbox" /> Показывать на главной</label>
          <div class="field"><label>Порядок на главной</label><input name="homeSortOrder" type="number" min="1" value="999" /></div>
        </div>
        <button class="button" type="submit">Создать курс</button>
      </form>
      <table class="table">
        <thead><tr><th>Курс</th><th>Главная</th><th>Статус</th><th>Материалы</th><th>Тест</th><th>Действия</th></tr></thead>
        <tbody>${pagination.items
          .map((course) => `<tr>
            <td><div class="course-title-cell">${courseCoverHtml(course, "thumb")}<div><strong>${escapeHtml(course.title)}</strong><br><span class="muted">${escapeHtml(course.shortDescription)}</span></div></div></td>
            <td>${course.showOnHome ? `<span class="status-pill">Показ</span><br><span class="muted">#${courseHomeSortValue(course)}</span>` : `<span class="muted">Нет</span>`}</td>
            <td>${badge(course.status)}</td>
            <td>${requiredMaterials(course).length} обязательных</td>
            <td>${course.test?.questions.length ?? 0} вопросов, проходной ${course.test?.passingPercent ?? 0}%</td>
            <td><a class="small-button primary" href="/admin/courses/${course.id}">Редактировать</a></td>
          </tr>`)
          .join("") || `<tr><td colspan="6"><span class="muted">Курсы не найдены.</span></td></tr>`}</tbody>
      </table>
      ${paginationControls("/admin/courses", params, pagination)}
    </section>`
  );
}

function adminFiles(user, searchParams = new URLSearchParams()) {
  const params = listParams(searchParams);
  const report = uploadReport();
  const materialFiles = report.materialFiles.filter((item) => materialFileMatchesQuery(item, params.q));
  const pagination = paginateItems(materialFiles, params);
  const missingFiles = report.missingMaterialFiles.filter((item) => materialFileMatchesQuery(item, params.q));
  const filteredUnlinkedVideos = report.unlinkedVideos.filter((item) => uploadFileMatchesQuery(item, params.q));
  const filteredUnlinkedUploads = report.unlinkedUploads.filter((item) => uploadFileMatchesQuery(item, params.q) && !item.isVideo);
  const unlinkedVideos = filteredUnlinkedVideos.slice(0, 50);
  const unlinkedUploads = filteredUnlinkedUploads.slice(0, 50);
  const importedCourses = importedCourseSummary();
  const emptyImportedLessons = importedEmptyLessons();
  const lessonOptions = lessonSelectOptions();
  return adminShell(
    user,
    "Файлы",
    `<section class="section">
      <div><span class="eyebrow">Файлы и видео</span><h1>Проверка учебных файлов</h1><p class="lead">Отчет сверяет материалы курсов с файлами в data/uploads и помогает найти битые ссылки после импорта.</p></div>
      <form class="inline-form" method="get" action="/admin/files">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Поиск по курсу, уроку, файлу" />
        <button class="small-button primary" type="submit">Найти</button>
        <a class="small-button" href="/admin/files">Сбросить</a>
        <a class="small-button" href="/admin/files/import-report.csv">Экспорт отчета импорта</a>
      </form>
      <form method="post" action="/admin/files/auto-link-videos">
        <button class="small-button warning" type="submit">Автопривязать видео по названию</button>
      </form>
      <div class="grid four">
        <article class="metric"><span class="muted">Файлов в uploads</span><strong class="metric-value">${report.uploadFiles.length}</strong></article>
        <article class="metric"><span class="muted">Файлов в материалах</span><strong class="metric-value">${report.materialFiles.length}</strong></article>
        <article class="metric"><span class="muted">Битых ссылок</span><strong class="metric-value">${report.missingMaterialFiles.length}</strong></article>
        <article class="metric"><span class="muted">Видео без урока</span><strong class="metric-value">${report.unlinkedVideos.length}</strong></article>
      </div>
      <article class="panel stack">
        <h2>Материалы, где файл не найден</h2>
        <table class="table">
          <thead><tr><th>Курс</th><th>Урок</th><th>Материал</th><th>Путь</th></tr></thead>
          <tbody>${missingFiles
            .map((item) => `<tr>
              <td>${escapeHtml(item.course.title)}</td>
              <td>${escapeHtml(item.lesson.title)}</td>
              <td>${escapeHtml(item.material.title)}<br><span class="muted">${escapeHtml(item.material.type)}</span></td>
              <td><span class="link-line">${escapeHtml(item.publicPath)}</span></td>
            </tr>`)
            .join("") || `<tr><td colspan="4"><span class="muted">Битых ссылок на локальные файлы не найдено.</span></td></tr>`}</tbody>
        </table>
      </article>
      <article class="panel stack">
        <h2>Видео в uploads без привязки к урокам</h2>
        <table class="table">
          <thead><tr><th>Файл</th><th>Размер</th><th>Изменен</th><th>Действия</th></tr></thead>
          <tbody>${unlinkedVideos
            .map((file) => `<tr>
              <td><span class="link-line">${escapeHtml(file.relativePath)}</span></td>
              <td>${formatBytes(file.size)}</td>
              <td>${formatDate(file.modifiedAt)}</td>
              <td><div class="table-actions">
                <a class="small-button primary" href="${escapeHtml(file.publicPath)}" target="_blank" rel="noopener">Открыть</a>
                ${lessonOptions ? `<form class="inline-form" method="post" action="/admin/files/link-video">
                  <input type="hidden" name="publicPath" value="${escapeHtml(file.publicPath)}" />
                  <input name="title" value="${escapeHtml(file.relativePath.split("/").at(-1) ?? "Video")}" />
                  <select name="lessonRef">${lessonOptions}</select>
                  <label class="checkbox-row"><input name="isRequired" type="checkbox" checked /> обязательный</label>
                  <button class="small-button warning" type="submit">Привязать</button>
                </form>` : `<span class="muted">Сначала создайте урок.</span>`}
              </div></td>
            </tr>`)
            .join("") || `<tr><td colspan="4"><span class="muted">Непривязанных видео не найдено.</span></td></tr>`}</tbody>
        </table>
        ${filteredUnlinkedVideos.length > unlinkedVideos.length ? `<p class="muted">Показаны первые 50 видео. Используйте поиск, чтобы сузить список.</p>` : ""}
      </article>
      <article class="panel stack">
        <h2>Импортированные курсы WordPress/Tutor LMS</h2>
        <table class="table">
          <thead><tr><th>Курс</th><th>WP ID</th><th>Уроки</th><th>Материалы</th><th>Видео</th><th>Битые файлы</th><th>Действия</th></tr></thead>
          <tbody>${importedCourses
            .map((item) => `<tr>
              <td>${escapeHtml(item.course.title)}</td>
              <td>${escapeHtml(item.course.source?.wpCourseId ?? "")}</td>
              <td>${item.lessons}</td>
              <td>${item.materials}</td>
              <td>${item.videos}</td>
              <td>${item.missing ? `<span class="badge warning">${item.missing}</span>` : `<span class="badge success">0</span>`}</td>
              <td><a class="small-button primary" href="/admin/courses/${item.course.id}">Открыть курс</a></td>
            </tr>`)
            .join("") || `<tr><td colspan="7"><span class="muted">Импортированные курсы не найдены.</span></td></tr>`}</tbody>
        </table>
      </article>
      <article class="panel stack">
        <h2>Пустые импортированные курсы и уроки</h2>
        <table class="table">
          <thead><tr><th>Тип</th><th>Курс</th><th>Урок</th><th>Действия</th></tr></thead>
          <tbody>${[
            ...importedCourses
              .filter((item) => item.lessons === 0 || item.materials === 0)
              .map((item) => `<tr><td>${item.lessons === 0 ? "Курс без уроков" : "Курс без материалов"}</td><td>${escapeHtml(item.course.title)}</td><td><span class="muted">-</span></td><td><a class="small-button primary" href="/admin/courses/${item.course.id}">Открыть</a></td></tr>`),
            ...emptyImportedLessons.map(({ course, lesson }) => `<tr><td>Урок без материалов</td><td>${escapeHtml(course.title)}</td><td>${escapeHtml(lesson.title)}</td><td><a class="small-button primary" href="/admin/courses/${course.id}">Открыть</a></td></tr>`)
          ].join("") || `<tr><td colspan="4"><span class="muted">Пустые импортированные курсы и уроки не найдены.</span></td></tr>`}</tbody>
        </table>
      </article>
      <article class="panel stack">
        <h2>Файлы без привязки к урокам</h2>
        <table class="table">
          <thead><tr><th>Файл</th><th>Размер</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody>${unlinkedUploads
            .map((file) => `<tr>
              <td><span class="link-line">${escapeHtml(file.relativePath)}</span></td>
              <td>${formatBytes(file.size)}</td>
              <td>${file.usedAsPhoto ? `<span class="badge success">Фото студента</span>` : `<span class="badge warning">Не привязан</span>`}</td>
              <td><a class="small-button primary" href="${escapeHtml(file.publicPath)}" target="_blank" rel="noopener">Открыть</a></td>
            </tr>`)
            .join("") || `<tr><td colspan="4"><span class="muted">Непривязанных файлов не найдено.</span></td></tr>`}</tbody>
        </table>
        ${filteredUnlinkedUploads.length > unlinkedUploads.length ? `<p class="muted">Показаны первые 50 файлов. Используйте поиск, чтобы сузить список.</p>` : ""}
      </article>
      <article class="panel stack">
        <h2>Материалы с локальными файлами</h2>
        <table class="table">
          <thead><tr><th>Курс</th><th>Урок</th><th>Материал</th><th>Файл</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody>${pagination.items
            .map((item) => `<tr>
              <td>${escapeHtml(item.course.title)}</td>
              <td>${escapeHtml(item.lesson.title)}</td>
              <td>${escapeHtml(item.material.title)}<br><span class="muted">${escapeHtml(item.material.type)}</span></td>
              <td><span class="link-line">${escapeHtml(item.relativePath)}</span><br><span class="muted">${formatBytes(item.size)}</span></td>
              <td>${fileBadge(item.exists)}</td>
              <td>${item.exists ? `<a class="small-button primary" href="${escapeHtml(item.publicPath)}" target="_blank" rel="noopener">Открыть</a>` : ""}</td>
            </tr>`)
            .join("") || `<tr><td colspan="6"><span class="muted">Локальные файлы в материалах не найдены.</span></td></tr>`}</tbody>
        </table>
        ${paginationControls("/admin/files", params, pagination)}
      </article>
    </section>`
  );
}

function adminCourseDetail(user, course) {
  const previewCertificate = sampleCertificateForCourse(course);
  const certificateDesignerBlock = certificateDesignerEditorHtml(course, previewCertificate);
  return adminShell(
    user,
    course.title,
    `<section class="section">
      <div><span class="eyebrow">Редактор курса</span><h1>${escapeHtml(course.title)}</h1><p class="lead">${escapeHtml(course.fullDescription || course.shortDescription)}</p></div>
      ${certificateDesignerBlock}
      <form class="form-panel" method="post" action="/admin/courses/${course.id}/update" enctype="multipart/form-data">
        <h2>Основная информация</h2>
        ${courseCoverHtml(course, "editor")}
        <div class="field"><label>Название</label><input name="title" value="${escapeHtml(course.title)}" required /></div>
        <div class="field"><label>Краткое описание</label><textarea name="shortDescription" required>${escapeHtml(course.shortDescription)}</textarea></div>
        <div class="field"><label>Полное описание</label><textarea name="fullDescription">${escapeHtml(course.fullDescription || "")}</textarea></div>
        <div class="field"><label>Цели</label><textarea name="goals">${escapeHtml(course.goals || "")}</textarea></div>
        <div class="admin-edit-grid">
          <div class="field"><label>Заменить обложку</label><input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></div>
          <label class="checkbox-row"><input name="removeImage" type="checkbox" /> Удалить обложку</label>
        </div>
        <div class="admin-edit-grid">
          <label class="checkbox-row"><input name="showOnHome" type="checkbox" ${course.showOnHome ? "checked" : ""} /> Показывать на главной</label>
          <div class="field"><label>Порядок на главной</label><input name="homeSortOrder" type="number" min="1" value="${courseHomeSortValue(course)}" /></div>
        </div>
        <div class="field"><label>Статус</label><select name="status"><option value="active" ${course.status === "active" ? "selected" : ""}>Активен</option><option value="inactive" ${course.status === "inactive" ? "selected" : ""}>Отключен</option></select></div>
        <button class="button" type="submit">Сохранить</button>
      </form>
      <article class="panel certificate-template">
        <h2>Шаблон сертификата</h2>
        <p class="muted">Срок действия сертификата всегда рассчитывается автоматически: дата выдачи плюс 5 лет.</p>
        <div class="template-token-list">
          <code>{{firstName}}</code><code>{{lastName}}</code><code>{{fullName}}</code><code>{{birthDate}}</code><code>{{position}}</code><code>{{company}}</code><code>{{courseTitle}}</code><code>{{certificateNumber}}</code><code>{{issuedAt}}</code><code>{{expiresAt}}</code><code>{{photoImage}}</code><code>{{photoUrl}}</code><code>{{verificationUrl}}</code><code>{{qrCode}}</code>
        </div>
        <form class="stack" method="post" action="/admin/courses/${course.id}/certificate-template" enctype="multipart/form-data">
          <div class="field"><label>HTML-шаблон</label><textarea name="certificateTemplateHtml">${escapeHtml(course.certificateTemplateHtml || defaultCertificateTemplate())}</textarea></div>
          <div class="admin-edit-grid">
            <div class="field"><label>Загрузить HTML-файл</label><input name="templateFile" type="file" accept=".html,text/html,text/plain" /></div>
            <label class="checkbox-row"><input name="resetTemplate" type="checkbox" /> Сбросить к базовому шаблону</label>
          </div>
          <button class="button" type="submit">Сохранить шаблон</button>
        </form>
        <div class="certificate-preview-actions">
          <a class="small-button primary" href="/admin/courses/${course.id}/certificate-template/preview">Открыть предпросмотр</a>
          <span class="muted">Образец показывает текущий HTML-шаблон с тестовыми данными студента.</span>
        </div>
        <div class="certificate-preview-frame">
          <div class="${certificateShellClass(previewCertificate.certificateHtml, "certificate-preview")}">${previewCertificate.certificateHtml}</div>
        </div>
      </article>
      <article class="panel stack">
        <h2>Уроки и материалы</h2>
        <div class="course-editor-list">${course.lessons
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(
            (lesson) => `<article class="lesson-editor">
              <form class="stack" method="post" action="/admin/courses/${course.id}/lessons/${lesson.id}/update">
                <div class="admin-edit-grid">
                  <div class="field"><label>Название урока</label><input name="title" value="${escapeHtml(lesson.title)}" required /></div>
                  <div class="field"><label>Порядок</label><input name="sortOrder" type="number" min="1" value="${lesson.sortOrder}" /></div>
                  <div class="field"><label>Статус</label><select name="status"><option value="active" ${lesson.status === "active" ? "selected" : ""}>Активен</option><option value="inactive" ${lesson.status === "inactive" ? "selected" : ""}>Отключен</option></select></div>
                  <div class="field"><label>Описание</label><input name="description" value="${escapeHtml(lesson.description || "")}" /></div>
                </div>
                <div class="table-actions">
                  <button class="small-button primary" type="submit">Сохранить урок</button>
                </div>
              </form>
              <form method="post" action="/admin/courses/${course.id}/lessons/${lesson.id}/delete">
                <button class="small-button danger" type="submit">Удалить урок</button>
              </form>
              ${lesson.materials
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((material) => `<form class="material-editor" method="post" action="/admin/courses/${course.id}/materials/${material.id}/update" enctype="multipart/form-data">
                  <div class="material-edit-grid">
                    <div class="field"><label>Материал</label><input name="title" value="${escapeHtml(material.title)}" required /></div>
                    <div class="field"><label>Тип</label><select name="type"><option value="text" ${material.type === "text" ? "selected" : ""}>Текст</option><option value="video" ${material.type === "video" ? "selected" : ""}>Видео</option><option value="pdf" ${material.type === "pdf" ? "selected" : ""}>PDF</option><option value="download" ${material.type === "download" ? "selected" : ""}>Файл</option><option value="image" ${material.type === "image" ? "selected" : ""}>Изображение</option></select></div>
                    <div class="field"><label>Порядок</label><input name="sortOrder" type="number" min="1" value="${material.sortOrder}" /></div>
                  </div>
                  <div class="field"><label>Текст или ссылка</label><input name="content" value="${escapeHtml(material.content || "")}" /></div>
                  ${materialContentHtml(material)}
                  <div class="admin-edit-grid">
                    <label class="checkbox-row"><input name="isRequired" type="checkbox" ${material.isRequired ? "checked" : ""} /> Обязательный</label>
                    <div class="field"><label>Заменить файлом</label><input name="file" type="file" /></div>
                  </div>
                  <div class="table-actions">
                    <button class="small-button primary" type="submit">Сохранить материал</button>
                  </div>
                </form>
                <form method="post" action="/admin/courses/${course.id}/materials/${material.id}/delete">
                  <button class="small-button danger" type="submit">Удалить материал</button>
                </form>`)
                .join("")}
              <form class="inline-form" method="post" action="/admin/courses/${course.id}/materials/create" enctype="multipart/form-data">
                <input type="hidden" name="lessonId" value="${lesson.id}" />
                <input name="title" placeholder="Название материала" required />
                <select name="type"><option value="text">Текст</option><option value="video">Видео</option><option value="pdf">PDF</option><option value="download">Файл</option><option value="image">Изображение</option></select>
                <input name="content" placeholder="Текст или ссылка" />
                <label class="checkbox-row"><input name="isRequired" type="checkbox" checked /> Обязательный</label>
                <input name="file" type="file" />
                <button class="small-button primary" type="submit">Добавить материал</button>
              </form>
            </article>`
          )
          .join("")}</div>
        <form class="inline-form" method="post" action="/admin/courses/${course.id}/lessons/create">
          <input name="title" placeholder="Название урока" required />
          <input name="description" placeholder="Описание" />
          <button class="small-button primary" type="submit">Добавить урок</button>
        </form>
      </article>
      <article class="panel stack">
        <h2>Финальный тест</h2>
        <form class="inline-form" method="post" action="/admin/courses/${course.id}/test/settings">
          <input name="title" value="${escapeHtml(course.test?.title ?? "Финальный тест")}" required />
          <input name="attemptsLimit" type="number" min="1" value="${course.test?.attemptsLimit ?? 3}" />
          <input name="passingPercent" type="number" min="1" max="100" value="${course.test?.passingPercent ?? 80}" />
          <input name="timeLimitMinutes" type="number" min="0" value="${course.test?.timeLimitMinutes ?? 0}" />
          <select name="status"><option value="active" ${course.test?.status === "active" ? "selected" : ""}>Активен</option><option value="inactive" ${course.test?.status === "inactive" ? "selected" : ""}>Отключен</option></select>
          <label class="checkbox-row"><input name="showResultToUser" type="checkbox" ${course.test?.showResultToUser ? "checked" : ""} /> Показывать результат</label>
          <label class="checkbox-row"><input name="allowRetake" type="checkbox" ${course.test?.allowRetake ? "checked" : ""} /> Разрешить повторы</label>
          <button class="small-button primary" type="submit">Сохранить тест</button>
        </form>
        ${(course.test?.questions ?? [])
          .map(
            (question) => {
              return `<article class="card stack">
                <form class="stack" method="post" action="/admin/courses/${course.id}/test/questions/${question.id}/update">
                  <div class="field"><label>Вопрос</label><input name="questionText" value="${escapeHtml(question.questionText)}" required /></div>
                  <div class="admin-edit-grid">
                    ${questionEditorFields(question)}
                    <div class="field"><label>Порядок</label><input name="sortOrder" type="number" min="1" value="${question.sortOrder}" /></div>
                  </div>
                  <button class="small-button primary" type="submit">Сохранить вопрос</button>
                </form>
                <form method="post" action="/admin/courses/${course.id}/test/questions/${question.id}/delete">
                  <button class="small-button danger" type="submit">Удалить вопрос</button>
                </form>
              </article>`;
            }
          )
          .join("")}
        <form class="form-panel" method="post" action="/admin/courses/${course.id}/test/questions/create">
          <h3>Добавить вопрос</h3>
          <div class="field"><label>Вопрос</label><input name="questionText" required /></div>
          <div class="admin-edit-grid">${questionEditorFields()}</div>
          <button class="button" type="submit">Добавить вопрос</button>
        </form>
        <a class="small-button primary" href="/admin/courses/${course.id}/test/preview">Предпросмотр теста</a>
      </article>
    </section>`
  );
}

function adminCertificateTemplatePreview(user, course) {
  const previewCertificate = sampleCertificateForCourse(course);
  return adminShell(
    user,
    "Предпросмотр сертификата",
    `<section class="section">
      <div>
        <span class="eyebrow">Шаблон сертификата</span>
        <h1>${escapeHtml(course.title)}</h1>
        <p class="lead">Предпросмотр использует тестовые данные и не создает сертификат в базе.</p>
      </div>
      <div class="actions">
        <a class="button secondary" href="/admin/courses/${course.id}">Назад к курсу</a>
      </div>
      <div class="${certificateShellClass(previewCertificate.certificateHtml)}">${previewCertificate.certificateHtml}</div>
    </section>`
  );
}

function adminCertificateActions(certificate, returnTo = "/admin/certificates") {
  const canRevoke = certificate.status === "issued";
  const canReissue = certificate.status === "issued" || certificate.status === "revoked";
  const returnInput = `<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />`;
  return `<div class="table-actions">
    <a class="small-button primary" href="/certificates/${certificate.id}">Открыть</a>
    <a class="small-button" href="/certificates/${certificate.id}.pdf">PDF</a>
    <a class="small-button" href="${escapeHtml(certificateVerificationUrl(certificate))}" target="_blank" rel="noopener">Проверка</a>
    ${canRevoke ? `<form method="post" action="/admin/certificates/revoke"><input type="hidden" name="id" value="${certificate.id}" />${returnInput}<button class="small-button danger" type="submit">Отозвать</button></form>` : ""}
    ${canReissue ? `<form method="post" action="/admin/certificates/reissue"><input type="hidden" name="id" value="${certificate.id}" />${returnInput}<button class="small-button warning" type="submit">Перевыпустить</button></form>` : ""}
    <form method="post" action="/admin/certificates/resend"><input type="hidden" name="id" value="${certificate.id}" />${returnInput}<button class="small-button" type="submit">Отправить повторно</button></form>
  </div>`;
}

function certificateFilterParams(searchParams = new URLSearchParams()) {
  const dateValue = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : "");
  return {
    q: (searchParams.get("q") ?? "").trim(),
    userId: searchParams.get("userId") ?? "",
    courseId: searchParams.get("courseId") ?? "",
    status: searchParams.get("status") ?? "",
    issuedFrom: dateValue(searchParams.get("issuedFrom")),
    issuedTo: dateValue(searchParams.get("issuedTo"))
  };
}

function certificateFilterSearchParams(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return params;
}

function certificateFilterQuery(filters) {
  const query = certificateFilterSearchParams(filters).toString();
  return query ? `?${query}` : "";
}

function certificateReturnTo(filters) {
  return `/admin/certificates${certificateFilterQuery(filters)}`;
}

function dateBoundary(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function certificateIssuedInRange(certificate, filters) {
  const issuedAt = new Date(certificate.issuedAt);
  if (Number.isNaN(issuedAt.getTime())) return false;
  const from = dateBoundary(filters.issuedFrom);
  const to = dateBoundary(filters.issuedTo, true);
  if (from && issuedAt < from) return false;
  if (to && issuedAt > to) return false;
  return true;
}

function certificateMatchesFilters(certificate, filters) {
  const student = userById(certificate.userId);
  if (filters.userId && certificate.userId !== filters.userId) return false;
  if (filters.courseId && certificate.courseId !== filters.courseId) return false;
  if (filters.status && certificate.status !== filters.status) return false;
  if (!certificateIssuedInRange(certificate, filters)) return false;
  return matchesQuery(
    [
      certificate.certificateNumber,
      statusLabel(certificate.status),
      displayUserName(student),
      student?.email,
      student?.company,
      student?.position,
      certificate.snapshotCourseTitle
    ],
    filters.q
  );
}

function filteredCertificates(filters) {
  return [...db.certificates]
    .filter((certificate) => certificateMatchesFilters(certificate, filters))
    .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
}

function certificateEventActionLabel(action) {
  const labels = {
    issued: "Выдан автоматически",
    manual_issue: "Выдан вручную",
    issued_after_student_photo: "Выдан после загрузки фото студентом",
    issued_after_admin_photo: "Выдан после загрузки фото админом",
    revoked: "Отозван",
    reissued: "Создан новый при перевыпуске",
    replaced_by_reissue: "Заменен при перевыпуске",
    resent: "Отправлен повторно"
  };
  return labels[action] ?? action;
}

function certificateEventActorLabel(event) {
  if (!event.actorEmail || event.actorEmail === "system") return "Система";
  return `${event.actorEmail} (${event.actorRole})`;
}

function certificateEventDetailsText(details = {}) {
  const labels = {
    assignmentId: "Назначение",
    replacesCertificateId: "Заменяет ID",
    newCertificateId: "Новый ID",
    newCertificateNumber: "Новый номер"
  };
  const rows = Object.entries(details)
    .filter(([, value]) => value)
    .map(([key, value]) => `${labels[key] ?? key}: ${value}`);
  return rows.join("; ");
}

function certificateEventsForCertificates(certificates) {
  const certificateIds = new Set(certificates.map((certificate) => certificate.id));
  if (!certificateIds.size) return [];
  return [...(db.certificateEvents ?? [])]
    .filter((event) => certificateIds.has(event.certificateId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 100);
}

function certificateEventsTable(events) {
  return `<article class="panel stack">
    <h2>Журнал действий по сертификатам</h2>
    <table class="table">
      <thead><tr><th>Дата</th><th>Номер</th><th>Студент</th><th>Действие</th><th>Исполнитель</th><th>Детали</th></tr></thead>
      <tbody>${events
        .map((event) => {
          const student = userById(event.userId);
          const details = certificateEventDetailsText(event.details);
          return `<tr>
            <td>${new Date(event.createdAt).toLocaleString("ru-RU")}</td>
            <td>${escapeHtml(event.certificateNumber)}</td>
            <td>${escapeHtml(displayUserName(student))}<br><span class="muted">${escapeHtml(student?.email ?? "")}</span></td>
            <td>${escapeHtml(certificateEventActionLabel(event.action))}</td>
            <td>${escapeHtml(certificateEventActorLabel(event))}</td>
            <td><div class="certificate-event-detail">${details ? escapeHtml(details) : "—"}</div></td>
          </tr>`;
        })
        .join("") || `<tr><td colspan="6"><span class="muted">Действий пока нет.</span></td></tr>`}</tbody>
    </table>
  </article>`;
}

function pendingCertificateAssignments(filters) {
  if (filters.status && filters.status !== "pending_photo") return [];
  if (filters.issuedFrom || filters.issuedTo) return [];
  return db.assignments
    .filter((assignment) => {
      if (filters.userId && assignment.userId !== filters.userId) return false;
      if (filters.courseId && assignment.courseId !== filters.courseId) return false;
      if (assignment.status !== "completed" || activeCertificateForAssignment(assignment.id)) return false;
      const student = userById(assignment.userId);
      const course = courseById(assignment.courseId);
      if (hasCertificatePhoto(student)) return false;
      return matchesQuery(
        [displayUserName(student), student?.email, student?.company, student?.position, course?.title, statusLabel("pending_photo")],
        filters.q
      );
    })
    .sort((a, b) => new Date(b.completedAt || b.assignedAt).getTime() - new Date(a.completedAt || a.assignedAt).getTime());
}

function certificateStatusOptions(selectedStatus) {
  const options = [
    ["", "Все статусы"],
    ["issued", statusLabel("issued")],
    ["revoked", statusLabel("revoked")],
    ["reissued", statusLabel("reissued")],
    ["pending_photo", statusLabel("pending_photo")]
  ];
  return options
    .map(([value, label]) => `<option value="${value}" ${selectedStatus === value ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

function certificateFilterForm(filters) {
  const students = db.users
    .filter((item) => item.role === "student")
    .sort((a, b) => displayUserName(a).localeCompare(displayUserName(b), "ru"));
  const courses = [...db.courses].sort((a, b) => a.title.localeCompare(b.title, "ru"));
  const csvExportHref = `/admin/certificates/export.csv${certificateFilterQuery(filters)}`;
  const excelExportHref = `/admin/certificates/export.xls${certificateFilterQuery(filters)}`;
  return `<form class="form-panel" method="get" action="/admin/certificates">
    <h2>Фильтры сертификатов</h2>
    <div class="admin-edit-grid">
      <div class="field"><label>Поиск</label><input name="q" value="${escapeHtml(filters.q)}" placeholder="Номер, студент, email или курс" /></div>
      <div class="field"><label>Студент</label><select name="userId"><option value="">Все студенты</option>${students
        .map((student) => `<option value="${student.id}" ${filters.userId === student.id ? "selected" : ""}>${escapeHtml(displayUserName(student) || student.email)} (${escapeHtml(student.email)})</option>`)
        .join("")}</select></div>
      <div class="field"><label>Курс</label><select name="courseId"><option value="">Все курсы</option>${courses
        .map((course) => `<option value="${course.id}" ${filters.courseId === course.id ? "selected" : ""}>${escapeHtml(course.title)}</option>`)
        .join("")}</select></div>
      <div class="field"><label>Статус</label><select name="status">${certificateStatusOptions(filters.status)}</select></div>
      <div class="field"><label>Выдан с</label><input name="issuedFrom" type="date" value="${escapeHtml(filters.issuedFrom)}" /></div>
      <div class="field"><label>Выдан по</label><input name="issuedTo" type="date" value="${escapeHtml(filters.issuedTo)}" /></div>
    </div>
    <div class="table-actions">
      <button class="small-button primary" type="submit">Применить</button>
      <a class="small-button" href="/admin/certificates">Сбросить</a>
      <a class="small-button" href="${escapeHtml(csvExportHref)}">Экспорт CSV</a>
      <a class="small-button" href="${escapeHtml(excelExportHref)}">Excel-реестр</a>
    </div>
  </form>`;
}

function certificateExportRows(searchParams = new URLSearchParams()) {
  const filters = certificateFilterParams(searchParams);
  const certificates = filteredCertificates(filters);
  return [
    [
      "Номер",
      "Статус",
      "Студент",
      "Email",
      "Должность",
      "Компания",
      "Курс",
      "Дата выдачи",
      "Дата окончания",
      "Проверка QR",
      "ID сертификата",
      "ID назначения"
    ],
    ...certificates.map((certificate) => {
      const student = userById(certificate.userId);
      return [
        certificate.certificateNumber,
        statusLabel(certificate.status),
        displayUserName(student),
        student?.email ?? "",
        certificate.snapshotPosition || student?.position || "",
        certificate.snapshotCompany || student?.company || "",
        certificate.snapshotCourseTitle,
        formatDate(certificate.issuedAt),
        formatDate(certificate.expiresAt),
        certificateVerificationUrl(certificate),
        certificate.id,
        certificate.assignmentId
      ];
    })
  ];
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function certificatesCsv(searchParams = new URLSearchParams()) {
  const rows = certificateExportRows(searchParams);
  return `\uFEFF${rows.map((row) => row.map(csvValue).join(";")).join("\r\n")}`;
}

function sendCertificatesCsv(response, searchParams = new URLSearchParams()) {
  const fileDate = new Date().toISOString().slice(0, 10);
  response.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="certificates-${fileDate}.csv"`
  });
  response.end(certificatesCsv(searchParams));
}

function certificatesExcel(searchParams = new URLSearchParams()) {
  const rows = certificateExportRows(searchParams);
  return `\uFEFF<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    table { border-collapse: collapse; }
    th, td { border: 1px solid #8aaac1; padding: 6px 8px; mso-number-format: "\\@"; }
    th { background: #0b4f7a; color: #ffffff; font-weight: 700; }
  </style>
</head>
<body>
  <table>
    <thead><tr>${rows[0].map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .slice(1)
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
      .join("")}</tbody>
  </table>
</body>
</html>`;
}

function sendCertificatesExcel(response, searchParams = new URLSearchParams()) {
  const fileDate = new Date().toISOString().slice(0, 10);
  response.writeHead(200, {
    "Content-Type": "application/vnd.ms-excel; charset=utf-8",
    "Content-Disposition": `attachment; filename="certificates-${fileDate}.xls"`
  });
  response.end(certificatesExcel(searchParams));
}

function certificateAdminReturnTo(form) {
  const candidate = form.get("returnTo")?.toString() ?? "";
  return candidate === "/admin/certificates" || candidate.startsWith("/admin/certificates?")
    ? candidate
    : "/admin/certificates";
}

function adminReturnTo(form, fallback = "/admin") {
  const candidate = form.get("returnTo")?.toString() ?? "";
  return candidate.startsWith("/admin") ? candidate : fallback;
}

function auditAdminAction(admin, pathname, form) {
  db.auditEvents ??= [];
  const sensitive = /password|pass|csrf|photo|file|template/i;
  const details = {};
  for (const [key, value] of form.entries()) {
    if (sensitive.test(key)) continue;
    details[key] = typeof value === "string" ? value.slice(0, 180) : "[file]";
  }
  db.auditEvents.push({
    id: id("audit"),
    adminUserId: admin.id,
    adminEmail: admin.email,
    action: pathname,
    details,
    createdAt: now()
  });
  if (db.auditEvents.length > 2000) {
    db.auditEvents = db.auditEvents.slice(-2000);
  }
}

function adminCertificates(user, searchParams = new URLSearchParams()) {
  const filters = certificateFilterParams(searchParams);
  const selectedUserId = filters.userId;
  const selectedStudent = selectedUserId ? userById(selectedUserId) : null;
  const certificates = filteredCertificates(filters);
  const pendingCertificates = pendingCertificateAssignments(filters);
  const certificateEvents = certificateEventsForCertificates(certificates);
  const returnTo = certificateReturnTo(filters);
  const selectedStudentNotice = selectedUserId
    ? selectedStudent
      ? `<div class="notice"><strong>Сертификаты студента:</strong> ${escapeHtml(displayUserName(selectedStudent))} (${escapeHtml(selectedStudent.email)}) <a class="small-button" href="/admin/certificates">Показать все</a></div>`
      : `<div class="notice danger">Студент для выбранного фильтра не найден. <a class="small-button" href="/admin/certificates">Показать все</a></div>`
    : "";
  return adminShell(
    user,
    "Сертификаты",
    `<section class="section">
      <div><span class="eyebrow">Сертификаты</span><h1>Выданные сертификаты</h1><p class="lead">Сертификат связан с конкретным студентом, курсом и назначением.</p></div>
      ${selectedStudentNotice}
      ${certificateFilterForm(filters)}
      <table class="table">
        <thead><tr><th>Номер</th><th>Студент</th><th>Курс</th><th>Дата</th><th>Истекает</th><th>Действия</th></tr></thead>
        <tbody>${certificates
          .map((certificate) => {
            const student = userById(certificate.userId);
            return `<tr>
              <td>${escapeHtml(certificate.certificateNumber)}<br>${badge(certificate.status)}</td>
              <td>${escapeHtml(displayUserName(student))}<br><span class="muted">${escapeHtml(student?.email ?? "")}</span></td>
              <td>${escapeHtml(certificate.snapshotCourseTitle)}</td>
              <td>${formatDate(certificate.issuedAt)}</td>
              <td>${formatDate(certificate.expiresAt)}</td>
              <td>${adminCertificateActions(certificate, returnTo)}</td>
            </tr>`;
          })
          .join("") || `<tr><td colspan="6"><span class="muted">Сертификаты еще не выданы.</span></td></tr>`}</tbody>
      </table>
      ${pendingCertificates.length
        ? `<article class="panel stack">
            <h2>Ожидают фото студента</h2>
            ${pendingCertificates.map((assignment) => {
              const student = userById(assignment.userId);
              const course = courseById(assignment.courseId);
              return `<div class="assignment-chip"><span>${escapeHtml(displayUserName(student))}<br><span class="muted">${escapeHtml(student?.email ?? "")}</span></span><span>${escapeHtml(course?.title ?? "")}</span><span class="muted">Сертификат будет создан после загрузки фото.</span></div>`;
            }).join("")}
          </article>`
        : ""}
      ${certificateEventsTable(certificateEvents)}
    </section>`
  );
}

function adminNotifications(user, searchParams = new URLSearchParams()) {
  const params = listParams(searchParams);
  const normalizedQuery = params.q.toLowerCase();
  const notifications = db.notifications.filter((note) => {
    if (!normalizedQuery) return true;
    return [note.type, note.recipientEmail, note.payload]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const pagination = paginateItems(notifications, params);
  return adminShell(
    user,
    "Уведомления",
    `<section class="section">
      <div><span class="eyebrow">E-mail log</span><h1>Уведомления</h1><p class="lead">Без SMTP события остаются в журнале. Если SMTP настроен через env, очередь можно отправить из этой страницы.</p></div>
      <article class="panel stack">
        <h2>SMTP</h2>
        <p class="muted">Статус: ${smtpConfigured() ? "SMTP настроен, новые письма попадают в очередь" : "SMTP не настроен, уведомления сохраняются как лог"}</p>
        <div class="table-actions">
          <form method="post" action="/admin/notifications/test-smtp" class="inline-form">
            <input name="email" type="email" value="${escapeHtml(user.email)}" required />
            <button class="small-button primary" type="submit">Проверить SMTP</button>
          </form>
          <form method="post" action="/admin/notifications/send-pending">
            <button class="small-button primary" type="submit">Отправить очередь SMTP</button>
          </form>
        </div>
      </article>
      <form class="inline-form" method="get" action="/admin/notifications">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Поиск по журналу" />
        <button class="small-button primary" type="submit">Найти</button>
      </form>
      <table class="table"><thead><tr><th>Тип</th><th>Получатель</th><th>Событие</th><th>Статус</th><th>Дата</th></tr></thead><tbody>${pagination.items
        .map((note) => `<tr><td>${escapeHtml(note.type)}</td><td>${escapeHtml(note.recipientEmail)}</td><td>${escapeHtml(note.payload || "")}${note.errorMessage ? `<br><span class="muted">${escapeHtml(note.errorMessage)}</span>` : ""}</td><td>${badge(note.status)}</td><td>${new Date(note.createdAt).toLocaleString("ru-RU")}</td></tr>`)
        .join("") || `<tr><td colspan="5"><span class="muted">Событий не найдено.</span></td></tr>`}</tbody></table>
      ${paginationControls("/admin/notifications", params, pagination)}
      <form class="form-panel" method="post" action="/admin/notifications/templates">
        <h2>Шаблоны писем</h2>
        <p class="muted">Доступные переменные: {{payload}}, {{recipientEmail}}, {{date}}, {{platformUrl}}, {{type}}.</p>
        ${Object.entries(defaultEmailTemplates())
          .map(([type, defaults]) => {
            const template = db.settings?.emailTemplates?.[type] ?? defaults;
            return `<article class="panel stack">
              <h3>${escapeHtml(type)}</h3>
              <div class="field"><label>Тема</label><input name="subject:${type}" value="${escapeHtml(template.subject)}" /></div>
              <div class="field"><label>Текст письма</label><textarea name="body:${type}">${escapeHtml(template.body)}</textarea></div>
            </article>`;
          })
          .join("")}
        <button class="button" type="submit">Сохранить шаблоны</button>
      </form>
    </section>`
  );
}

function adminAudit(user, searchParams = new URLSearchParams()) {
  const params = listParams(searchParams);
  const events = (db.auditEvents ?? [])
    .filter((event) => matchesQuery([event.adminEmail, event.action, JSON.stringify(event.details ?? {})], params.q))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const pagination = paginateItems(events, params);
  return adminShell(
    user,
    "Аудит",
    `<section class="section">
      <div><span class="eyebrow">Безопасность</span><h1>Аудит действий админа</h1><p class="lead">Журнал хранит последние 2000 административных POST-действий без паролей, файлов и CSRF-токенов.</p></div>
      <form class="inline-form" method="get" action="/admin/audit">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Поиск по действию или админу" />
        <button class="small-button primary" type="submit">Найти</button>
      </form>
      <table class="table">
        <thead><tr><th>Дата</th><th>Админ</th><th>Действие</th><th>Детали</th></tr></thead>
        <tbody>${pagination.items
          .map((event) => `<tr>
            <td>${new Date(event.createdAt).toLocaleString("ru-RU")}</td>
            <td>${escapeHtml(event.adminEmail)}</td>
            <td><span class="link-line">${escapeHtml(event.action)}</span></td>
            <td><code>${escapeHtml(JSON.stringify(event.details ?? {}))}</code></td>
          </tr>`)
          .join("") || `<tr><td colspan="4"><span class="muted">Событий не найдено.</span></td></tr>`}</tbody>
      </table>
      ${paginationControls("/admin/audit", params, pagination)}
    </section>`
  );
}

function studentDashboard(user) {
  const assignments = db.assignments.filter((assignment) => assignment.userId === user.id).map(recalculateAssignment);
  const certs = db.certificates.filter((certificate) => certificate.userId === user.id);
  return studentShell(
    user,
    "Кабинет",
    `<section class="section">
      <div><span class="eyebrow">Личный кабинет</span><h1>Обзор обучения</h1><p class="lead">Здесь собраны назначенные курсы, прогресс, результаты тестов и сертификаты.</p></div>
      <div class="grid three">
        <article class="metric"><span class="muted">Назначенные курсы</span><strong class="metric-value">${assignments.length}</strong></article>
        <article class="metric"><span class="muted">Доступные тесты</span><strong class="metric-value">${assignments.filter(canTakeTest).length}</strong></article>
        <article class="metric"><span class="muted">Сертификаты</span><strong class="metric-value">${certs.length}</strong></article>
      </div>
      <div class="grid three">${assignments.map((assignment) => courseCard(assignment)).join("")}</div>
    </section>`
  );
}

function courseCard(assignment) {
  const course = courseById(assignment.courseId);
  return `<article class="card">
    ${courseCoverHtml(course)}
    ${badge(assignment.status)}
    <h3>${escapeHtml(course?.title ?? "Курс удален")}</h3>
    <p class="muted">${escapeHtml(course?.shortDescription ?? "")}</p>
    <div class="progress-track"><div class="progress-bar" style="width:${assignment.progressPercent}%"></div></div>
    <p class="muted">Прогресс: ${assignment.progressPercent}%</p>
    <a class="small-button primary" href="/dashboard/courses/${assignment.id}">Открыть курс</a>
  </article>`;
}

function studentCourses(user) {
  const assignments = db.assignments.filter((assignment) => assignment.userId === user.id).map(recalculateAssignment);
  return studentShell(
    user,
    "Мои курсы",
    `<section class="section">
      <div><span class="eyebrow">Мои курсы</span><h1>Назначенные курсы</h1><p class="lead">Тест открывается после завершения обязательных материалов.</p></div>
      <div class="grid three">${assignments.map((assignment) => courseCard(assignment)).join("")}</div>
    </section>`
  );
}

function isMaterialUnlocked(course, assignment, materialId) {
  if (!course.isSequential) return true;
  const materials = requiredMaterials(course);
  const index = materials.findIndex((material) => material.id === materialId);
  if (index <= 0) return true;
  const previous = materials[index - 1];
  return assignment.materialProgress?.[previous.id]?.status === "completed";
}

function studentCourseDetail(user, assignment) {
  recalculateAssignment(assignment);
  const course = courseById(assignment.courseId);
  const materials = courseMaterials(course);
  const attempts = attemptsFor(assignment.id);
  const latestAttempt = attempts.at(-1);
  return studentShell(
    user,
    course.title,
    `<section class="section">
      <div class="section-heading">
        <div><span class="eyebrow">Курс</span><h1>${escapeHtml(course.title)}</h1><p class="lead">${escapeHtml(course.fullDescription || course.shortDescription)}</p></div>
        <div class="course-detail-side">
          ${courseCoverHtml(course)}
          <div class="panel"><strong>${assignment.progressPercent}%</strong><p class="muted">прогресс</p></div>
        </div>
      </div>
      ${assignment.status === "completed" && !hasCertificatePhoto(user) ? `<div class="photo-warning"><strong>Курс успешно завершен.</strong><br>Для получения сертификата обязательно загрузите фото в личном кабинете.</div>` : ""}
      <article class="panel stack">
        <h2>Материалы</h2>
        ${materials
          .map((material) => {
            const progress = assignment.materialProgress?.[material.id]?.status ?? "not_started";
            const unlocked = isMaterialUnlocked(course, assignment, material.id);
            return `<div class="material-row">
              <div>
                <strong>${escapeHtml(material.title)}</strong>
                <p class="muted">${escapeHtml(material.lesson.title)} · ${escapeHtml(material.type)} · ${material.isRequired ? "обязательный" : "дополнительный"}</p>
                ${materialContentHtml(material)}
              </div>
              <div>
                ${progress === "completed" ? `<span class="status-pill">Пройдено</span>` : unlocked ? `<form method="post" action="/dashboard/materials/complete"><input type="hidden" name="assignmentId" value="${assignment.id}" /><input type="hidden" name="materialId" value="${material.id}" /><button class="small-button primary" type="submit">Отметить пройденным</button></form>` : `<span class="status-pill">Закрыто</span>`}
              </div>
            </div>`;
          })
          .join("")}
      </article>
      <article class="panel stack">
        <h2>Финальный тест</h2>
        <p class="muted">Попыток использовано: ${attempts.length} из ${course.test.attemptsLimit + (assignment.extraTestAttempts ?? 0)}. Проходной процент: ${course.test.passingPercent}%.</p>
        ${latestAttempt && course.test.showResultToUser ? `<div class="notice"><strong>Последний результат:</strong> ${latestAttempt.scorePercent}% · попытка ${latestAttempt.attemptNumber} · ${badge(latestAttempt.status === "passed" ? "test_passed" : "test_failed")}</div>` : ""}
        ${canTakeTest(assignment) ? `<a class="button" href="/dashboard/tests/${assignment.id}">Пройти тест</a>` : `<div class="notice">Тест станет доступен после обязательных материалов или уже завершен.</div>`}
      </article>
    </section>`
  );
}

function studentTestPage(user, assignment) {
  const course = courseById(assignment.courseId);
  if (!canTakeTest(assignment)) {
    return studentShell(user, "Тест недоступен", `<section class="section"><div class="notice">Тест сейчас недоступен.</div></section>`);
  }
  if (course.test.timeLimitMinutes > 0 && !assignment.activeTestStartedAt) {
    assignment.activeTestStartedAt = now();
    saveDb(db);
  }
  const timeLimitNotice = course.test.timeLimitMinutes > 0
    ? `<div class="notice"><strong>Лимит времени:</strong> ${course.test.timeLimitMinutes} мин. Отсчет начался при открытии страницы.</div>`
    : "";
  return studentShell(
    user,
    course.test.title,
    `<section class="section">
      <div><span class="eyebrow">Тестирование</span><h1>${escapeHtml(course.test.title)}</h1><p class="lead">Выберите один правильный ответ для каждого вопроса.</p></div>
      ${timeLimitNotice}
      <form class="stack" method="post" action="/dashboard/tests/${assignment.id}">
        ${course.test.questions
          .map(
            (question) => `<article class="panel stack">
              <h2>${escapeHtml(question.questionText)}</h2>
              ${sortedQuestionOptions(question)
                .map((option) => `<label class="quiz-option"><input type="${question.type === "multiple_choice" ? "checkbox" : "radio"}" name="${question.id}" value="${option.id}" ${question.type === "multiple_choice" ? "" : "required"} /> ${escapeHtml(option.optionText)}</label>`)
                .join("")}
            </article>`
          )
          .join("")}
        <button class="button" type="submit">Завершить тест</button>
      </form>
    </section>`
  );
}

function adminTestPreview(user, course) {
  return adminShell(
    user,
    `Предпросмотр: ${course.test?.title ?? course.title}`,
    `<section class="section">
      <div><span class="eyebrow">Предпросмотр теста</span><h1>${escapeHtml(course.test?.title ?? "Тест")}</h1><p class="lead">Так студент увидит вопросы после завершения обязательных материалов.</p></div>
      ${course.test?.timeLimitMinutes ? `<div class="notice">Лимит времени: ${course.test.timeLimitMinutes} мин.</div>` : ""}
      ${(course.test?.questions ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((question) => `<article class="panel stack">
          <h2>${escapeHtml(question.questionText)}</h2>
          ${sortedQuestionOptions(question)
            .map((option) => `<label class="quiz-option"><input type="radio" disabled /> ${escapeHtml(option.optionText)} ${option.isCorrect ? "<span class='muted'>правильный</span>" : ""}</label>`)
            .join("")}
        </article>`)
        .join("") || `<article class="panel">Вопросы пока не добавлены.</article>`}
      <a class="button secondary" href="/admin/courses/${course.id}">Вернуться к курсу</a>
    </section>`
  );
}

function studentTests(user) {
  const attempts = db.testAttempts.filter((attempt) => attempt.userId === user.id);
  return studentShell(
    user,
    "Пройденные тесты",
    `<section class="section">
      <div><span class="eyebrow">История</span><h1>Пройденные тесты</h1></div>
      <table class="table"><thead><tr><th>Курс</th><th>Попытка</th><th>Результат</th><th>Статус</th></tr></thead><tbody>${attempts
        .map((attempt) => {
          const assignment = db.assignments.find((item) => item.id === attempt.assignmentId);
          const course = courseById(assignment.courseId);
          return `<tr><td>${escapeHtml(course.title)}</td><td>${attempt.attemptNumber}</td><td>${attempt.scorePercent}%</td><td>${badge(attempt.status === "passed" ? "test_passed" : "test_failed")}</td></tr>`;
        })
        .join("")}</tbody></table>
    </section>`
  );
}

function studentCertificates(user) {
  const certs = db.certificates.filter((certificate) => certificate.userId === user.id);
  const pendingCertificates = db.assignments.filter(
    (assignment) =>
      assignment.userId === user.id &&
      assignment.status === "completed" &&
      !activeCertificateForAssignment(assignment.id)
  );
  return studentShell(
    user,
    "Сертификаты",
    `<section class="section">
      <div><span class="eyebrow">Сертификаты</span><h1>Мои сертификаты</h1></div>
      ${pendingCertificates.length && !hasCertificatePhoto(user) ? `<div class="photo-warning"><strong>Есть завершенный курс без сертификата.</strong><br>Загрузите фото в профиле, чтобы система сформировала сертификат.</div>` : ""}
      <div class="grid three">${certs
        .map((certificate) => `<article class="card">${badge(certificate.status)}<h3>${escapeHtml(certificate.snapshotCourseTitle)}</h3><p class="muted">Номер: ${escapeHtml(certificate.certificateNumber)}</p><p class="muted">Действителен до: ${formatDate(certificate.expiresAt)}</p><a class="small-button primary" href="/certificates/${certificate.id}">Открыть</a></article>`)
        .join("") || `<article class="panel">Сертификаты появятся после успешного теста.</article>`}</div>
    </section>`
  );
}

function studentProfile(user) {
  const pendingCertificates = db.assignments.filter(
    (assignment) =>
      assignment.userId === user.id &&
      assignment.status === "completed" &&
      !activeCertificateForAssignment(assignment.id)
  );
  return studentShell(
    user,
    "Профиль",
    `<section class="section">
      <div><span class="eyebrow">Профиль</span><h1>${escapeHtml(user.firstNameEn)} ${escapeHtml(user.lastNameEn)}</h1><p class="lead">Эти данные обязательны для обучения и оформления сертификата.</p></div>
      ${pendingCertificates.length && !hasCertificatePhoto(user) ? `<div class="photo-warning"><strong>Курс уже завершен, но сертификат ожидает фото.</strong><br>Загрузите фото в личном кабинете, после этого сертификат будет сформирован автоматически.</div>` : ""}
      <div class="grid three">
        <article class="panel stack">
          <h2>Фото для сертификата</h2>
          ${hasCertificatePhoto(user) ? `<img class="profile-photo" src="${escapeHtml(user.photoUrl)}" alt="Фото студента" />` : `<div class="profile-photo"></div>`}
          <form class="stack" method="post" action="/dashboard/profile/photo" enctype="multipart/form-data">
            <div class="field"><label for="photo">Загрузить фото</label><input id="photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp" required /></div>
            <button class="button" type="submit">Сохранить фото</button>
          </form>
        </article>
        <form class="form-panel" method="post" action="/dashboard/profile/update" style="grid-column: span 2;">
          <h2>Обязательные данные</h2>
          <div class="field"><label>Фамилия</label><input name="lastNameEn" value="${escapeHtml(user.lastNameEn)}" required /></div>
          <div class="field"><label>Имя</label><input name="firstNameEn" value="${escapeHtml(user.firstNameEn)}" required /></div>
          <div class="field"><label>Дата рождения</label><input name="birthDate" type="date" value="${escapeHtml(user.birthDate || "")}" required /></div>
          <div class="field"><label>Почта</label><input name="email" type="email" value="${escapeHtml(user.email)}" required /></div>
          <div class="field"><label>Должность</label><input name="position" value="${escapeHtml(user.position || "")}" required /></div>
          <div class="field"><label>Компания — необязательно</label><input name="company" value="${escapeHtml(user.company || "")}" /></div>
          <button class="button" type="submit">Сохранить профиль</button>
        </form>
      </div>
      <form class="form-panel" method="post" action="/dashboard/profile/password">
        <h2>Смена пароля</h2>
        <div class="field"><label>Текущий пароль</label><input name="currentPassword" type="password" required /></div>
        <div class="field"><label>Новый пароль</label><input name="newPassword" type="password" minlength="8" required /></div>
        <button class="button" type="submit">Сменить пароль</button>
      </form>
    </section>`
  );
}

function certificatePage(requestUser, certificate) {
  if (!requestUser) return page("Нет доступа", null, `<main class="page"><div class="notice">Войдите, чтобы открыть сертификат.</div></main>`);
  if (requestUser.role !== "admin" && certificate.userId !== requestUser.id) {
    return page("Нет доступа", requestUser, `<main class="page"><div class="notice">Нельзя открыть чужой сертификат.</div></main>`);
  }
  const certificateHtml =
    certificate.certificateHtml ||
    renderCertificateTemplate(certificate, certificate.snapshotCertificateTemplateHtml || defaultCertificateTemplate());
  return page(
    "Сертификат",
    requestUser,
    `<main class="page">
      ${certificate.status === "issued" ? "" : `<div class="notice danger">Этот сертификат не активен: текущий статус ${escapeHtml(statusLabel(certificate.status))}.</div>`}
      <section class="${certificateShellClass(certificateHtml)}">
        ${certificateHtml}
        <div class="actions" style="justify-content:center;margin-top:24px"><a class="button" href="/certificates/${certificate.id}.pdf">Скачать PDF</a><button class="button secondary" onclick="window.print()">Печать</button></div>
      </section>
    </main>`
  );
}

function verifyCertificatePage(certificate) {
  const isValidCertificate = certificate?.status === "issued";
  const body = certificate
    ? `<main class="page">
        <section class="section">
          <div><span class="eyebrow">Проверка сертификата</span><h1>Сертификат действителен</h1><p class="lead">Номер найден в реестре Marine LMS.</p></div>
          ${isValidCertificate ? "" : `<div class="notice danger">Этот сертификат не действителен: он был отозван или заменен новым сертификатом.</div>`}
          <article class="panel stack">
            ${badge(certificate.status)}
            <p><strong>Номер:</strong> ${escapeHtml(certificate.certificateNumber)}</p>
            <p><strong>Студент:</strong> ${escapeHtml(certificate.snapshotFirstName)} ${escapeHtml(certificate.snapshotLastName)}</p>
            <p><strong>Курс:</strong> ${escapeHtml(certificate.snapshotCourseTitle)}</p>
            <p><strong>Дата выдачи:</strong> ${new Date(certificate.issuedAt).toLocaleDateString("ru-RU")}</p>
            <p><strong>Действителен до:</strong> ${formatDate(certificate.expiresAt)}</p>
          </article>
        </section>
      </main>`
    : `<main class="page"><section class="section"><div class="notice danger">Сертификат с таким номером не найден.</div></section></main>`;
  return page("Проверка сертификата", null, body);
}

async function handlePost(request, response, pathname, user) {
  const form = await parseBody(request);
  if (user && !csrfFormValid(user, form)) {
    send(response, page("Запрос отклонен", user, `<main class="page"><div class="notice danger">POST-запрос отклонен: неверный CSRF-токен. Обновите страницу и попробуйте снова.</div></main>`), 403);
    return;
  }

  if (pathname === "/login") {
    const email = form.get("email")?.toString().trim().toLowerCase();
    const password = form.get("password")?.toString() ?? "";
    if (loginRateLimited(request)) {
      send(response, page("Слишком много попыток", null, `<main class="page"><div class="notice danger">Слишком много попыток входа. Подождите несколько минут и попробуйте снова.</div></main>`), 429);
      return;
    }
    const found = db.users.find((item) => item.email.toLowerCase() === email && item.status === "active");
    if (!found || !verifyPassword(password, found.passwordHash)) {
      send(response, page("Ошибка входа", null, `<main class="page"><div class="notice danger">Неверный e-mail или пароль.</div><p><a class="button" href="/login">Вернуться</a></p></main>`), 401);
      return;
    }
    clearLoginRateLimit(request);
    const sessionId = randomUUID();
    const csrfToken = randomBytes(32).toString("hex");
    sessions.set(sessionId, { userId: found.id, csrfToken });
    csrfTokens.set(found.id, csrfToken);
    response.writeHead(303, {
      Location: canAccessAdminPanel(found) ? "/admin" : "/dashboard",
      "Set-Cookie": `sid=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax`
    });
    response.end();
    return;
  }

  if (pathname === "/forgot-password") {
    const email = form.get("email")?.toString().trim().toLowerCase() ?? "";
    const found = db.users.find((item) => item.email.toLowerCase() === email && item.status === "active");
    if (found) {
      const temporaryPassword = randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12) || "Temp12345";
      found.passwordHash = hashPassword(temporaryPassword);
      const note = {
        id: id("note"),
        recipientUserId: found.id,
        recipientEmail: found.email,
        type: "password_recovery",
        status: notificationInitialStatus(),
        payload: "Temporary password was generated by recovery form.",
        temporaryPassword,
        createdAt: now(),
        sentAt: ""
      };
      await deliverNotification(note);
      db.notifications.push(note);
      saveDb(db);
    }
    redirect(response, "/forgot-password?success=1");
    return;
  }

  if (pathname === "/logout") {
    const sessionId = getCookie(request, "sid");
    sessions.delete(sessionId);
    response.writeHead(303, {
      Location: "/",
      "Set-Cookie": "sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
    });
    response.end();
    return;
  }

  if (pathname === "/apply") {
    const application = {
      id: id("app"),
      lastName: form.get("lastName")?.toString() ?? "",
      firstName: form.get("firstName")?.toString() ?? "",
      phone: form.get("phone")?.toString() ?? "",
      email: form.get("email")?.toString() ?? "",
      courseId: form.get("courseId")?.toString() ?? "",
      comment: form.get("comment")?.toString() ?? "",
      status: "new",
      adminNote: "",
      createdAt: now()
    };
    db.applications.unshift(application);
    db.notifications.push({
      id: id("note"),
      recipientUserId: "user_admin",
      recipientEmail: "admin@example.com",
      type: "new_application",
      status: notificationInitialStatus(),
      payload: `New application from ${application.email}`,
      createdAt: now(),
      sentAt: now()
    });
    saveDb(db);
    redirect(response, "/apply?success=1");
    return;
  }

  if (pathname === "/dashboard/profile/update") {
    const student = requireUser(request, response);
    if (!student) return;
    if (student.role !== "student") {
      redirect(response, "/admin");
      return;
    }

    const email = form.get("email")?.toString().trim().toLowerCase() ?? "";
    const emailOwner = db.users.find((item) => item.email.toLowerCase() === email && item.id !== student.id);
    if (emailOwner) {
      send(response, studentShell(student, "Профиль", `<section class="section"><div class="notice danger">Такой e-mail уже используется другим пользователем.</div><a class="button" href="/dashboard/profile">Вернуться</a></section>`), 400);
      return;
    }

    student.lastNameEn = form.get("lastNameEn")?.toString().trim() ?? student.lastNameEn;
    student.firstNameEn = form.get("firstNameEn")?.toString().trim() ?? student.firstNameEn;
    student.birthDate = form.get("birthDate")?.toString() ?? student.birthDate;
    student.email = email;
    student.position = form.get("position")?.toString().trim() ?? student.position;
    student.company = form.get("company")?.toString().trim() ?? "";
    saveDb(db);
    redirect(response, "/dashboard/profile");
    return;
  }

  if (pathname === "/dashboard/profile/password") {
    const student = requireUser(request, response);
    if (!student) return;
    const currentPassword = form.get("currentPassword")?.toString() ?? "";
    const newPassword = form.get("newPassword")?.toString() ?? "";
    if (verifyPassword(currentPassword, student.passwordHash) && newPassword.length >= 8) {
      student.passwordHash = hashPassword(newPassword);
      db.notifications.push({
        id: id("note"),
        recipientUserId: student.id,
        recipientEmail: student.email,
        type: "password_changed",
        status: notificationInitialStatus(),
        payload: "Password changed in student profile.",
        createdAt: now(),
        sentAt: now()
      });
      saveDb(db);
      redirect(response, "/dashboard/profile");
      return;
    }
    send(response, studentShell(student, "Смена пароля", `<section class="section"><div class="notice danger">Пароль не изменен: проверьте текущий пароль и длину нового пароля.</div><a class="button" href="/dashboard/profile">Вернуться</a></section>`), 400);
    return;
  }

  if (pathname === "/dashboard/profile/photo") {
    const student = requireUser(request, response);
    if (!student) return;
    if (student.role !== "student") {
      redirect(response, "/admin");
      return;
    }

    const photo = form.get("photo");
    if (!photo?.buffer?.length || !photo.contentType?.startsWith("image/")) {
      send(response, studentShell(student, "Фото", `<section class="section"><div class="notice danger">Загрузите файл изображения: JPG, PNG или WebP.</div><a class="button" href="/dashboard/profile">Вернуться</a></section>`), 400);
      return;
    }
    if (photo.buffer.length > 3 * 1024 * 1024) {
      send(response, studentShell(student, "Фото", `<section class="section"><div class="notice danger">Фото слишком большое. Максимальный размер: 3 MB.</div><a class="button" href="/dashboard/profile">Вернуться</a></section>`), 400);
      return;
    }

    mkdirSync(uploadsDir, { recursive: true });
    const extensionByType = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif"
    };
    const ext = extensionByType[photo.contentType] ?? (extname(photo.filename).toLowerCase() || ".jpg");
    const fileName = `${student.id}-${Date.now()}${ext}`;
    writeFileSync(resolve(uploadsDir, fileName), photo.buffer);
    student.photoUrl = `/uploads/${fileName}`;
    const issued = issuePendingCertificatesForUser(student, { actor: student, action: "issued_after_student_photo" });
    if (issued.length) {
      db.notifications.push({
        id: id("note"),
        recipientUserId: student.id,
        recipientEmail: student.email,
        type: "pending_certificates_issued",
        status: notificationInitialStatus(),
        payload: `${issued.length} pending certificate(s) issued after photo upload.`,
        createdAt: now(),
        sentAt: now()
      });
    }
    saveDb(db);
    redirect(response, "/dashboard/profile");
    return;
  }

  if (pathname.startsWith("/admin")) {
    const admin = requireAdmin(request, response);
    if (!admin) return;
    auditAdminAction(admin, pathname, form);
    if (isInstructor(admin) && !["/admin/users/create", "/admin/users/update", "/admin/users/photo", "/admin/assignments/create"].includes(pathname)) {
      send(response, adminShell(admin, "Нет доступа", `<section class="section"><div class="notice danger">Инструктор может создать студента, редактировать его данные, загрузить фото и назначить курс. Это действие запрещено.</div><a class="button" href="/admin/users">К пользователям</a></section>`), 403);
      return;
    }

    if (pathname === "/admin/notifications/send-pending") {
      await deliverPendingNotifications();
      saveDb(db);
      redirect(response, "/admin/notifications");
      return;
    }

    if (pathname === "/admin/notifications/templates") {
      db.settings ??= {};
      db.settings.emailTemplates ??= defaultEmailTemplates();
      for (const type of Object.keys(defaultEmailTemplates())) {
        db.settings.emailTemplates[type] = {
          subject: form.get(`subject:${type}`)?.toString() || defaultEmailTemplates()[type].subject,
          body: form.get(`body:${type}`)?.toString() || defaultEmailTemplates()[type].body
        };
      }
      saveDb(db);
      redirect(response, "/admin/notifications");
      return;
    }

    if (pathname === "/admin/notifications/test-smtp") {
      const recipientEmail = form.get("email")?.toString().trim() || admin.email;
      const note = {
        id: id("note"),
        recipientUserId: admin.id,
        recipientEmail,
        type: "smtp_test",
        status: notificationInitialStatus(),
        payload: "SMTP test from admin panel.",
        createdAt: now(),
        sentAt: ""
      };
      await deliverNotification(note);
      db.notifications.push(note);
      saveDb(db);
      redirect(response, "/admin/notifications");
      return;
    }

    if (pathname === "/admin/homepage/courses") {
      db.settings ??= {};
      db.settings.homepageCourseSelectionEnabled = true;
      const selectedCourseIds = new Set(form.getAll("showOnHome").map((value) => value.toString()));
      for (const course of db.courses) {
        course.showOnHome = selectedCourseIds.has(course.id);
        const sortOrder = Number(form.get(`homeSortOrder:${course.id}`));
        course.homeSortOrder = Number.isFinite(sortOrder) && sortOrder > 0 ? Math.round(sortOrder) : 999;
      }
      saveDb(db);
      redirect(response, "/admin/homepage");
      return;
    }

    if (pathname === "/admin/applications/status") {
      const application = db.applications.find((item) => item.id === form.get("id"));
      if (application) application.status = form.get("status")?.toString() ?? application.status;
      saveDb(db);
      redirect(response, "/admin/applications");
      return;
    }

    if (pathname === "/admin/applications/convert") {
      const application = db.applications.find((item) => item.id === form.get("id"));
      if (application) {
        let student = db.users.find((item) => item.email.toLowerCase() === application.email.toLowerCase());
        if (!student) {
          student = {
            id: id("user"),
            role: "student",
            email: application.email,
            passwordHash: hashPassword("Student123!"),
            firstNameEn: application.firstName,
            lastNameEn: application.lastName,
            birthDate: "",
            company: "",
            position: "Trainee",
            phone: application.phone,
            photoUrl: "",
            status: "active",
            createdAt: now()
          };
          db.users.push(student);
        }
        if (!assignmentFor(student.id, application.courseId)) {
          db.assignments.push({
            id: id("assign"),
            userId: student.id,
            courseId: application.courseId,
            assignedById: admin.id,
            status: "not_started",
            assignedAt: now(),
            startedAt: "",
            completedAt: "",
            progressPercent: 0,
            materialProgress: {}
          });
        }
        application.status = "converted_to_user";
      }
      saveDb(db);
      redirect(response, "/admin/applications");
      return;
    }

    if (pathname === "/admin/users/create") {
      const email = form.get("email")?.toString().trim() ?? "";
      const firstNameEn = form.get("firstNameEn")?.toString().trim() ?? "";
      const lastNameEn = form.get("lastNameEn")?.toString().trim() ?? "";
      const birthDate = form.get("birthDate")?.toString() ?? "";
      const position = form.get("position")?.toString().trim() ?? "";
      const requestedRole = form.get("role")?.toString() ?? "student";
      const role = isFullAdmin(admin) && requestedRole === "instructor" ? "instructor" : "student";
      const duplicate = db.users.some((item) => item.email.toLowerCase() === email.toLowerCase());
      if (email && firstNameEn && lastNameEn && birthDate && position && !duplicate) {
        db.users.push({
          id: id("user"),
          role,
          email,
          passwordHash: hashPassword(form.get("password")?.toString() || "Student123!"),
          firstNameEn,
          lastNameEn,
          birthDate,
          company: form.get("company")?.toString().trim() ?? "",
          position,
          phone: form.get("phone")?.toString().trim() ?? "",
          photoUrl: "",
          status: "active",
          createdAt: now()
        });
      }
      saveDb(db);
      redirect(response, "/admin/users");
      return;
    }

    if (pathname === "/admin/users/update") {
      const student = db.users.find((item) => item.id === form.get("id") && item.role === "student");
      if (student) {
        const email = form.get("email")?.toString().trim() ?? student.email;
        const firstNameEn = form.get("firstNameEn")?.toString().trim() ?? "";
        const lastNameEn = form.get("lastNameEn")?.toString().trim() ?? "";
        const birthDate = form.get("birthDate")?.toString() ?? "";
        const position = form.get("position")?.toString().trim() ?? "";
        const duplicate = db.users.some(
          (item) => item.id !== student.id && item.email.toLowerCase() === email.toLowerCase()
        );
        if (email && firstNameEn && lastNameEn && birthDate && position && !duplicate) {
          student.email = email;
          student.firstNameEn = firstNameEn;
          student.lastNameEn = lastNameEn;
          student.birthDate = birthDate;
          student.position = position;
          student.company = form.get("company")?.toString().trim() ?? "";
          student.phone = form.get("phone")?.toString().trim() ?? "";
        }
      }
      saveDb(db);
      redirect(response, "/admin/users");
      return;
    }

    if (pathname === "/admin/users/photo") {
      const student = db.users.find((item) => item.id === form.get("id") && item.role === "student");
      const photo = form.get("photo");
      if (!student) {
        redirect(response, "/admin/users");
        return;
      }

      const savedPhoto = saveCertificatePhoto(student, photo);
      if (!savedPhoto.ok) {
        send(response, adminShell(admin, "Фото студента", `<section class="section"><div class="notice danger">${escapeHtml(savedPhoto.message)}</div><a class="button" href="/admin/users">Вернуться</a></section>`), 400);
        return;
      }

      const issued = issuePendingCertificatesForUser(student, { actor: admin, action: "issued_after_admin_photo" });
      if (issued.length) {
        db.notifications.push({
          id: id("note"),
          recipientUserId: student.id,
          recipientEmail: student.email,
          type: "pending_certificates_issued",
          status: notificationInitialStatus(),
          payload: `${issued.length} pending certificate(s) issued after admin photo upload.`,
          createdAt: now(),
          sentAt: now()
        });
      }
      saveDb(db);
      redirect(response, "/admin/users");
      return;
    }

    if (pathname === "/admin/users/toggle") {
      const student = db.users.find((item) => item.id === form.get("id") && item.role === "student");
      if (student) student.status = student.status === "active" ? "inactive" : "active";
      saveDb(db);
      redirect(response, "/admin/users");
      return;
    }

    if (pathname === "/admin/users/delete") {
      const student = db.users.find((item) => item.id === form.get("id") && item.role === "student");
      if (student) student.status = "deleted";
      saveDb(db);
      redirect(response, "/admin/users");
      return;
    }

    if (pathname === "/admin/users/reset-password") {
      const student = db.users.find((item) => item.id === form.get("id") && item.role === "student");
      const temporaryPassword = form.get("password")?.toString() || "Student123!";
      if (student && temporaryPassword.trim()) {
        student.passwordHash = hashPassword(temporaryPassword);
        db.notifications.push({
          id: id("note"),
          recipientUserId: student.id,
          recipientEmail: student.email,
          type: "password_reset",
          status: notificationInitialStatus(),
          payload: "Temporary password was reset by administrator.",
          createdAt: now(),
          sentAt: now()
        });
      }
      saveDb(db);
      redirect(response, "/admin/users");
      return;
    }

    if (pathname === "/admin/certificates/issue-manual") {
      const student = db.users.find((item) => item.id === form.get("userId") && item.role === "student");
      const course = courseById(form.get("courseId")?.toString());
      const issuedAt = parseIssueDateInput(form.get("issuedAt"));
      if (!student || !course) {
        send(response, adminShell(admin, "Сертификат", `<section class="section"><div class="notice danger">Студент или курс не найден.</div><a class="button" href="/admin/users">Вернуться к студентам</a></section>`), 404);
        return;
      }
      if (!issuedAt) {
        send(response, adminShell(admin, "Сертификат", `<section class="section"><div class="notice danger">Укажите корректную дату выдачи сертификата.</div><a class="button" href="/admin/users">Вернуться к студентам</a></section>`), 400);
        return;
      }
      if (!hasCertificatePhoto(student)) {
        send(response, adminShell(admin, "Сертификат", `<section class="section"><div class="notice danger">Перед выдачей сертификата нужно загрузить фото студента.</div><a class="button" href="/admin/users">Вернуться к студентам</a></section>`), 400);
        return;
      }
      issueManualCertificate(student, course, admin, { issuedAt });
      saveDb(db);
      redirect(response, `/admin/certificates?userId=${encodeURIComponent(student.id)}`);
      return;
    }

    if (pathname === "/admin/assignments/create") {
      const userId = form.get("userId")?.toString();
      const courseId = form.get("courseId")?.toString();
      if (userId && courseId && !assignmentFor(userId, courseId)) {
        db.assignments.push({
          id: id("assign"),
          userId,
          courseId,
          assignedById: admin.id,
          status: "not_started",
          assignedAt: now(),
          startedAt: "",
          completedAt: "",
          progressPercent: 0,
          materialProgress: {}
        });
        const student = userById(userId);
        const course = courseById(courseId);
        db.notifications.push({
          id: id("note"),
          recipientUserId: userId,
          recipientEmail: student.email,
          type: "course_assigned",
          status: notificationInitialStatus(),
          payload: `Course assigned: ${course.title}`,
          createdAt: now(),
          sentAt: now()
        });
      }
      saveDb(db);
      redirect(response, "/admin/users");
      return;
    }

    const assignmentDeleteMatch = pathname.match(/^\/admin\/assignments\/([^/]+)\/delete$/);
    if (assignmentDeleteMatch) {
      const assignment = db.assignments.find((item) => item.id === assignmentDeleteMatch[1]);
      const hasCertificate = db.certificates.some((certificate) => certificate.assignmentId === assignmentDeleteMatch[1]);
      if (assignment && !hasCertificate) {
        db.testAttempts = db.testAttempts.filter((attempt) => attempt.assignmentId !== assignment.id);
        db.assignments = db.assignments.filter((item) => item.id !== assignment.id);
      }
      saveDb(db);
      redirect(response, "/admin/users");
      return;
    }

    const assignmentResetAttemptsMatch = pathname.match(/^\/admin\/assignments\/([^/]+)\/reset-attempts$/);
    if (assignmentResetAttemptsMatch) {
      const returnTo = adminReturnTo(form, "/admin/reports");
      const assignment = db.assignments.find((item) => item.id === assignmentResetAttemptsMatch[1]);
      if (assignment) {
        db.testAttempts = db.testAttempts.filter((attempt) => attempt.assignmentId !== assignment.id);
        assignment.activeTestStartedAt = "";
        assignment.extraTestAttempts = 0;
        if (!activeCertificateForAssignment(assignment.id)) {
          assignment.completedAt = "";
          assignment.status = assignment.progressPercent >= 100 ? "test_available" : "in_progress";
          recalculateAssignment(assignment);
        }
      }
      saveDb(db);
      redirect(response, returnTo);
      return;
    }

    const assignmentUnlockTestMatch = pathname.match(/^\/admin\/assignments\/([^/]+)\/unlock-test$/);
    if (assignmentUnlockTestMatch) {
      const returnTo = adminReturnTo(form, "/admin/reports");
      const assignment = db.assignments.find((item) => item.id === assignmentUnlockTestMatch[1]);
      if (assignment) {
        assignment.extraTestAttempts = (assignment.extraTestAttempts ?? 0) + 1;
        assignment.activeTestStartedAt = "";
        if (assignment.progressPercent >= 100 && assignment.status !== "completed") {
          assignment.status = "test_available";
        }
      }
      saveDb(db);
      redirect(response, returnTo);
      return;
    }

    if (pathname === "/admin/courses/create") {
      const course = {
        id: id("course"),
        title: form.get("title")?.toString() ?? "",
        shortDescription: form.get("shortDescription")?.toString() ?? "",
        fullDescription: "",
        goals: form.get("goals")?.toString() ?? "",
        requirements: "Завершить обязательные материалы и сдать тест.",
        status: "active",
        isSequential: true,
        imageUrl: "",
        showOnHome: form.get("showOnHome") === "on",
        homeSortOrder: Number(form.get("homeSortOrder")) > 0 ? Math.round(Number(form.get("homeSortOrder"))) : 999,
        certificateTemplateHtml: defaultCertificateTemplateForNewCourse(),
        source: defaultCertificateSourceForNewCourse(),
        lessons: [],
        test: {
          id: id("test"),
          title: "Финальный тест",
          description: "",
          attemptsLimit: 3,
          passingPercent: 80,
          timeLimitMinutes: 0,
          showResultToUser: true,
          allowRetake: true,
          status: "active",
          questions: []
        },
        createdAt: now()
      };
      const savedImage = saveCourseImage(course, form.get("imageFile"));
      if (!savedImage.ok) {
        send(response, adminShell(admin, "Курсы", `<section class="section"><div class="notice danger">${escapeHtml(savedImage.message)}</div><a class="button" href="/admin/courses">Вернуться к курсам</a></section>`), 400);
        return;
      }
      if (course.showOnHome) {
        db.settings ??= {};
        db.settings.homepageCourseSelectionEnabled = true;
      }
      db.courses.push(course);
      saveDb(db);
      redirect(response, `/admin/courses/${course.id}`);
      return;
    }

    const courseUpdateMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/update$/);
    if (courseUpdateMatch) {
      const course = courseById(courseUpdateMatch[1]);
      if (course) {
        course.title = form.get("title")?.toString() ?? course.title;
        course.shortDescription = form.get("shortDescription")?.toString() ?? course.shortDescription;
        course.fullDescription = form.get("fullDescription")?.toString() ?? "";
        course.goals = form.get("goals")?.toString() ?? "";
        course.status = form.get("status")?.toString() ?? course.status;
        const requestedShowOnHome = form.get("showOnHome") === "on";
        const requestedHomeSortOrder = Number(form.get("homeSortOrder")) > 0 ? Math.round(Number(form.get("homeSortOrder"))) : 999;
        if (course.showOnHome !== requestedShowOnHome || courseHomeSortValue(course) !== requestedHomeSortOrder) {
          db.settings ??= {};
          db.settings.homepageCourseSelectionEnabled = true;
        }
        course.showOnHome = requestedShowOnHome;
        course.homeSortOrder = requestedHomeSortOrder;
        if (form.get("removeImage") === "on") course.imageUrl = "";
        const savedImage = saveCourseImage(course, form.get("imageFile"));
        if (!savedImage.ok) {
          send(response, adminShell(admin, "Курс", `<section class="section"><div class="notice danger">${escapeHtml(savedImage.message)}</div><a class="button" href="/admin/courses/${course.id}">Вернуться к курсу</a></section>`), 400);
          return;
        }
      }
      saveDb(db);
      redirect(response, `/admin/courses/${courseUpdateMatch[1]}`);
      return;
    }

    const certificateDesignerMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/certificate-designer$/);
    if (certificateDesignerMatch) {
      const course = courseById(certificateDesignerMatch[1]);
      if (course) {
        let designer = certificateDesignerForCourse(course);
        if (form.get("resetDesigner") === "on") {
          designer = defaultCertificateDesigner(designer.backgroundUrl, designer.backgroundType, designer.stampUrl);
        } else {
          try {
            designer = normalizeCertificateDesigner(JSON.parse(form.get("designerJson")?.toString() || "{}"));
          } catch {
            designer = certificateDesignerForCourse(course);
          }
        }

        if (form.get("removeBackground") === "on") {
          designer.backgroundUrl = "";
          designer.backgroundType = "image";
        }
        const savedBackground = saveCertificateDesignerBackground(course, form.get("backgroundFile"));
        if (!savedBackground.ok) {
          send(response, adminShell(admin, "Certificate designer", `<section class="section"><div class="notice danger">${escapeHtml(savedBackground.message)}</div><a class="button" href="/admin/courses/${course.id}">Back to course</a></section>`), 400);
          return;
        }
        if (savedBackground.backgroundUrl) {
          designer.backgroundUrl = savedBackground.backgroundUrl;
          designer.backgroundType = savedBackground.backgroundType;
        }
        if (form.get("removeStamp") === "on") designer.stampUrl = "";
        const savedStamp = saveCertificateDesignerStamp(course, form.get("stampFile"));
        if (!savedStamp.ok) {
          send(response, adminShell(admin, "Certificate designer", `<section class="section"><div class="notice danger">${escapeHtml(savedStamp.message)}</div><a class="button" href="/admin/courses/${course.id}">Back to course</a></section>`), 400);
          return;
        }
        if (savedStamp.stampUrl) {
          designer.stampUrl = savedStamp.stampUrl;
          const stampField = designer.fields.find((field) => field.key === "stampImage");
          if (stampField) stampField.visible = true;
        }

        const normalizedDesigner = normalizeCertificateDesigner(designer);
        applyCertificateDesignerToCourse(course, normalizedDesigner);
        if (form.get("applyToAllCourses") === "on") {
          setDefaultCertificateDesigner(normalizedDesigner);
          for (const targetCourse of db.courses) {
            applyCertificateDesignerToCourse(targetCourse, normalizedDesigner);
          }
        }
      }
      saveDb(db);
      redirect(response, `/admin/courses/${certificateDesignerMatch[1]}`);
      return;
    }

    const certificateTemplateMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/certificate-template$/);
    if (certificateTemplateMatch) {
      const course = courseById(certificateTemplateMatch[1]);
      if (course) {
        const uploadedTemplate = textFromFormFile(form.get("templateFile"));
        const textTemplate = form.get("certificateTemplateHtml")?.toString() ?? "";
        course.certificateTemplateHtml =
          form.get("resetTemplate") === "on"
            ? defaultCertificateTemplate()
            : sanitizeCertificateTemplate(uploadedTemplate || textTemplate || defaultCertificateTemplate());
        course.certificateTemplateUpdatedAt = now();
      }
      saveDb(db);
      redirect(response, `/admin/courses/${certificateTemplateMatch[1]}`);
      return;
    }

    const lessonCreateMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/lessons\/create$/);
    if (lessonCreateMatch) {
      const course = courseById(lessonCreateMatch[1]);
      if (course) {
        course.lessons.push({
          id: id("lesson"),
          title: form.get("title")?.toString() ?? "",
          description: form.get("description")?.toString() ?? "",
          sortOrder: course.lessons.length + 1,
          isRequired: true,
          status: "active",
          materials: []
        });
      }
      saveDb(db);
      redirect(response, `/admin/courses/${lessonCreateMatch[1]}`);
      return;
    }

    const lessonUpdateMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/lessons\/([^/]+)\/update$/);
    if (lessonUpdateMatch) {
      const course = courseById(lessonUpdateMatch[1]);
      const lesson = lessonById(course, lessonUpdateMatch[2]);
      if (lesson) {
        lesson.title = form.get("title")?.toString().trim() || lesson.title;
        lesson.description = form.get("description")?.toString().trim() ?? "";
        lesson.status = form.get("status")?.toString() ?? lesson.status;
        lesson.sortOrder = Number(form.get("sortOrder") ?? lesson.sortOrder) || lesson.sortOrder;
      }
      saveDb(db);
      redirect(response, `/admin/courses/${lessonUpdateMatch[1]}`);
      return;
    }

    const lessonDeleteMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/lessons\/([^/]+)\/delete$/);
    if (lessonDeleteMatch) {
      const course = courseById(lessonDeleteMatch[1]);
      if (course) {
        course.lessons = course.lessons.filter((lesson) => lesson.id !== lessonDeleteMatch[2]);
      }
      saveDb(db);
      redirect(response, `/admin/courses/${lessonDeleteMatch[1]}`);
      return;
    }

    const materialCreateMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/materials\/create$/);
    if (materialCreateMatch) {
      const course = courseById(materialCreateMatch[1]);
      const lesson = course?.lessons.find((item) => item.id === form.get("lessonId"));
      if (lesson) {
        const uploadedContent = uploadFromFormFile(form.get("file"), "material");
        lesson.materials.push({
          id: id("material"),
          type: form.get("type")?.toString() ?? "text",
          title: form.get("title")?.toString().trim() ?? "",
          content: uploadedContent || form.get("content")?.toString().trim() || "",
          isRequired: form.get("isRequired") === "on",
          sortOrder: lesson.materials.length + 1
        });
      }
      saveDb(db);
      redirect(response, `/admin/courses/${materialCreateMatch[1]}`);
      return;
    }

    const materialUpdateMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/materials\/([^/]+)\/update$/);
    if (materialUpdateMatch) {
      const course = courseById(materialUpdateMatch[1]);
      const found = materialById(course, materialUpdateMatch[2]);
      if (found) {
        const uploadedContent = uploadFromFormFile(form.get("file"), "material");
        found.material.title = form.get("title")?.toString().trim() || found.material.title;
        found.material.type = form.get("type")?.toString() ?? found.material.type;
        found.material.content = uploadedContent || form.get("content")?.toString().trim() || "";
        found.material.isRequired = form.get("isRequired") === "on";
        found.material.sortOrder = Number(form.get("sortOrder") ?? found.material.sortOrder) || found.material.sortOrder;
      }
      saveDb(db);
      redirect(response, `/admin/courses/${materialUpdateMatch[1]}`);
      return;
    }

    const materialDeleteMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/materials\/([^/]+)\/delete$/);
    if (materialDeleteMatch) {
      const course = courseById(materialDeleteMatch[1]);
      const found = materialById(course, materialDeleteMatch[2]);
      if (found) {
        found.lesson.materials = found.lesson.materials.filter((material) => material.id !== materialDeleteMatch[2]);
      }
      saveDb(db);
      redirect(response, `/admin/courses/${materialDeleteMatch[1]}`);
      return;
    }

    if (pathname === "/admin/files/link-video") {
      const [courseId, lessonId] = (form.get("lessonRef")?.toString() ?? "").split(":");
      const course = courseById(courseId);
      const lesson = lessonById(course, lessonId);
      const publicPath = form.get("publicPath")?.toString() ?? "";
      const uploadPath = normalizeUploadPath(publicPath);
      if (lesson && uploadPath && existsSync(uploadPath) && isVideoFile(uploadPath)) {
        lesson.materials.push({
          id: id("material"),
          type: "video",
          title: form.get("title")?.toString().trim() || publicPath.split("/").at(-1) || "Video",
          content: publicPath,
          isRequired: form.get("isRequired") === "on",
          sortOrder: lesson.materials.length + 1,
          source: {
            system: "manual_admin_link",
            linkedAt: now()
          }
        });
      }
      saveDb(db);
      redirect(response, "/admin/files");
      return;
    }

    if (pathname === "/admin/files/auto-link-videos") {
      const linked = autoLinkUnlinkedVideos();
      if (linked.length) {
        db.notifications.push({
          id: id("note"),
          recipientUserId: admin.id,
          recipientEmail: admin.email,
          type: "import_video_auto_link",
          status: "logged",
          payload: `Auto-linked ${linked.length} video file(s) by filename similarity.`,
          createdAt: now(),
          sentAt: now()
        });
      }
      saveDb(db);
      redirect(response, "/admin/files");
      return;
    }

    const testSettingsMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/test\/settings$/);
    if (testSettingsMatch) {
      const course = courseById(testSettingsMatch[1]);
      if (course?.test) {
        course.test.title = form.get("title")?.toString() ?? course.test.title;
        course.test.attemptsLimit = Number(form.get("attemptsLimit") ?? course.test.attemptsLimit);
        course.test.passingPercent = Number(form.get("passingPercent") ?? course.test.passingPercent);
        course.test.timeLimitMinutes = Number(form.get("timeLimitMinutes") ?? course.test.timeLimitMinutes) || 0;
        course.test.showResultToUser = form.get("showResultToUser") === "on";
        course.test.allowRetake = form.get("allowRetake") === "on";
        const requestedStatus = form.get("status")?.toString() ?? course.test.status;
        course.test.status = requestedStatus === "active" && !isTestValid(course.test) ? "inactive" : requestedStatus;
      }
      saveDb(db);
      redirect(response, `/admin/courses/${testSettingsMatch[1]}`);
      return;
    }

    const questionCreateMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/test\/questions\/create$/);
    if (questionCreateMatch) {
      const course = courseById(questionCreateMatch[1]);
      if (course?.test) {
        const question = {
          id: id("question"),
          questionText: form.get("questionText")?.toString().trim() ?? "",
          sortOrder: course.test.questions.length + 1,
          options: parseQuestionOptions(form)
        };
        if (isQuestionValid(question)) course.test.questions.push(question);
      }
      saveDb(db);
      redirect(response, `/admin/courses/${questionCreateMatch[1]}`);
      return;
    }

    const questionUpdateMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/test\/questions\/([^/]+)\/update$/);
    if (questionUpdateMatch) {
      const course = courseById(questionUpdateMatch[1]);
      const question = course?.test?.questions.find((item) => item.id === questionUpdateMatch[2]);
      if (question) {
        question.questionText = form.get("questionText")?.toString().trim() || question.questionText;
        question.sortOrder = Number(form.get("sortOrder") ?? question.sortOrder) || question.sortOrder;
        const options = parseQuestionOptions(form);
        if (options.length >= 2) question.options = options;
        if (!isQuestionValid(question)) {
          course.test.status = "inactive";
        }
      }
      saveDb(db);
      redirect(response, `/admin/courses/${questionUpdateMatch[1]}`);
      return;
    }

    const questionDeleteMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/test\/questions\/([^/]+)\/delete$/);
    if (questionDeleteMatch) {
      const course = courseById(questionDeleteMatch[1]);
      if (course?.test) {
        course.test.questions = course.test.questions.filter((question) => question.id !== questionDeleteMatch[2]);
        if (!isTestValid(course.test)) course.test.status = "inactive";
      }
      saveDb(db);
      redirect(response, `/admin/courses/${questionDeleteMatch[1]}`);
      return;
    }

    if (pathname === "/admin/certificates/revoke") {
      const returnTo = certificateAdminReturnTo(form);
      const certificate = db.certificates.find((item) => item.id === form.get("id"));
      const student = certificate ? userById(certificate.userId) : null;
      if (certificate && certificate.status === "issued") {
        certificate.status = "revoked";
        certificate.revokedAt = now();
        logCertificateEvent(certificate, "revoked", admin);
        if (student) {
          db.notifications.push({
            id: id("note"),
            recipientUserId: student.id,
            recipientEmail: student.email,
            type: "certificate_revoked",
            status: notificationInitialStatus(),
            payload: `Certificate revoked: ${certificate.certificateNumber}`,
            createdAt: now(),
            sentAt: now()
          });
        }
      }
      saveDb(db);
      redirect(response, returnTo);
      return;
    }

    if (pathname === "/admin/certificates/reissue") {
      const returnTo = certificateAdminReturnTo(form);
      const certificate = db.certificates.find((item) => item.id === form.get("id"));
      const assignment = certificate ? db.assignments.find((item) => item.id === certificate.assignmentId) : null;
      const student = certificate ? userById(certificate.userId) : null;
      const activeCertificate = assignment ? activeCertificateForAssignment(assignment.id) : null;
      if (certificate && assignment && student && hasCertificatePhoto(student) && (!activeCertificate || activeCertificate.id === certificate.id)) {
        if (certificate.status === "issued") {
          certificate.status = "reissued";
          certificate.reissuedAt = now();
        }
        const newCertificate = createCertificateForAssignment(assignment, {
          actor: admin,
          action: "reissued",
          replacesCertificateId: certificate.id
        });
        if (newCertificate) {
          logCertificateEvent(certificate, "replaced_by_reissue", admin, {
            newCertificateId: newCertificate.id,
            newCertificateNumber: newCertificate.certificateNumber
          });
          db.notifications.push({
            id: id("note"),
            recipientUserId: student.id,
            recipientEmail: student.email,
            type: "certificate_reissued",
            status: notificationInitialStatus(),
            payload: `Certificate reissued: ${newCertificate.certificateNumber}`,
            createdAt: now(),
            sentAt: now()
          });
        }
      }
      saveDb(db);
      redirect(response, returnTo);
      return;
    }

    if (pathname === "/admin/certificates/resend") {
      const returnTo = certificateAdminReturnTo(form);
      const certificate = db.certificates.find((item) => item.id === form.get("id"));
      const student = certificate ? userById(certificate.userId) : null;
      if (certificate && student) {
        logCertificateEvent(certificate, "resent", admin);
        db.notifications.push({
          id: id("note"),
          recipientUserId: student.id,
          recipientEmail: student.email,
          type: "certificate_resent",
          status: notificationInitialStatus(),
          payload: `Certificate resent: ${certificate.certificateNumber}`,
          createdAt: now(),
          sentAt: now()
        });
      }
      saveDb(db);
      redirect(response, returnTo);
      return;
    }
  }

  if (pathname === "/dashboard/materials/complete") {
    const student = requireUser(request, response);
    if (!student) return;
    const assignment = db.assignments.find((item) => item.id === form.get("assignmentId") && item.userId === student.id);
    const materialId = form.get("materialId")?.toString();
    const course = assignment ? courseById(assignment.courseId) : null;
    if (assignment && course && materialId && isMaterialUnlocked(course, assignment, materialId)) {
      if (!assignment.startedAt) assignment.startedAt = now();
      assignment.materialProgress[materialId] = {
        status: "completed",
        viewPercent: 100,
        openedAt: assignment.materialProgress[materialId]?.openedAt ?? now(),
        completedAt: now()
      };
      recalculateAssignment(assignment);
      saveDb(db);
      redirect(response, `/dashboard/courses/${assignment.id}`);
      return;
    }
  }

  const testSubmitMatch = pathname.match(/^\/dashboard\/tests\/([^/]+)$/);
  if (testSubmitMatch) {
    const student = requireUser(request, response);
    if (!student) return;
    const assignment = db.assignments.find((item) => item.id === testSubmitMatch[1] && item.userId === student.id);
    if (!assignment || !canTakeTest(assignment)) {
      redirect(response, "/dashboard/courses");
      return;
    }
    const course = courseById(assignment.courseId);
    const questions = course.test.questions;
    const startedAt = assignment.activeTestStartedAt || now();
    const expired =
      course.test.timeLimitMinutes > 0 &&
      Date.now() - new Date(startedAt).getTime() > course.test.timeLimitMinutes * 60 * 1000;
    let correctCount = 0;
    const answers = questions.map((question) => {
      const selectedOptionIds =
        question.type === "multiple_choice"
          ? form.getAll(question.id).map((value) => value.toString())
          : [form.get(question.id)?.toString() ?? ""].filter(Boolean);
      const correctOptionIds = question.options.filter((item) => item.isCorrect).map((item) => item.id).sort();
      const selectedSorted = [...selectedOptionIds].sort();
      const isCorrect =
        selectedSorted.length === correctOptionIds.length &&
        selectedSorted.every((optionId, index) => optionId === correctOptionIds[index]);
      if (isCorrect) correctCount += 1;
      return { questionId: question.id, selectedOptionId: selectedOptionIds[0] ?? "", selectedOptionIds, isCorrect };
    });
    const scorePercent = questions.length === 0 ? 0 : Math.round((correctCount / questions.length) * 100);
    const passed = !expired && scorePercent >= course.test.passingPercent;
    const attempt = {
      id: id("attempt"),
      assignmentId: assignment.id,
      testId: course.test.id,
      userId: student.id,
      attemptNumber: attemptsFor(assignment.id).length + 1,
      startedAt,
      finishedAt: now(),
      scorePercent,
      status: passed ? "passed" : "failed",
      failureReason: expired ? "time_expired" : "",
      answers
    };
    assignment.activeTestStartedAt = "";
    db.testAttempts.push(attempt);
    if (passed) {
      assignment.status = "completed";
      assignment.completedAt = now();
      assignment.progressPercent = 100;
      issueCertificate(assignment);
    } else {
      assignment.status = "test_failed";
    }
    saveDb(db);
    redirect(response, `/dashboard/courses/${assignment.id}`);
    return;
  }

  send(response, page("Не найдено", user, `<main class="page"><div class="notice">Маршрут не найден.</div></main>`), 404);
}

async function handleRequest(request, response) {
  db = await loadDb();
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const pathname = url.pathname;
  const user = currentUser(request);

  if (request.method === "GET" && pathname.startsWith("/uploads/")) {
    serveUpload(request, response, user, pathname.slice("/uploads/".length));
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && pathname === "/healthz") {
    return sendJson(response, {
      ok: true,
      service: "marine-lms",
      storage: usePrismaStorage ? "postgresql" : "json",
      time: now()
    });
  }

  if (request.method === "POST") {
    if (!sameOriginPost(request)) {
      send(response, page("Запрос отклонен", user, `<main class="page"><div class="notice danger">POST-запрос отклонен защитой same-origin.</div></main>`), 403);
      return;
    }
    await handlePost(request, response, pathname, user);
    return;
  }

  if (pathname === "/") return send(response, homePage(user));
  if (pathname === "/login") return send(response, loginPage(user, url.searchParams.get("notice") ?? ""));
  if (pathname === "/forgot-password") return send(response, forgotPasswordPage(user, url.searchParams.get("success") === "1"));
  if (pathname === "/apply") return send(response, applyPage(user, url.searchParams.get("success") === "1", url.searchParams.get("courseId") ?? ""));
  if (pathname === "/courses") return send(response, publicCoursesCatalog(user, url.searchParams));
  const publicCourseMatch = pathname.match(/^\/courses\/([^/]+)$/);
  if (publicCourseMatch) {
    const course = courseById(decodeURIComponent(publicCourseMatch[1]));
    const isVisible = course?.status === "active";
    return send(
      response,
      isVisible
        ? publicCourseDetail(user, course)
        : page("Курс не найден", user, `<main class="page"><section class="section"><div class="notice">Курс не найден или недоступен.</div><a class="button" href="/">На главную</a></section></main>`),
      isVisible ? 200 : 404
    );
  }

  if (pathname.startsWith("/admin")) {
    const admin = requireAdmin(request, response);
    if (!admin) return;
    if (isInstructor(admin) && !["/admin", "/admin/users"].includes(pathname)) {
      return send(response, adminShell(admin, "Нет доступа", `<section class="section"><div class="notice danger">Инструктору доступна только регистрация студентов и назначение курсов.</div><a class="button" href="/admin/users">К пользователям</a></section>`), 403);
    }
    if (pathname === "/admin") return send(response, adminDashboard(admin));
    if (pathname === "/admin/applications") return send(response, adminApplications(admin, url.searchParams));
    if (pathname === "/admin/users") return send(response, adminUsers(admin, url.searchParams));
    if (pathname === "/admin/reports") return send(response, adminReports(admin, url.searchParams));
    if (pathname === "/admin/tests") return send(response, adminTests(admin, url.searchParams));
    if (pathname === "/admin/courses") return send(response, adminCourses(admin, url.searchParams));
    if (pathname === "/admin/homepage") return send(response, adminHomepage(admin));
    if (pathname === "/admin/files/import-report.csv") return sendImportQualityCsv(response);
    if (pathname === "/admin/files") return send(response, adminFiles(admin, url.searchParams));
    if (pathname === "/admin/certificates/export.csv") return sendCertificatesCsv(response, url.searchParams);
    if (pathname === "/admin/certificates/export.xls") return sendCertificatesExcel(response, url.searchParams);
    if (pathname === "/admin/certificates") return send(response, adminCertificates(admin, url.searchParams));
    if (pathname === "/admin/notifications") return send(response, adminNotifications(admin, url.searchParams));
    if (pathname === "/admin/audit") return send(response, adminAudit(admin, url.searchParams));
    const adminUserMatch = pathname.match(/^\/admin\/users\/([^/]+)$/);
    if (adminUserMatch) {
      const student = db.users.find((item) => item.id === decodeURIComponent(adminUserMatch[1]) && item.role === "student");
      return send(response, student ? adminStudentDetail(admin, student) : adminShell(admin, "Не найдено", `<div class="notice">Студент не найден.</div>`), student ? 200 : 404);
    }
    const testPreviewMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/test\/preview$/);
    if (testPreviewMatch) {
      const course = courseById(testPreviewMatch[1]);
      return send(response, course ? adminTestPreview(admin, course) : adminShell(admin, "Не найдено", `<div class="notice">Курс не найден.</div>`), course ? 200 : 404);
    }
    const certificateTemplatePreviewMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/certificate-template\/preview$/);
    if (certificateTemplatePreviewMatch) {
      const course = courseById(certificateTemplatePreviewMatch[1]);
      return send(response, course ? adminCertificateTemplatePreview(admin, course) : adminShell(admin, "Не найдено", `<div class="notice">Курс не найден.</div>`), course ? 200 : 404);
    }
    const courseMatch = pathname.match(/^\/admin\/courses\/([^/]+)$/);
    if (courseMatch) {
      const course = courseById(courseMatch[1]);
      return send(response, course ? adminCourseDetail(admin, course) : adminShell(admin, "Не найдено", `<div class="notice">Курс не найден.</div>`), course ? 200 : 404);
    }
  }

  if (pathname.startsWith("/dashboard")) {
    const student = requireUser(request, response);
    if (!student) return;
    if (canAccessAdminPanel(student)) return redirect(response, "/admin");
    if (pathname === "/dashboard") return send(response, studentDashboard(student));
    if (pathname === "/dashboard/courses") return send(response, studentCourses(student));
    if (pathname === "/dashboard/tests") return send(response, studentTests(student));
    if (pathname === "/dashboard/certificates") return send(response, studentCertificates(student));
    if (pathname === "/dashboard/profile") return send(response, studentProfile(student));
    const assignmentMatch = pathname.match(/^\/dashboard\/courses\/([^/]+)$/);
    if (assignmentMatch) {
      const assignment = db.assignments.find((item) => item.id === assignmentMatch[1] && item.userId === student.id);
      return send(response, assignment ? studentCourseDetail(student, assignment) : studentShell(student, "Не найдено", `<div class="notice">Курс не найден.</div>`), assignment ? 200 : 404);
    }
    const testMatch = pathname.match(/^\/dashboard\/tests\/([^/]+)$/);
    if (testMatch) {
      const assignment = db.assignments.find((item) => item.id === testMatch[1] && item.userId === student.id);
      return send(response, assignment ? studentTestPage(student, assignment) : studentShell(student, "Не найдено", `<div class="notice">Тест не найден.</div>`), assignment ? 200 : 404);
    }
  }

  const verifyMatch = pathname.match(/^\/verify\/(.+)$/);
  if (verifyMatch) {
    const certificateNumberToVerify = decodeURIComponent(verifyMatch[1]).toUpperCase();
    const cert = db.certificates.find((certificate) => certificate.certificateNumber.toUpperCase() === certificateNumberToVerify);
    return send(response, verifyCertificatePage(cert), cert ? 200 : 404);
  }

  const certPdfMatch = pathname.match(/^\/certificates\/([^/]+)\.pdf$/);
  if (certPdfMatch) {
    const cert = db.certificates.find((certificate) => certificate.id === certPdfMatch[1]);
    if (!cert || !user || (user.role !== "admin" && cert.userId !== user.id)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }
    const pdf = await certificatePdfBuffer(cert);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${cert.certificateNumber.replace(/[^a-zA-Z0-9_-]+/g, "-")}.pdf"`
    });
    response.end(pdf);
    return;
  }

  const certMatch = pathname.match(/^\/certificates\/([^/]+)$/);
  if (certMatch) {
    const cert = db.certificates.find((certificate) => certificate.id === certMatch[1]);
    return send(response, cert ? certificatePage(user, cert) : page("Не найдено", user, `<main class="page"><div class="notice">Сертификат не найден.</div></main>`), cert ? 200 : 404);
  }

  send(response, page("Не найдено", user, `<main class="page"><div class="notice">Страница не найдена.</div></main>`), 404);
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error(error);
    send(response, page("Ошибка", null, `<main class="page"><div class="notice danger">Ошибка сервера: ${escapeHtml(error.message)}</div></main>`), 500);
  });
});

server.listen(port, host, () => {
  console.log(`Marine LMS is ready: http://${host}:${port}`);
  console.log(`Storage: ${usePrismaStorage ? `PostgreSQL ${maskedConnectionString(databaseUrl)}` : "JSON data/db.json"}`);
  if (process.env.NODE_ENV !== "production") {
    console.log("Demo admin: admin@example.com / Admin123!");
    console.log("Demo student: student@example.com / Student123!");
  }
});
