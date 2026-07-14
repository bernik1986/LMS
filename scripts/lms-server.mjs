import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { PDFDocument as PdfLibDocument, rgb, StandardFonts } from "pdf-lib";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { loadLocalEnv } from "./env.mjs";
import { loadPrismaDb, maskedConnectionString, replacePrismaDb, resolveConnectionString, syncPrismaDb } from "./prisma-db.mjs";

loadLocalEnv();

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://${host}:${port}`;
const dbPath = resolve(process.env.LMS_DB_PATH ?? "data/db.json");
const uploadsDir = resolve("data/uploads");
const publicAssetsDir = resolve("assets");
const cssPath = resolve("src/app/globals.css");
const databaseUrl = resolveConnectionString();
const storageDriver = (process.env.LMS_STORAGE ?? (process.env.DATABASE_URL ? "prisma" : "json")).toLowerCase();
const usePrismaStorage = ["prisma", "postgres", "postgresql"].includes(storageDriver);
const maxMaterialUploadBytes = Number(process.env.MAX_MATERIAL_UPLOAD_MB ?? 25) * 1024 * 1024;
const maxVideoUploadBytes = Number(process.env.MAX_VIDEO_UPLOAD_MB ?? 512) * 1024 * 1024;
const maxPhotoUploadBytes = Number(process.env.MAX_PHOTO_UPLOAD_MB ?? 3) * 1024 * 1024;
const maxCourseImageUploadBytes = Number(process.env.MAX_COURSE_IMAGE_MB ?? 8) * 1024 * 1024;
const maxCertificateBackgroundUploadBytes = Number(process.env.MAX_CERTIFICATE_TEMPLATE_MB ?? 20) * 1024 * 1024;
const maxRequestBodyBytes = Number(process.env.MAX_REQUEST_BODY_MB ?? Math.ceil(maxVideoUploadBytes / 1024 / 1024 + 8)) * 1024 * 1024;
const sessionTtlMs = Number(process.env.SESSION_TTL_HOURS ?? 12) * 60 * 60 * 1000;
const passwordResetTtlMs = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30) * 60 * 1000;
const trustProxy = process.env.TRUST_PROXY === "true";
const isProduction = process.env.NODE_ENV === "production";
const allowDemoData = process.env.LMS_ALLOW_DEMO_DATA === "true" || !isProduction;
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()"
};
if (isProduction && publicBaseUrl.startsWith("https://")) {
  securityHeaders["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
}

function responseSecurityHeaders(nonce = "") {
  const scriptSource = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
  return {
    ...securityHeaders,
    "Content-Security-Policy": `default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: https://wwwcdn.imo.org; media-src 'self'; font-src 'self' data:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src ${scriptSource}`
  };
}
const loginAttempts = new Map();
const passwordResetAttempts = new Map();
const csrfTokens = new Map();
let saveQueue = Promise.resolve();
let lastSaveError = null;
let requestQueue = Promise.resolve();
let persistedDb = null;
let imoNewsCache = { items: [], fetchedAt: 0 };

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
.admin-edit-grid .field-wide { grid-column: 1 / -1; }
.course-cover { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border: 1px solid var(--line); border-radius: var(--radius); background: linear-gradient(135deg, var(--primary-soft), var(--surface-muted)); }
.course-cover.placeholder { display: grid; place-items: center; color: var(--primary-strong); font-weight: 850; }
.course-cover.thumb { width: 104px; min-width: 104px; }
.course-cover.editor { max-width: 420px; }
.course-title-cell { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 12px; align-items: center; }
.course-cover.admin-course-avatar { width: 64px; min-width: 64px; aspect-ratio: 1; border-radius: 50%; }
.course-title-cell.admin-course-title-cell { grid-template-columns: 64px minmax(0, 1fr); gap: 10px; min-width: 220px; }
.course-price { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin: 4px 0; }
.course-price-old { color: var(--muted); text-decoration: line-through; font-weight: 800; }
.course-price-new { color: var(--accent); font-size: 20px; font-weight: 900; }
.course-price.empty { color: var(--muted); font-weight: 800; }
.imo-news-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 24px; }
.imo-news-card { display: grid; grid-template-rows: auto 1fr; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow); }
.imo-news-image { width: 100%; aspect-ratio: 16 / 8.5; object-fit: cover; background: var(--primary-soft); }
.imo-news-content { display: grid; align-content: start; gap: 16px; padding: 22px; }
.imo-news-meta { color: var(--accent); font-size: 14px; font-weight: 850; }
.imo-news-card h2 { margin: 0; font-size: 26px; line-height: 1.22; }
.imo-news-card p { margin: 0; color: var(--muted); font-size: 16px; line-height: 1.55; }
.imo-news-card .small-button { justify-self: start; margin-top: 4px; }
.course-prices-table th, .course-prices-table td { padding: 8px 10px; }
.course-prices-table input { min-width: 120px; min-height: 34px; padding: 7px 9px; }
.course-prices-table .course-name-cell { font-weight: 850; color: var(--primary-strong); min-width: 220px; }
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
.checkbox-list { display: flex; flex-wrap: wrap; gap: 8px 14px; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-muted); }
.checkbox-list .checkbox-row { font-size: 13px; }
.checkbox-list input[type="checkbox"] { width: auto; min-width: 16px; min-height: 16px; height: 16px; margin: 0; padding: 0; accent-color: var(--primary); }
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
.certificate-designer-field.is-selected::after { content: ""; position: absolute; right: -7px; bottom: -7px; width: 12px; height: 12px; border: 2px solid #fff; border-radius: 2px; background: var(--accent); box-shadow: 0 1px 3px rgba(13, 27, 42, 0.3); pointer-events: none; }
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

// Prices are temporarily hidden only from public visitors while administrators configure them.
const SHOW_PUBLIC_COURSE_PRICES = false;

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

function hashSecret(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function opaqueToken() {
  return randomBytes(32).toString("base64url");
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
    createdById: "",
    authVersion: 1,
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
    createdById: admin.id,
    authVersion: 1,
    createdAt: now()
  };

  const safetyCourse = {
    id: "course_maritime_safety",
    title: "Basic Maritime Safety",
    shortDescription: "Basic onboard safety and mandatory procedures course.",
    fullDescription:
      "Private maritime course with sequential materials, a final test, and a certificate.",
    goals: "Prepare the student for basic onboard safety procedures.",
    requirements: "Complete the required materials and pass the final test.",
    oldPrice: "",
    newPrice: "",
    status: "active",
    isSequential: true,
    imageUrl: "",
    showOnHome: true,
    homeSortOrder: 1,
    lessons: [
      {
        id: "lesson_intro",
        title: "Introduction to onboard safety",
        description: "General rules and course completion procedure.",
        sortOrder: 1,
        isRequired: true,
        status: "active",
        materials: [
          {
            id: "material_intro_text",
            type: "text",
            title: "Completion rules",
            content:
              "Materials are completed in sequence. The final test opens after the required learning section is complete.",
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
        title: "Emergency response",
        description: "Evacuation routes, alarm signals, and muster points.",
        sortOrder: 2,
        isRequired: true,
        status: "active",
        materials: [
          {
            id: "material_emergency_text",
            type: "text",
            title: "Response procedure",
            content:
              "The student must know alarm signals, evacuation routes, and the reporting procedure for the responsible officer.",
            isRequired: true,
            sortOrder: 1
          }
        ]
      }
    ],
    test: {
      id: "test_safety",
      title: "Safety final test",
      description: "Assessment of required knowledge after the learning materials.",
      attemptsLimit: 3,
      passingPercent: 80,
      timeLimitMinutes: 0,
      showResultToUser: true,
      allowRetake: true,
      status: "active",
      questions: [
        {
          id: "q_test_access",
          questionText: "When does the student receive access to the final test?",
          sortOrder: 1,
          options: [
            { id: "q1_o1", optionText: "Immediately after course assignment", isCorrect: false, sortOrder: 1 },
            {
              id: "q1_o2",
              optionText: "After completing the required materials",
              isCorrect: true,
              sortOrder: 2
            }
          ]
        },
        {
          id: "q_alarm",
          questionText: "What should be done when an alarm signal is given?",
          sortOrder: 2,
          options: [
            { id: "q2_o1", optionText: "Follow the approved emergency procedure", isCorrect: true, sortOrder: 1 },
            { id: "q2_o2", optionText: "Continue normal work", isCorrect: false, sortOrder: 2 }
          ]
        }
      ]
    },
    createdAt: now()
  };

  const firstAidCourse = {
    id: "course_first_aid",
    title: "First Aid at Sea",
    shortDescription: "Maritime first aid course with a final test.",
    fullDescription: "Required actions for onboard injuries and medical emergencies.",
    goals: "Reinforce first aid procedures before medical support arrives.",
    requirements: "Complete the materials and pass the test.",
    oldPrice: "",
    newPrice: "",
    status: "active",
    isSequential: true,
    imageUrl: "",
    showOnHome: true,
    homeSortOrder: 2,
    lessons: [
      {
        id: "lesson_aid_intro",
        title: "Primary assessment",
        description: "Scene safety and assessment of consciousness, breathing, and bleeding.",
        sortOrder: 1,
        isRequired: true,
        status: "active",
        materials: [
          {
            id: "material_aid_text",
            type: "text",
            title: "Initial examination",
            content: "Check safety, consciousness, breathing, and severe bleeding.",
            isRequired: true,
            sortOrder: 1
          }
        ]
      }
    ],
    test: {
      id: "test_first_aid",
      title: "First aid final test",
      description: "Basic knowledge assessment.",
      attemptsLimit: 2,
      passingPercent: 75,
      timeLimitMinutes: 0,
      showResultToUser: true,
      allowRetake: true,
      status: "active",
      questions: [
        {
          id: "q_aid_1",
          questionText: "What is the first step in providing first aid?",
          sortOrder: 1,
          options: [
            { id: "q_aid_1_o1", optionText: "Assess scene safety", isCorrect: true, sortOrder: 1 },
            { id: "q_aid_1_o2", optionText: "Complete a report", isCorrect: false, sortOrder: 2 }
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
    if (user.createdById === undefined) {
      user.createdById = "";
      changed = true;
    }
    if (!Number.isInteger(user.authVersion) || user.authVersion < 1) {
      user.authVersion = 1;
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
    if (course.oldPrice === undefined) {
      course.oldPrice = "";
      changed = true;
    }
    if (course.newPrice === undefined) {
      course.newPrice = "";
      changed = true;
    }
    for (const priceKey of ["oldPrice", "newPrice"]) {
      const normalizedPrice = normalizeCoursePrice(course[priceKey]);
      if (course[priceKey] !== normalizedPrice) {
        course[priceKey] = normalizedPrice;
        changed = true;
      }
    }
    if (!course.certificateTemplateHtml) {
      course.certificateTemplateHtml = defaultCertificateTemplate();
      changed = true;
    }
    const upgradedTemplate = upgradeCertificatePdfEmbeds(course.certificateTemplateHtml);
    if (upgradedTemplate !== course.certificateTemplateHtml) {
      course.certificateTemplateHtml = upgradedTemplate;
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
    const upgradedSnapshot = upgradeCertificatePdfEmbeds(certificate.snapshotCertificateTemplateHtml);
    const upgradedCertificate = upgradeCertificatePdfEmbeds(certificate.certificateHtml);
    if (upgradedSnapshot !== certificate.snapshotCertificateTemplateHtml || upgradedCertificate !== certificate.certificateHtml) {
      certificate.snapshotCertificateTemplateHtml = upgradedSnapshot;
      certificate.certificateHtml = upgradedCertificate;
      changed = true;
    }
  }
  if (!data.settings) {
    data.settings = {};
    changed = true;
  }
  if (!Array.isArray(data.settings.invoices)) {
    data.settings.invoices = [];
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
  if (!Array.isArray(data.sessions)) {
    data.sessions = [];
    changed = true;
  }
  if (!Array.isArray(data.passwordResetTokens)) {
    data.passwordResetTokens = [];
    changed = true;
  }
  for (const note of data.notifications ?? []) {
    if (Object.prototype.hasOwnProperty.call(note, "temporaryPassword")) {
      delete note.temporaryPassword;
      changed = true;
    }
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
    if (String(data.settings.emailTemplates.password_recovery?.body ?? "").includes("temporaryPassword")) {
      data.settings.emailTemplates.password_recovery = defaults.password_recovery;
      changed = true;
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
      if (!allowDemoData) {
        throw new Error("Production database is empty. Import data or create the first administrator before starting Marine LMS.");
      }
      const seedData = createSeedData();
      normalizeDb(seedData);
      await replacePrismaDb(seedData, { connectionString: databaseUrl });
      return seedData;
    }
    const originalData = cloneDb(data);
    const changed = normalizeDb(data);
    if (changed) await syncPrismaDb(originalData, data, { connectionString: databaseUrl });
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
  const previousSnapshot = persistedDb ?? snapshot;
  persistedDb = snapshot;
  const write = saveQueue
    .catch(() => {})
    .then(() => syncPrismaDb(previousSnapshot, snapshot, { connectionString: databaseUrl }));

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
persistedDb = cloneDb(db);

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
    .replace(/<(?:iframe|object|embed|base|meta|link|form)\b[\s\S]*?>[\s\S]*?<\/(?:iframe|object|embed|base|meta|link|form)>/gi, "")
    .replace(/<(?:iframe|object|embed|base|meta|link|form)\b[^>]*\/?\s*>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s(?:href|src|xlink:href|action|formaction)\s*=\s*(["'])\s*(?:javascript:|data:text\/html)[\s\S]*?\1/gi, "")
    .replace(/\s(?:href|src|xlink:href|action|formaction)\s*=\s*(?:javascript:|data:text\/html)[^\s>]*/gi, "");
}

function upgradeCertificatePdfEmbeds(html) {
  return String(html ?? "")
    .replace(
      /<object class="(visual-cert-pdf-bg|certificate-designer-pdf-bg)" data="([^"]+)" type="application\/pdf" aria-hidden="true"><\/object>/gi,
      (_, className, source) => `<iframe class="${className}" src="${source}" title="Certificate background" tabindex="-1"></iframe>`
    )
    .replace(
      /(<iframe class="(?:visual-cert-pdf-bg|certificate-designer-pdf-bg)" src=")([^"#]+)(?:#[^"]*)?(" title="Certificate background" tabindex="-1"><\/iframe>)/gi,
      (_, prefix, source, suffix) => `${prefix}${source}#zoom=page-width&toolbar=0&navpanes=0&scrollbar=0${suffix}`
    );
}

function addYearsIso(value, years) {
  const date = value ? new Date(value) : new Date();
  date.setFullYear(date.getFullYear() + years);
  return date.toISOString();
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("en-GB") : "";
}

function formatEnglishCertificateDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return `${day}-${month}-${date.getUTCFullYear()}`;
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
    birthDateEn: escapeHtml(formatEnglishCertificateDate(certificate.snapshotBirthDate)),
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
    { key: "header", label: "Header", text: "", editableText: true, x: 12, y: 10, width: 76, height: 7, fontSize: 22, color: "#0b4f7a", align: "center", fontWeight: "800", visible: false },
    { key: "convention", label: "Convention reference", text: "", editableText: true, x: 12, y: 19, width: 76, height: 6, fontSize: 14, color: "#0d1b2a", align: "center", fontWeight: "500", visible: false },
    { key: "fullName", label: "Full name", x: 18, y: 34, width: 64, height: 8, fontSize: 42, color: "#0b4f7a", align: "center", fontWeight: "800", visible: true },
    { key: "courseTitle", label: "Course title", x: 19, y: 52, width: 62, height: 8, fontSize: 28, color: "#06395d", align: "center", fontWeight: "800", visible: true },
    { key: "birthDate", label: "Birth date", x: 24, y: 44, width: 24, height: 4, fontSize: 15, color: "#0d1b2a", align: "center", fontWeight: "500", visible: true },
    { key: "birthDateEn", label: "Birth date (04-Nov-1972)", x: 24, y: 44, width: 24, height: 4, fontSize: 15, color: "#0d1b2a", align: "center", fontWeight: "500", visible: false },
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

function cleanCertificateDesignerText(value, fallback = "") {
  const text = String(value ?? fallback).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 500);
}

function isCustomCertificateDesignerFieldKey(value) {
  return /^custom_text_[a-z0-9_]{1,48}$/i.test(String(value ?? ""));
}

function isCustomCertificateDesignerImageKey(value) {
  return /^custom_image_[a-z0-9_]{1,48}$/i.test(String(value ?? ""));
}

function normalizeCustomCertificateDesignerField(field, index) {
  const fallbackLabel = `Text field ${index + 1}`;
  return {
    key: String(field.key),
    label: cleanCertificateDesignerText(field.label, fallbackLabel).slice(0, 80) || fallbackLabel,
    x: clampNumber(field.x, 0, 98, 18),
    y: clampNumber(field.y, 0, 98, 20 + index * 6),
    width: clampNumber(field.width, 2, 100, 50),
    height: clampNumber(field.height, 2, 100, 6),
    fontSize: clampNumber(field.fontSize, 6, 96, 18),
    color: cleanColor(field.color, "#0d1b2a"),
    align: cleanAlign(field.align),
    fontWeight: cleanFontWeight(field.fontWeight),
    visible: field.visible === undefined ? true : Boolean(field.visible),
    editableText: true,
    isCustomText: true,
    text: cleanCertificateDesignerText(field.text, "New text")
  };
}

function normalizeCustomCertificateDesignerImage(field, index) {
  const fallbackLabel = `Image ${index + 1}`;
  const pendingImageIndex = Number(field.pendingImageIndex);
  return {
    key: String(field.key),
    label: cleanCertificateDesignerText(field.label, fallbackLabel).slice(0, 80) || fallbackLabel,
    x: clampNumber(field.x, 0, 98, 20),
    y: clampNumber(field.y, 0, 98, 20 + index * 5),
    width: clampNumber(field.width, 2, 100, 20),
    height: clampNumber(field.height, 2, 100, 20),
    fontSize: 12,
    color: "#0d1b2a",
    align: "center",
    fontWeight: "500",
    visible: field.visible === undefined ? true : Boolean(field.visible),
    isCustomImage: true,
    imageUrl: cleanBackgroundUrl(field.imageUrl),
    ...(Number.isInteger(pendingImageIndex) && pendingImageIndex >= 0 ? { pendingImageIndex } : {})
  };
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

function defaultCertificateDesigner(backgroundUrl = "", backgroundType = "", stampUrl = "", pageWidth = 1123, pageHeight = 794) {
  const cleanUrl = cleanBackgroundUrl(backgroundUrl);
  return {
    version: 2,
    backgroundUrl: cleanUrl,
    backgroundType: cleanBackgroundType(backgroundType, cleanUrl),
    stampUrl: cleanStampUrl(stampUrl),
    pageWidth: clampNumber(pageWidth, 100, 5000, 1123),
    pageHeight: clampNumber(pageHeight, 100, 5000, 794),
    fields: certificateDesignerFieldDefinitions()
  };
}

function normalizeCertificateDesigner(input = {}) {
  const existing = input && typeof input === "object" ? input : {};
  const backgroundUrl = cleanBackgroundUrl(existing.backgroundUrl);
  const stampUrl = cleanStampUrl(existing.stampUrl);
  const inputFields = Array.isArray(existing.fields) ? existing.fields : [];
  const fieldsByKey = new Map(inputFields.map((field) => [field.key, field]));
  const customFields = inputFields
    .filter((field) => isCustomCertificateDesignerFieldKey(field?.key) || isCustomCertificateDesignerImageKey(field?.key))
    .filter((field, index, fields) => fields.findIndex((item) => item.key === field.key) === index)
    .slice(0, 30)
    .map((field, index) =>
      isCustomCertificateDesignerImageKey(field.key)
        ? normalizeCustomCertificateDesignerImage(field, index)
        : normalizeCustomCertificateDesignerField(field, index)
    );
  return {
    version: 2,
    backgroundUrl,
    backgroundType: cleanBackgroundType(existing.backgroundType, backgroundUrl),
    stampUrl,
    pageWidth: clampNumber(existing.pageWidth, 100, 5000, 1123),
    pageHeight: clampNumber(existing.pageHeight, 100, 5000, 794),
    fields: [...certificateDesignerFieldDefinitions().map((definition) => {
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
        visible: field.visible === undefined ? definition.visible : Boolean(field.visible),
        editableText: Boolean(definition.editableText),
        ...(definition.editableText ? { text: cleanCertificateDesignerText(field.text, definition.text) } : {})
      };
    }), ...customFields]
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
  if (field.isCustomImage) return field.imageUrl ? `<img src="${escapeHtml(field.imageUrl)}" alt="${escapeHtml(field.label)}" />` : "";
  if (field.editableText) return escapeHtml(field.text || "");
  return `{{${field.key}}}`;
}

function certificateDesignerCanvasStyle(designer, includeBackground = false) {
  const styles = [
    `aspect-ratio:${designer.pageWidth}/${designer.pageHeight}`,
    `max-width:${designer.pageHeight > designer.pageWidth ? 794 : 1123}px`
  ];
  if (designer.pageHeight > designer.pageWidth) styles.push("margin-inline:auto");
  if (includeBackground && designer.backgroundUrl && designer.backgroundType !== "pdf") {
    styles.push(`background-image:url('${escapeHtml(designer.backgroundUrl)}')`);
  }
  return ` style="${styles.join(";")}"`;
}

function certificateTemplateFromDesigner(designerInput) {
  const designer = normalizeCertificateDesigner(designerInput);
  const hasBackground = Boolean(designer.backgroundUrl);
  const hasPdfBackground = hasBackground && designer.backgroundType === "pdf";
  const canvasStyle = certificateDesignerCanvasStyle(designer, true);
  const backgroundLayer = hasPdfBackground
    ? `<iframe class="visual-cert-pdf-bg" src="${escapeHtml(designer.backgroundUrl)}#zoom=page-width&toolbar=0&navpanes=0&scrollbar=0" title="Certificate background" tabindex="-1"></iframe>`
    : "";
  const fields = certificateDesignerFieldsForRender(designer.fields.filter((field) => field.visible))
    .map((field) => `<div class="${certificateDesignerFieldClasses(field, "visual-cert-field")}" style="${certificateDesignerFieldStyle(field)}">${certificateDesignerToken(field, designer)}</div>`)
    .join("");
  return `<div class="visual-certificate${hasBackground ? "" : " no-background"}${hasPdfBackground ? " has-pdf-background" : ""}" data-visual-certificate="1" data-background-type="${hasPdfBackground ? "pdf" : "image"}" data-background-url="${escapeHtml(designer.backgroundUrl)}" data-page-width="${designer.pageWidth}" data-page-height="${designer.pageHeight}"${canvasStyle}>${backgroundLayer}${fields}</div>`;
}

function certificateShellClass(certificateHtml, extra = "") {
  const classes = ["certificate"];
  if (extra) classes.push(extra);
  if (String(certificateHtml).includes("data-visual-certificate")) classes.push("visual-certificate-page");
  return classes.join(" ");
}

async function normalizeCertificateBackgroundPdf(buffer) {
  try {
    const sourcePdf = await PdfLibDocument.load(buffer, { ignoreEncryption: true });
    const sourcePage = sourcePdf.getPageCount() ? sourcePdf.getPage(0) : null;
    if (!sourcePage) return buffer;
    const cropBox = sourcePage.getCropBox();
    const mediaBox = sourcePage.getMediaBox();
    const isAlreadyNormalized =
      Math.abs(cropBox.x - mediaBox.x) < 0.01 &&
      Math.abs(cropBox.y - mediaBox.y) < 0.01 &&
      Math.abs(cropBox.width - mediaBox.width) < 0.01 &&
      Math.abs(cropBox.height - mediaBox.height) < 0.01;
    if (isAlreadyNormalized) return buffer;

    // Some source certificates use a wide technical MediaBox with a portrait CropBox.
    // Flatten the visible crop into a real page so browser previews fill the canvas too.
    const normalizedPdf = await PdfLibDocument.create();
    const normalizedPage = normalizedPdf.addPage([cropBox.width, cropBox.height]);
    const embeddedPage = await normalizedPdf.embedPage(sourcePage, {
      left: cropBox.x,
      bottom: cropBox.y,
      right: cropBox.x + cropBox.width,
      top: cropBox.y + cropBox.height
    });
    normalizedPage.drawPage(embeddedPage, { x: 0, y: 0, width: cropBox.width, height: cropBox.height });
    return Buffer.from(await normalizedPdf.save());
  } catch {
    return buffer;
  }
}

async function certificateBackgroundPageSize(buffer, isPdf) {
  try {
    if (isPdf) {
      const pdf = await PdfLibDocument.load(buffer, { ignoreEncryption: true });
      const page = pdf.getPageCount() ? pdf.getPage(0) : null;
      return page ? page.getCropBox() : null;
    }
    const metadata = await sharp(buffer, { animated: false }).metadata();
    return metadata.width && metadata.height ? { width: metadata.width, height: metadata.height } : null;
  } catch {
    return null;
  }
}

async function saveCertificateDesignerBackground(course, file) {
  if (!file || typeof file === "string" || !file.buffer?.length) return { ok: true, skipped: true };
  const isPdf = isPdfFile(file);
  if (!isPdf && !imageUploadAllowed(file)) {
    return { ok: false, message: "Upload certificate background as PDF, JPG, PNG, WebP or GIF." };
  }
  const limit = isPdf ? maxCertificateBackgroundUploadBytes : maxCourseImageUploadBytes;
  if (file.buffer.length > limit) {
    return { ok: false, message: `Certificate background is too large. Maximum size: ${Math.round(limit / 1024 / 1024)} MB.` };
  }
  mkdirSync(uploadsDir, { recursive: true });
  const fileName = `certificate_template_${course.id}-${Date.now()}${isPdf ? ".pdf" : imageExtension(file)}`;
  const backgroundBuffer = isPdf ? await normalizeCertificateBackgroundPdf(file.buffer) : file.buffer;
  writeFileSync(resolve(uploadsDir, fileName), backgroundBuffer);
  const pageSize = await certificateBackgroundPageSize(backgroundBuffer, isPdf);
  return {
    ok: true,
    backgroundUrl: `/uploads/${fileName}`,
    backgroundType: isPdf ? "pdf" : "image",
    pageWidth: pageSize?.width,
    pageHeight: pageSize?.height
  };
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

function saveCertificateDesignerOverlayImage(course, file, index = 0) {
  if (!file || typeof file === "string" || !file.buffer?.length) return { ok: true, skipped: true };
  if (!imageUploadAllowed(file)) {
    return { ok: false, message: "Upload image elements as JPG, PNG, WebP or GIF. Transparent PNG is supported." };
  }
  if (file.buffer.length > maxCourseImageUploadBytes) {
    return { ok: false, message: `Image element is too large. Maximum size: ${Math.round(maxCourseImageUploadBytes / 1024 / 1024)} MB.` };
  }
  mkdirSync(uploadsDir, { recursive: true });
  const fileName = `certificate_element_${course.id}-${Date.now()}-${index}${imageExtension(file)}`;
  writeFileSync(resolve(uploadsDir, fileName), file.buffer);
  return { ok: true, imageUrl: `/uploads/${fileName}` };
}

function certificateDesignerEditorFieldHtml(field) {
  const editorText = field.editableText ? field.text || field.label : field.label;
  const editorContent = field.isCustomImage && field.imageUrl ? `<img src="${escapeHtml(field.imageUrl)}" alt="${escapeHtml(field.label)}" />` : escapeHtml(editorText);
  return `<div class="${certificateDesignerFieldClasses(field, "certificate-designer-field")} ${field.visible ? "" : "is-hidden"}" data-designer-field="${escapeHtml(field.key)}" style="${certificateDesignerFieldStyle(field)}">${editorContent}</div>`;
}

function certificateDesignerEditorHtml(course, previewCertificate) {
  const designer = certificateDesignerForCourse(course);
  const designerJson = escapeHtml(JSON.stringify(designer));
  const hasPdfBackground = Boolean(designer.backgroundUrl) && designer.backgroundType === "pdf";
  const canvasStyle = certificateDesignerCanvasStyle(designer, true);
  const backgroundLayer = hasPdfBackground
    ? `<iframe class="certificate-designer-pdf-bg" src="${escapeHtml(designer.backgroundUrl)}#zoom=page-width&toolbar=0&navpanes=0&scrollbar=0" title="Certificate background" tabindex="-1"></iframe>`
    : "";
  const fieldOptions = designer.fields.map((field) => `<option value="${escapeHtml(field.key)}">${escapeHtml(field.label)}</option>`).join("");
  const previewClass = certificateShellClass(previewCertificate.certificateHtml, "certificate-preview");
  return `<article class="panel certificate-template">
        <h2>Visual certificate designer</h2>
        <p class="muted">Upload a certificate PDF or image, add text or image elements, drag fields on the canvas, tune size and color, then save.</p>
        <form class="stack" method="post" action="/admin/courses/${course.id}/certificate-designer" enctype="multipart/form-data" data-certificate-designer>
          <textarea name="designerJson" data-designer-json hidden>${designerJson}</textarea>
          <div class="certificate-designer-layout">
            <div class="certificate-designer-stage">
              <div class="certificate-designer-canvas ${designer.backgroundUrl ? "" : "no-background"}${hasPdfBackground ? " has-pdf-background" : ""}" data-designer-canvas${canvasStyle}>
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
              <div class="field" data-custom-text-panel hidden><label>Text content</label><textarea rows="3" maxlength="500" data-field-text placeholder="Enter text for this field"></textarea></div>
              <div class="field"><label>Header text</label><input type="text" maxlength="500" data-designer-header-text placeholder="Enter certificate header" /></div>
              <div class="field"><label>Convention reference</label><textarea rows="3" maxlength="500" data-designer-convention-text placeholder="Enter the convention or standard reference"></textarea></div>
              <input name="overlayImageFiles" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden data-overlay-image-files />
              <div class="table-actions"><button class="small-button" type="button" data-add-text-field>Add text field</button><button class="small-button" type="button" data-add-image-field>Add image</button><button class="small-button danger" type="button" data-remove-custom-field disabled>Remove selected custom element</button></div>
              <div class="field"><label>PDF or background image</label><input name="backgroundFile" type="file" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/gif" /></div>
              <div class="field"><label>Stamp image, always top layer</label><input name="stampFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></div>
              <label class="checkbox-row"><input name="removeStamp" type="checkbox" /> Remove stamp</label>
              <label class="checkbox-row"><input name="removeBackground" type="checkbox" /> Remove background</label>
              <label class="checkbox-row"><input name="resetDesigner" type="checkbox" /> Reset layout</label>
              <label class="checkbox-row"><input name="applyToAllCourses" type="checkbox" /> Apply this template to all courses and new courses</label>
              <button class="button" type="submit">Save visual template</button>
              <div class="certificate-designer-help">Use Add image for JPG, PNG, WebP or GIF. Transparent PNG overlays are supported. Drag fields with the mouse; drag the blue corner marker to resize. Stamp is always rendered above text, photo and QR. Existing issued certificates keep their old snapshot.</div>
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
  return `<script nonce="{{CSP_NONCE}}">
(() => {
  const root = document.querySelector("[data-certificate-designer]");
  if (!root || root.dataset.ready === "1") return;
  root.dataset.ready = "1";
  const jsonInput = root.querySelector("[data-designer-json]");
  const canvas = root.querySelector("[data-designer-canvas]");
  const select = root.querySelector("[data-field-select]");
  const customTextPanel = root.querySelector("[data-custom-text-panel]");
  const addTextField = root.querySelector("[data-add-text-field]");
  const addImageField = root.querySelector("[data-add-image-field]");
  const imageFiles = root.querySelector("[data-overlay-image-files]");
  const removeCustomField = root.querySelector("[data-remove-custom-field]");
  const inputs = {
    visible: root.querySelector("[data-field-visible]"),
    x: root.querySelector("[data-field-x]"),
    y: root.querySelector("[data-field-y]"),
    width: root.querySelector("[data-field-width]"),
    height: root.querySelector("[data-field-height]"),
    fontSize: root.querySelector("[data-field-font-size]"),
    color: root.querySelector("[data-field-color]"),
    align: root.querySelector("[data-field-align]"),
    fontWeight: root.querySelector("[data-field-weight]"),
    text: root.querySelector("[data-field-text]"),
    headerText: root.querySelector("[data-designer-header-text]"),
    conventionText: root.querySelector("[data-designer-convention-text]")
  };
  let designer = JSON.parse(jsonInput.value || "{}");
  let selectedKey = designer.fields?.[0]?.key || "";
  const localImageUrls = new Map();
  const byKey = (key) => designer.fields.find((field) => field.key === key);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  function selected() { return byKey(selectedKey) || designer.fields[0]; }
  function fieldNode(key) { return canvas.querySelector('[data-designer-field="' + CSS.escape(key) + '"]'); }
  function isCustomTextField(field) { return Boolean(field?.isCustomText); }
  function isCustomImageField(field) { return Boolean(field?.isCustomImage); }
  function isCustomField(field) { return isCustomTextField(field) || isCustomImageField(field); }
  function addOption(field) {
    const option = document.createElement("option");
    option.value = field.key;
    option.textContent = field.label;
    select.append(option);
  }
  function appendFieldNode(field) {
    const node = document.createElement("div");
    node.className = "certificate-designer-field align-center";
    node.dataset.designerField = field.key;
    canvas.append(node);
    applyField(field);
  }
  function fitTextToField(field, node) {
    if (node.querySelector("img, svg")) return;
    const maximum = Number(field.fontSize) || 12;
    let size = maximum;
    node.style.fontSize = size + "px";
    while ((node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight) && size > 6) {
      size = Math.max(6, size - 0.5);
      node.style.fontSize = size + "px";
    }
  }
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
    if (isCustomImageField(field)) {
      const imageUrl = localImageUrls.get(field.key) || field.imageUrl;
      node.replaceChildren();
      if (imageUrl) {
        const image = document.createElement("img");
        image.src = imageUrl;
        image.alt = field.label;
        node.append(image);
      } else {
        node.textContent = field.label;
      }
    } else if (field.editableText) {
      node.textContent = field.text || field.label;
    }
    fitTextToField(field, node);
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
    customTextPanel.hidden = !isCustomTextField(field);
    inputs.text.value = isCustomTextField(field) ? field.text || "" : "";
    removeCustomField.disabled = !isCustomField(field);
    inputs.headerText.value = byKey("header")?.text || "";
    inputs.conventionText.value = byKey("convention")?.text || "";
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
  function updateStaticText() {
    const header = byKey("header");
    const convention = byKey("convention");
    if (header) {
      header.text = inputs.headerText.value.slice(0, 500);
      header.visible = Boolean(header.text.trim());
    }
    if (convention) {
      convention.text = inputs.conventionText.value.slice(0, 500);
      convention.visible = Boolean(convention.text.trim());
    }
    for (const item of designer.fields) applyField(item);
    jsonInput.value = JSON.stringify(designer);
  }
  function updateCustomText() {
    const field = selected();
    if (!isCustomTextField(field)) return;
    field.text = inputs.text.value.slice(0, 500);
    field.visible = Boolean(field.text.trim());
    applyField(field);
    jsonInput.value = JSON.stringify(designer);
  }
  function nextCustomTextKey() {
    let index = 1;
    while (byKey("custom_text_" + index)) index += 1;
    return "custom_text_" + index;
  }
  function nextCustomImageKey() {
    let index = 1;
    while (byKey("custom_image_" + index)) index += 1;
    return "custom_image_" + index;
  }
  function removePendingImageFields() {
    for (const field of designer.fields.filter((item) => isCustomImageField(item) && Number.isInteger(item.pendingImageIndex))) {
      localImageUrls.delete(field.key);
      fieldNode(field.key)?.remove();
      select.querySelector('option[value="' + CSS.escape(field.key) + '"]')?.remove();
    }
    designer.fields = designer.fields.filter((item) => !(isCustomImageField(item) && Number.isInteger(item.pendingImageIndex)));
  }
  select.addEventListener("change", () => { selectedKey = select.value; syncPanel(); });
  const fieldStyleInputs = [
    inputs.visible,
    inputs.x,
    inputs.y,
    inputs.width,
    inputs.height,
    inputs.fontSize,
    inputs.color,
    inputs.align,
    inputs.fontWeight
  ];
  fieldStyleInputs.forEach((input) => input.addEventListener("input", updateFromPanel));
  fieldStyleInputs.forEach((input) => input.addEventListener("change", updateFromPanel));
  inputs.text.addEventListener("input", updateCustomText);
  inputs.headerText.addEventListener("input", updateStaticText);
  inputs.conventionText.addEventListener("input", updateStaticText);
  addTextField.addEventListener("click", () => {
    const number = designer.fields.filter(isCustomTextField).length + 1;
    const field = {
      key: nextCustomTextKey(),
      label: "Text field " + number,
      x: 18,
      y: Math.min(90, 20 + number * 6),
      width: 50,
      height: 6,
      fontSize: 18,
      color: "#0d1b2a",
      align: "center",
      fontWeight: "500",
      visible: true,
      editableText: true,
      isCustomText: true,
      text: "New text"
    };
    designer.fields.push(field);
    addOption(field);
    appendFieldNode(field);
    selectedKey = field.key;
    syncPanel();
    inputs.text.focus();
    inputs.text.select();
  });
  addImageField.addEventListener("click", () => imageFiles.click());
  imageFiles.addEventListener("change", () => {
    const files = [...imageFiles.files];
    if (!files.length) return;
    removePendingImageFields();
    files.forEach((file, index) => {
      const number = designer.fields.filter(isCustomImageField).length + 1;
      const field = {
        key: nextCustomImageKey(),
        label: file.name.replace(/\\.[^.]+$/, "") || "Image " + number,
        x: 20,
        y: Math.min(86, 20 + index * 5),
        width: 20,
        height: 20,
        fontSize: 12,
        color: "#0d1b2a",
        align: "center",
        fontWeight: "500",
        visible: true,
        isCustomImage: true,
        imageUrl: "",
        pendingImageIndex: index
      };
      localImageUrls.set(field.key, URL.createObjectURL(file));
      designer.fields.push(field);
      addOption(field);
      appendFieldNode(field);
      selectedKey = field.key;
    });
    syncPanel();
  });
  removeCustomField.addEventListener("click", () => {
    const field = selected();
    if (!isCustomField(field)) return;
    localImageUrls.delete(field.key);
    designer.fields = designer.fields.filter((item) => item.key !== field.key);
    fieldNode(field.key)?.remove();
    select.querySelector('option[value="' + CSS.escape(field.key) + '"]')?.remove();
    selectedKey = designer.fields[0]?.key || "";
    syncPanel();
  });
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
    const startWidth = field.width;
    const startHeight = field.height;
    const startFontSize = field.fontSize;
    const resizeZone = 18;
    const isResizing =
      node.classList.contains("is-selected") &&
      event.clientX >= rect.right - resizeZone &&
      event.clientY >= rect.bottom - resizeZone;
    node.setPointerCapture(event.pointerId);
    syncPanel();
    const move = (moveEvent) => {
      if (isResizing) {
        field.width = clamp(startWidth + ((moveEvent.clientX - startX) / rect.width) * 100, 2, 100 - startLeft);
        field.height = clamp(startHeight + ((moveEvent.clientY - startY) / rect.height) * 100, 2, 100 - startTop);
        const scale = Math.min(field.width / startWidth, field.height / startHeight);
        field.fontSize = clamp(startFontSize * scale, 6, 96);
      } else {
        field.x = clamp(startLeft + ((moveEvent.clientX - startX) / rect.width) * 100, 0, 98);
        field.y = clamp(startTop + ((moveEvent.clientY - startY) / rect.height) * 100, 0, 98);
      }
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

function renderedCertificateCanvasSize(html = "") {
  const width = Number(htmlAttributeValue(html, "data-page-width"));
  const height = Number(htmlAttributeValue(html, "data-page-height"));
  if (Number.isFinite(width) && Number.isFinite(height) && width >= 100 && height >= 100) {
    return { width, height };
  }
  return { width: 1123, height: 794 };
}

function renderedCertificatePdfPageSize(html = "") {
  const canvas = renderedCertificateCanvasSize(html);
  const ratio = canvas.width / canvas.height;
  const longSide = 841.89;
  const shortSide = 595.28;
  if (ratio >= 1) return [longSide, longSide / ratio];
  return [shortSide, shortSide / ratio];
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
  const { x: pageX, y: pageY, width: pageWidth, height: pageHeight } = page.getCropBox();
  const canvas = renderedCertificateCanvasSize(html);
  const fontScale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);

  const fieldPattern = /<div class="visual-cert-field[^"]*" style="([^"]+)">([\s\S]*?)<\/div>/g;
  for (const match of html.matchAll(fieldPattern)) {
    const style = match[1];
    const content = match[2];
    const x = pageX + (styleNumber(style, "left") / 100) * pageWidth;
    const top = (styleNumber(style, "top") / 100) * pageHeight;
    const width = (styleNumber(style, "width", 10) / 100) * pageWidth;
    const height = (styleNumber(style, "height", 5) / 100) * pageHeight;
    const y = pageY + pageHeight - top - height;
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
    const doc = new PDFDocument({ size: renderedCertificatePdfPageSize(html), margin: 0 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolvePdf(Buffer.concat(chunks)));
    doc.on("error", rejectPdf);

    const regularFont = "C:/Windows/Fonts/arial.ttf";
    const boldFont = "C:/Windows/Fonts/arialbd.ttf";
    if (existsSync(regularFont)) doc.font(regularFont);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const canvas = renderedCertificateCanvasSize(html);
    const fontScale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
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
      const fontSize = styleNumber(style, "font-size", 12) * fontScale;
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
    feedback_message: {
      subject: "New feedback message",
      body: "Marine LMS\n\nA message was sent from the website footer.\n\n{{payload}}\n\nDate: {{date}}"
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
      body: "Marine LMS\n\nUse this one-time link within 30 minutes to choose a new password:\n{{payload}}\n\nIf you did not request this, you can ignore this email."
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
    },
    invoice_sent: {
      subject: "Marine LMS invoice",
      body: "Marine LMS\n\nYour invoice is ready.\n\n{{payload}}"
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
    type: note.type || ""
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
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"]?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return request.socket.remoteAddress || "unknown";
}

function publicOrigin(request) {
  try {
    if (process.env.PUBLIC_BASE_URL) return new URL(publicBaseUrl).origin;
  } catch {
    // Fall back to the incoming host in local development.
  }
  const proto = trustProxy ? request.headers["x-forwarded-proto"] || "http" : "http";
  return `${proto}://${request.headers.host}`;
}

function sameOriginPost(request) {
  const expected = publicOrigin(request);
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
  return Boolean(origin);
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

function passwordResetRateLimited(request, email) {
  const key = `${clientIp(request)}:${String(email).toLowerCase()}`;
  const windowMs = 15 * 60 * 1000;
  const limit = 5;
  const current = Date.now();
  const recent = (passwordResetAttempts.get(key) ?? []).filter((timestamp) => current - timestamp < windowMs);
  recent.push(current);
  passwordResetAttempts.set(key, recent);
  return recent.length > limit;
}

function sessionCookie(value, maxAge = Math.floor(sessionTtlMs / 1000)) {
  const secure = publicBaseUrl.startsWith("https://") ? "; Secure" : "";
  return `sid=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function invalidateUserSessions(user) {
  user.authVersion = (Number(user.authVersion) || 1) + 1;
  db.sessions = (db.sessions ?? []).filter((session) => session.userId !== user.id);
  csrfTokens.delete(user.id);
}

function createPasswordResetToken(user) {
  const token = opaqueToken();
  db.passwordResetTokens = (db.passwordResetTokens ?? []).filter((item) => item.userId !== user.id);
  db.passwordResetTokens.push({
    id: id("reset"), tokenHash: hashSecret(token), userId: user.id,
    expiresAt: new Date(Date.now() + passwordResetTtlMs).toISOString(), usedAt: "", createdAt: now()
  });
  return token;
}

async function sendPasswordRecovery(user, token) {
  const note = {
    id: id("note"), recipientUserId: user.id, recipientEmail: user.email, type: "password_recovery",
    status: notificationInitialStatus(), payload: `${publicBaseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`,
    createdAt: now(), sentAt: ""
  };
  await deliverNotification(note);
  note.payload = "Password reset link requested.";
  db.notifications.push(note);
}

function currentUser(request) {
  const sessionId = getCookie(request, "sid");
  if (!sessionId) return null;
  const session = (db.sessions ?? []).find((item) => item.tokenHash === hashSecret(sessionId));
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  const user = db.users.find((item) => item.id === session.userId && item.status === "active");
  return user && session.authVersion === user.authVersion ? user : null;
}

function pruneExpiredAuthRecords() {
  const current = Date.now();
  const sessionsBefore = (db.sessions ?? []).length;
  const resetsBefore = (db.passwordResetTokens ?? []).length;
  db.sessions = (db.sessions ?? []).filter((session) => new Date(session.expiresAt).getTime() > current);
  db.passwordResetTokens = (db.passwordResetTokens ?? []).filter((token) => token.usedAt || new Date(token.expiresAt).getTime() > current);
  return sessionsBefore !== db.sessions.length || resetsBefore !== db.passwordResetTokens.length;
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
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) {
    const error = new Error("Request body is too large.");
    error.statusCode = 413;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBodyBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
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
  // Keep the same repeated-field contract as URLSearchParams/FormData.
  form.getAll = (name) => {
    const value = form.get(name);
    return value === undefined ? [] : (Array.isArray(value) ? value : [value]);
  };
  const append = (name, value) => {
    const current = form.get(name);
    if (current === undefined) form.set(name, value);
    else if (Array.isArray(current)) current.push(value);
    else form.set(name, [current, value]);
  };
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
      append(name, {
        filename,
        contentType: contentTypeHeader,
        buffer: Buffer.from(content, "binary")
      });
    } else {
      append(name, Buffer.from(content, "binary").toString("utf8"));
    }
  }
  return form;
}

function send(response, body, status = 200, headers = {}) {
  const nonce = randomBytes(18).toString("base64url");
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...responseSecurityHeaders(nonce),
    ...headers
  });
  response.end(String(body).replaceAll("{{CSP_NONCE}}", nonce));
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...responseSecurityHeaders()
  });
  response.end(JSON.stringify(body));
}

function redirect(response, location) {
  response.writeHead(303, { Location: location, ...responseSecurityHeaders() });
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

function fileStartsWith(buffer, bytes) {
  return Buffer.isBuffer(buffer) && buffer.length >= bytes.length && bytes.every((value, index) => buffer[index] === value);
}

function detectedImageExtension(file) {
  const buffer = file?.buffer;
  if (fileStartsWith(buffer, [0xff, 0xd8, 0xff])) return ".jpg";
  if (fileStartsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ".png";
  if (fileStartsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return ".gif";
  if (Buffer.isBuffer(buffer) && buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  return "";
}

function isPdfFile(file) {
  return fileStartsWith(file?.buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]);
}

function isVideoFileUpload(file) {
  const buffer = file?.buffer;
  return (Buffer.isBuffer(buffer) && buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") || fileStartsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
}

function isPlainTextFile(file) {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.includes(0)) return false;
  return /\.txt$/i.test(file.filename || "");
}

function materialUploadAllowed(file) {
  if (detectedImageExtension(file)) return true;
  if (isPdfFile(file) || isVideoFileUpload(file)) return true;
  return isPlainTextFile(file);
}

function uploadFromFormFile(file, prefix = "material") {
  if (!file || typeof file === "string" || !file.buffer?.length) return "";
  if (!materialUploadAllowed(file)) return "";
  if (file.buffer.length > uploadLimitForFile(file)) return "";
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  const requestedExt = extname(file.filename || "").toLowerCase();
  const ext = detectedImageExtension(file)
    || (isPdfFile(file) ? ".pdf" : "")
    || (isVideoFileUpload(file) && [".mp4", ".m4v", ".mov", ".webm"].includes(requestedExt) ? requestedExt : "")
    || (isPlainTextFile(file) ? ".txt" : "");
  if (!ext) return "";
  const storedName = `${prefix}_${randomUUID().slice(0, 10)}${ext}`;
  writeFileSync(resolve(uploadsDir, storedName), file.buffer);
  return `/uploads/${storedName}`;
}

function imageUploadAllowed(file) {
  return Boolean(detectedImageExtension(file));
}

function imageExtension(file) {
  return detectedImageExtension(file) || ".jpg";
}

function saveCourseImage(course, image) {
  if (!image || typeof image === "string" || !image.buffer?.length) return { ok: true, skipped: true };
  if (!imageUploadAllowed(image)) {
    return { ok: false, message: "Upload a course image in JPG, PNG, WebP, or GIF format." };
  }
  if (image.buffer.length > maxCourseImageUploadBytes) {
    return { ok: false, message: `The cover image is too large. Maximum size: ${Math.round(maxCourseImageUploadBytes / 1024 / 1024)} MB.` };
  }

  mkdirSync(uploadsDir, { recursive: true });
  const fileName = `course_${course.id}-${Date.now()}${imageExtension(image)}`;
  writeFileSync(resolve(uploadsDir, fileName), image.buffer);
  course.imageUrl = `/uploads/${fileName}`;
  return { ok: true, imageUrl: course.imageUrl };
}

function saveCertificatePhoto(user, photo) {
  if (!photo?.buffer?.length || !imageUploadAllowed(photo)) {
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

function comparableUploadPath(value = "") {
  try {
    return decodeURIComponent(String(value).split(/[?#]/)[0]);
  } catch {
    return "";
  }
}

function certificateUploadPaths(certificate) {
  const paths = new Set([certificate.snapshotPhotoUrl]);
  const html = `${certificate.snapshotCertificateTemplateHtml ?? ""}\n${certificate.certificateHtml ?? ""}`;
  for (const match of html.matchAll(/\/uploads\/[^\s"'<>?#]+(?:%[0-9a-f]{2}|[^\s"'<>?#])*/gi)) {
    paths.add(match[0]);
  }
  return [...paths].map(comparableUploadPath);
}

function canAccessUpload(user, fileName) {
  const requestedPath = comparableUploadPath(`/uploads/${fileName}`);
  if (!requestedPath) return false;
  if (isPublicCourseImagePath(fileName)) return true;
  if (!user) return false;
  if (isFullAdmin(user)) return true;
  if (canEditStudents(user) && db.users.some((student) => comparableUploadPath(student.photoUrl) === requestedPath)) return true;
  if (comparableUploadPath(user.photoUrl) === requestedPath) return true;

  const assignedCourseIds = new Set((db.assignments ?? []).filter((assignment) => assignment.userId === user.id).map((assignment) => assignment.courseId));
  const hasAssignedMaterial = db.courses.some(
    (course) => assignedCourseIds.has(course.id) && course.lessons?.some((lesson) => lesson.materials?.some((material) => comparableUploadPath(material.content) === requestedPath))
  );
  if (hasAssignedMaterial) return true;

  return (db.certificates ?? []).some(
    (certificate) => certificate.userId === user.id && certificateUploadPaths(certificate).includes(requestedPath)
  );
}

function serveUpload(request, response, user, fileName) {
  if (!canAccessUpload(user, fileName)) {
    response.writeHead(403, { ...responseSecurityHeaders(), "Cache-Control": "no-store" });
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
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    });
    createReadStream(path, { start, end }).pipe(response);
    return true;
  }

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stats.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff"
  });
  createReadStream(path).pipe(response);
  return true;
}

function servePublicAsset(response, fileName) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(fileName).replace(/^[/\\]+/, "");
  } catch {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const path = resolve(publicAssetsDir, decoded);
  const assetRelativePath = relative(publicAssetsDir, path);
  if (assetRelativePath.startsWith("..") || isAbsolute(assetRelativePath) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentTypeFor(path),
    "Content-Length": statSync(path).size,
    "Cache-Control": "public, max-age=604800, immutable",
    "X-Content-Type-Options": "nosniff"
  });
  createReadStream(path).pipe(response);
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
    send(response, page("Access denied", user, `<main class="page"><div class="notice">The admin panel is available only to administrators and instructors.</div></main>`), 403);
    return null;
  }
  return user;
}

function courseById(courseId) {
  return db.courses.find((course) => course.id === courseId);
}

function courseDeletionUsage(courseId) {
  return {
    assignments: (db.assignments ?? []).filter((assignment) => assignment.courseId === courseId).length,
    applications: (db.applications ?? []).filter((application) => application.courseId === courseId).length,
    certificates: (db.certificates ?? []).filter((certificate) => certificate.courseId === courseId).length
  };
}

function courseDeletionBlocked(usage) {
  return usage.assignments > 0 || usage.applications > 0 || usage.certificates > 0;
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
  if (!content) return `<p class="muted">Material has not been added yet.</p>`;
  if (content.startsWith("/uploads/")) {
    const safeContent = escapeHtml(content);
    const extension = extname(content).toLowerCase();
    const title = escapeHtml(material.title || "Course material");

    if (material.type === "video" || isVideoFile(content)) {
      return `<div class="material-player"><video controls playsinline preload="metadata" aria-label="${title}"><source src="${safeContent}" />Your browser does not support video playback.</video></div>`;
    }
    if (material.type === "pdf" || extension === ".pdf") {
      return `<iframe class="material-pdf" src="${safeContent}#toolbar=1&navpanes=0" title="${title}"></iframe>`;
    }
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) {
      return `<img class="material-image" src="${safeContent}" alt="${title}" loading="lazy" />`;
    }
    return `<p><a class="small-button primary" href="${safeContent}" download>Download file</a></p>`;
  }
  if (/^https?:\/\//i.test(content)) {
    return `<p><a class="link-line" href="${escapeHtml(content)}" target="_blank" rel="noopener">Open external material</a></p>`;
  }
  return `<div class="material-text">${escapeHtml(content).replaceAll("\n", "<br />")}</div>`;
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
  return db.courses.some((course) => course.status === "active" && course.imageUrl === normalized);
}

function courseHomeSortValue(course) {
  const value = Number(course?.homeSortOrder);
  return Number.isFinite(value) && value > 0 ? value : 999;
}

const courseCategories = ["Safety", "Soft Skills", "Navigation", "Engineering", "Environment", "Cargo operations"];
const coursePositions = ["Master", "Chief Mate", "Engine Officer", "Deck Officer", "All Seafarers", "Chief Eng", "2nd Mate", "Electro-technical Officer", "Catering", "ETO"];

function courseCatalogMetadata(course) {
  const catalog = course?.source?.catalog;
  return catalog && typeof catalog === "object" && !Array.isArray(catalog) ? catalog : {};
}

function courseCategory(course) {
  const category = courseCatalogMetadata(course).category;
  return courseCategories.includes(category) ? category : "";
}

function coursePositionsFor(course) {
  const positions = courseCatalogMetadata(course).positions;
  return Array.isArray(positions) ? positions.filter((position) => coursePositions.includes(position)) : [];
}

function updateCourseCatalogMetadata(course, { category = "", positions = [] }) {
  course.source = {
    ...(course.source && typeof course.source === "object" ? course.source : {}),
    catalog: {
      category: courseCategories.includes(category) ? category : "",
      positions: [...new Set(positions.filter((position) => coursePositions.includes(position)))]
    }
  };
}

function courseCatalogFields(course) {
  const category = courseCategory(course);
  const positions = new Set(coursePositionsFor(course));
  return `<div class="admin-edit-grid">
    <div class="field"><label>Category</label><select name="catalogCategory"><option value="">Not selected</option>${courseCategories.map((item) => `<option value="${escapeHtml(item)}" ${category === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></div>
  </div>
  <fieldset class="course-audience-fields"><legend>Suitable positions</legend><div class="course-audience-options">${coursePositions.map((position) => `<label class="checkbox-row"><input name="catalogPositions" type="checkbox" value="${escapeHtml(position)}" ${positions.has(position) ? "checked" : ""} /> ${escapeHtml(position)}</label>`).join("")}</div></fieldset>`;
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

function homeFooterSettings() {
  const saved = db.settings?.homeFooter;
  return {
    policiesTitle: String(saved?.policiesTitle ?? "Policies"),
    termsLabel: String(saved?.termsLabel ?? "Terms & Conditions"),
    termsUrl: String(saved?.termsUrl ?? "/terms"),
    termsContent: String(saved?.termsContent ?? "The terms and conditions for using this platform will be published here."),
    privacyLabel: String(saved?.privacyLabel ?? "Privacy"),
    privacyUrl: String(saved?.privacyUrl ?? "/privacy"),
    privacyContent: String(saved?.privacyContent ?? "The privacy policy for this platform will be published here."),
    userPolicyLabel: String(saved?.userPolicyLabel ?? "User Policy"),
    userPolicyUrl: String(saved?.userPolicyUrl ?? "/user-policy"),
    userPolicyContent: String(saved?.userPolicyContent ?? "The user policy for this platform will be published here."),
    feedbackTitle: String(saved?.feedbackTitle ?? "For any queries please use provided feedback form"),
    namePlaceholder: String(saved?.namePlaceholder ?? "Your Name"),
    emailPlaceholder: String(saved?.emailPlaceholder ?? "my.email@site.com"),
    subjectPlaceholder: String(saved?.subjectPlaceholder ?? "Subject"),
    messagePlaceholder: String(saved?.messagePlaceholder ?? "Your message"),
    submitLabel: String(saved?.submitLabel ?? "Send message")
  };
}

function safeFooterUrl(value) {
  const url = String(value ?? "").trim();
  return url.startsWith("/") || /^https?:\/\//i.test(url) ? url : "#";
}

function homeFooter(feedbackSent = false) {
  const settings = homeFooterSettings();
  return `<footer class="home-footer">
    <div class="home-footer-inner">
      <section class="home-footer-policies"><h2>${escapeHtml(settings.policiesTitle)}</h2><nav aria-label="Policies"><a href="${escapeHtml(safeFooterUrl(settings.termsUrl))}">${escapeHtml(settings.termsLabel)}</a><a href="${escapeHtml(safeFooterUrl(settings.privacyUrl))}">${escapeHtml(settings.privacyLabel)}</a><a href="${escapeHtml(safeFooterUrl(settings.userPolicyUrl))}">${escapeHtml(settings.userPolicyLabel)}</a></nav></section>
      <section class="home-footer-feedback"><h2>${escapeHtml(settings.feedbackTitle)}</h2>${feedbackSent ? `<p class="home-footer-success">Thank you. Your message has been sent.</p>` : ""}<form method="post" action="/feedback" class="home-feedback-form"><input name="name" placeholder="${escapeHtml(settings.namePlaceholder)}" required /><input name="email" type="email" placeholder="${escapeHtml(settings.emailPlaceholder)}" required /><input name="subject" placeholder="${escapeHtml(settings.subjectPlaceholder)}" required /><textarea name="message" placeholder="${escapeHtml(settings.messagePlaceholder)}" required></textarea><button class="button" type="submit">${escapeHtml(settings.submitLabel)}</button></form></section>
    </div>
  </footer>`;
}

function coursePublicUrl(course) {
  return `/courses/${encodeURIComponent(course.id)}`;
}

function normalizeCoursePrice(value) {
  const text = (value ?? "").toString().trim();
  if (!text) return "";
  const amount = text.match(/\d[\d\s]*(?:[.,]\d+)?/)?.[0]?.trim();
  return amount ? `${amount} USD` : "";
}

function coursePriceHtml(course, options = {}) {
  if (options.public && !SHOW_PUBLIC_COURSE_PRICES) return "";
  const oldPrice = normalizeCoursePrice(course.oldPrice);
  const newPrice = normalizeCoursePrice(course.newPrice);
  if (!oldPrice && !newPrice) {
    return options.showEmpty ? `<div class="course-price empty">Price not set</div>` : "";
  }
  return `<div class="course-price">
    ${oldPrice ? `<span class="course-price-old">${escapeHtml(oldPrice)}</span>` : ""}
    ${newPrice ? `<span class="course-price-new">${escapeHtml(newPrice)}</span>` : ""}
  </div>`;
}

function courseTimingText(course) {
  const test = course.test;
  const testTime = test?.timeLimitMinutes ? `${test.timeLimitMinutes} min test limit` : "no test time limit";
  return `${course.lessons?.length ?? 0} lessons, ${requiredMaterials(course).length} required materials, ${testTime}`;
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
            <span class="eyebrow">Course</span>
            <h1>${escapeHtml(course.title)}</h1>
            ${coursePriceHtml(course, { public: true })}
            <p class="lead">${escapeHtml(course.fullDescription || course.shortDescription)}</p>
            <div class="actions">
              <a class="button" href="/apply?courseId=${encodeURIComponent(course.id)}">Apply now</a>
              <a class="button secondary" href="/courses">All courses</a>
            </div>
          </div>
          ${course.imageUrl ? `<img class="course-public-cover" src="${escapeHtml(course.imageUrl)}" alt="${escapeHtml(course.title)}" />` : courseCoverHtml(course)}
        </div>
        <div class="course-meta-grid">
          <article class="metric"><span class="muted">Lessons</span><strong class="metric-value">${lessons.length}</strong></article>
          <article class="metric"><span class="muted">Materials</span><strong class="metric-value">${materialsCount}</strong><span class="muted">${requiredCount} required</span></article>
          <article class="metric"><span class="muted">Test</span><strong class="metric-value">${test?.questions?.length ?? 0}</strong><span class="muted">pass mark ${test?.passingPercent ?? 0}%</span></article>
          <article class="metric"><span class="muted">Timing</span><strong class="metric-value">${test?.timeLimitMinutes ? `${test.timeLimitMinutes} min` : "No limit"}</strong><span class="muted">final test</span></article>
        </div>
        <div class="grid two">
          <article class="panel stack">
            <h2>About this course</h2>
            <p>${escapeHtml(course.shortDescription || course.fullDescription || "")}</p>
            ${course.goals ? `<div><h3>Learning objectives</h3><p class="muted">${escapeHtml(course.goals)}</p></div>` : ""}
            ${course.requirements ? `<div><h3>Requirements</h3><p class="muted">${escapeHtml(course.requirements)}</p></div>` : ""}
          </article>
          <article class="panel stack">
            <h2>How learning works</h2>
            <p class="muted">${escapeHtml(courseTimingText(course))}.</p>
            <p class="muted">Learning materials become available in your account after an administrator assigns the course.</p>
            <p class="muted">After a successful test, the system issues a certificate when the student has uploaded a photo.</p>
          </article>
        </div>
        <article class="panel stack">
          <h2>Course contents</h2>
          <div class="course-outline">
            ${lessons
              .map((lesson) => `<div class="course-outline-item">
                <strong>${escapeHtml(lesson.title)}</strong>
                ${lesson.description ? `<p class="muted">${escapeHtml(lesson.description)}</p>` : ""}
                <ul class="course-material-list">
                  ${(lesson.materials ?? [])
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((material) => `<li>${escapeHtml(material.title)} · ${escapeHtml(material.type)}${material.isRequired ? " · required" : ""}</li>`)
                    .join("") || `<li>Materials will be added later</li>`}
                </ul>
              </div>`)
              .join("") || `<div class="notice">The course structure has not been added yet.</div>`}
          </div>
        </article>
      </section>
    </main>`
  );
}

function publicCourseCard(course) {
  return `<article class="card">
    ${courseCoverHtml(course)}
    <h3>${escapeHtml(course.title)}</h3>
    ${coursePriceHtml(course, { public: true })}
    <div class="table-actions">
      <a class="small-button primary" href="${coursePublicUrl(course)}">Details</a>
      <a class="small-button" href="/apply?courseId=${encodeURIComponent(course.id)}">Apply</a>
    </div>
  </article>`;
}

function publicCoursesCatalog(user, searchParams = new URLSearchParams()) {
  const params = listParams(searchParams);
  const sort = searchParams.get("sort") === "title_desc" ? "title_desc" : "title_asc";
  const category = courseCategories.includes(searchParams.get("category")) ? searchParams.get("category") : "";
  const position = coursePositions.includes(searchParams.get("position")) ? searchParams.get("position") : "";
  const catalogParams = { ...params, sort, category, position, perPage: Math.min(24, Math.max(6, params.perPage)) };
  const allActiveCourses = db.courses.filter((course) => course.status === "active");
  const activeCourses = allActiveCourses
    .filter((course) =>
      matchesQuery([course.title, course.shortDescription, course.fullDescription, course.goals, course.requirements, course.oldPrice, course.newPrice], params.q)
    )
    .filter((course) => !category || courseCategory(course) === category)
    .filter((course) => !position || coursePositionsFor(course).includes(position) || (position !== "All Seafarers" && coursePositionsFor(course).includes("All Seafarers")))
    .sort((a, b) => (sort === "title_desc" ? -1 : 1) * a.title.localeCompare(b.title, "ru"));
  const pagination = paginateItems(activeCourses, catalogParams);
  return page(
    "All courses",
    user,
    `<main class="page">
      <section class="section">
        <div class="section-heading">
          <div><span class="eyebrow">Catalogue</span><h1>All courses</h1><p class="lead">A complete list of active programmes. Open a course to view its details and submit an application.</p></div>
          <a class="button secondary" href="/">Home</a>
        </div>
        <form class="inline-form" method="get" action="/courses">
          <input name="q" value="${escapeHtml(params.q)}" placeholder="Search by title or description" />
          <label class="field"><span>Suitable for</span><select name="position"><option value="">All positions</option>${coursePositions.map((item) => `<option value="${escapeHtml(item)}" ${position === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></label>
          <label class="field"><span>Category</span><select name="category"><option value="">All categories</option>${courseCategories.map((item) => `<option value="${escapeHtml(item)}" ${category === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></label>
          <label class="field"><span>Sort</span><select name="sort"><option value="title_asc" ${sort === "title_asc" ? "selected" : ""}>Title: A-Z</option><option value="title_desc" ${sort === "title_desc" ? "selected" : ""}>Title: Z-A</option></select></label>
          <button class="small-button primary" type="submit">Apply filters</button>
          <a class="small-button" href="/courses">Reset</a>
        </form>
        <div class="grid three">
          ${pagination.items.map(publicCourseCard).join("") || `<article class="card"><h3>No courses found</h3><p class="muted">Try changing your search criteria.</p></article>`}
        </div>
        ${paginationControls("/courses", { ...catalogParams, paginationLabel: "Courses" }, pagination)}
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
  return `<span class="badge ${found ? "success" : "warning"}">${found ? "Found" : "Not found"}</span>`;
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
  return matchesQuery([item.relativePath, item.publicPath, item.usedAsPhoto ? "photo" : "", item.isVideo ? "video" : ""], query);
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
      <label>Option ${index}${index > 2 ? " - optional" : ""}</label>
      <input name="option${index}" value="${escapeHtml(option?.optionText ?? "")}" ${index <= 2 ? "required" : ""} />
      <input type="hidden" name="optionId${index}" value="${escapeHtml(option?.id ?? "")}" />
    </div>`);
  }
  return `${fields.join("")}
    <div class="field"><label>Correct answer</label><select name="correct">${Array.from({ length: 6 }, (_, itemIndex) => {
      const value = itemIndex + 1;
      return `<option value="${value}" ${correctIndex === value ? "selected" : ""}>Option ${value}</option>`;
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
  if (params.sort) base.set("sort", params.sort);
  if (params.category) base.set("category", params.category);
  if (params.position) base.set("position", params.position);
  base.set("perPage", String(params.perPage));
  const link = (page, label) => {
    const next = new URLSearchParams(base);
    next.set("page", String(page));
    return `<a class="small-button" href="${pathname}?${next.toString()}">${label}</a>`;
  };
  const pageNumbers = new Set([1, pagination.totalPages]);
  const paginationLabel = params.paginationLabel ?? "Records";
  for (let page = pagination.page - 2; page <= pagination.page + 2; page += 1) {
    if (page > 0 && page <= pagination.totalPages) pageNumbers.add(page);
  }
  const numbers = [...pageNumbers].sort((a, b) => a - b);
  const numberLinks = [];
  for (const [index, page] of numbers.entries()) {
    const previous = numbers[index - 1];
    if (previous && page - previous > 1) numberLinks.push(`<span class="pagination-gap" aria-hidden="true">...</span>`);
    numberLinks.push(
      page === pagination.page
        ? `<span class="small-button pagination-current" aria-current="page">${page}</span>`
        : link(page, String(page))
    );
  }
  return `<nav class="pagination-controls" aria-label="List pages">
    <span class="pagination-summary">${escapeHtml(paginationLabel)}: page ${pagination.page} of ${pagination.totalPages}, ${pagination.total} total</span>
    <div class="pagination-links">
    ${pagination.page > 1 ? link(pagination.page - 1, "Previous") : ""}
    ${numberLinks.join("")}
    ${pagination.page < pagination.totalPages ? link(pagination.page + 1, "Next") : ""}
    </div>
  </nav>`;
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
  return `<div class="photo-warning"><strong>No certificate photo has been uploaded.</strong><br>To receive a certificate in the future, upload a photo in your account.</div>`;
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
    active: "Active",
    inactive: "Inactive",
    deleted: "Archived",
    new: "New",
    contacted: "Contacted",
    accepted: "Accepted",
    rejected: "Rejected",
    converted_to_user: "User created",
    not_started: "Not started",
    in_progress: "In progress",
    test_available: "Test available",
    test_failed: "Test failed",
    test_passed: "Test passed",
    completed: "Completed",
    issued: "Issued",
    revoked: "Revoked",
    reissued: "Reissued",
    pending_photo: "Awaiting photo",
    queued: "Queued",
    logged: "Logged",
    sent: "Sent",
    failed: "Failed"
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
    admin: "Administrator",
    instructor: "Instructor",
    student: "Student"
  };
  return labels[role] ?? role;
}

function topNav(user) {
  return `<header class="topbar">
    <a class="brand" href="/" aria-label="Maritime Portal"><img class="brand-logo" src="/assets/brand/maritime-portal-logo.png" alt="Maritime Portal" /></a>
    <nav class="public-nav" aria-label="Main navigation">
      <a class="nav-link" href="/courses">Catalogue</a>
      <a class="nav-link" href="/blog">Blog</a>
      <a class="nav-link" href="/contacts">Contact</a>
    </nav>
    <div class="nav-account">
      ${user ? `<a class="nav-link" href="/dashboard">My account</a>` : ""}
      ${canAccessAdminPanel(user) ? `<a class="nav-link" href="/admin">Admin</a>` : ""}
      ${user ? `<form method="post" action="/logout"><button class="nav-link" type="submit">Sign out</button></form>` : `<a class="nav-link" href="/login">Sign in</a>`}
    </div>
  </header>`;
}

function page(title, user, body) {
  const content = injectCsrfTokens(user, `<div class="app-shell">
      ${topNav(user)}
      ${body}
    </div>`);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | Marine LMS</title>
    <style nonce="{{CSP_NONCE}}">${baseCss}${productCss}</style>
  </head>
  <body>
    ${content}
    <script nonce="{{CSP_NONCE}}">document.addEventListener("click", (event) => { if (event.target.closest("[data-print-certificate]")) window.print(); });</script>
  </body>
</html>`;
}

function adminShell(user, title, body) {
  const navLinks = isFullAdmin(user)
    ? `<a href="/admin">Dashboard</a>
          <a href="/admin/applications">Applications</a>
          <a href="/admin/users">Users</a>
          <a href="/admin/reports">Reports</a>
          <a href="/admin/checks">Invoices</a>
          <a href="/admin/tests">Tests</a>
          <a href="/admin/courses">Courses</a>
          <a href="/admin/course-prices">Prices</a>
          <a href="/admin/homepage">Home</a>
          <a href="/admin/files">Files</a>
          <a href="/admin/certificates">Certificates</a>
          <a href="/admin/notifications">Notifications</a>
          <a href="/admin/audit">Audit log</a>`
    : `<a href="/admin">Instructor panel</a>
          <a href="/admin/users">Users</a>`;
  return page(
    title,
    user,
    `<div class="split-layout">
      <aside class="sidebar">
        <span class="eyebrow">Administration</span>
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
        <span class="eyebrow">My account</span>
        <nav class="sidebar-nav">
          <a href="/dashboard">Overview</a>
          <a href="/dashboard/courses">My courses</a>
          <a href="/dashboard/tests">Completed tests</a>
          <a href="/dashboard/certificates">Certificates</a>
          <a href="/dashboard/profile">Profile</a>
        </nav>
      </aside>
      <main class="content">${photoNotice}${body}</main>
    </div>`
  );
}

function homePage(user, feedbackSent = false) {
  const visibleCourses = homepageCourses();
  return page(
    "Home",
    user,
    `<main class="home-page">
      <section class="hero">
        <div class="hero-scenes" aria-hidden="true">
          <span class="hero-scene hero-scene-bridge"></span>
          <span class="hero-scene hero-scene-vessel"></span>
          <span class="hero-scene hero-scene-safety"></span>
        </div>
        <div class="hero-copy">
          <span class="eyebrow">Marine training platform</span>
          <h1>Marine LMS for training, tests, and certificates</h1>
          <p class="lead">A private maritime learning platform where administrators create students, assign training, track progress, and issue certificates.</p>
          <div class="actions">
            <a class="button" href="/apply">Apply for a course</a>
            <a class="button secondary" href="${user ? "/dashboard" : "/login"}">Sign in</a>
          </div>
          <div class="hero-meta">
            <div class="hero-meta-item"><strong>Manual access</strong><span>no self-registration</span></div>
            <div class="hero-meta-item"><strong>Course control</strong><span>materials before the test</span></div>
            <div class="hero-meta-item"><strong>Certificates</strong><span>linked to the student and course</span></div>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="section-heading">
          <div><span class="eyebrow">Courses</span><h2>Available training programmes</h2></div>
          <div class="actions"><a class="button secondary" href="/courses">All courses</a><a class="button secondary" href="/apply">Apply now</a></div>
        </div>
        <div class="grid three">
          ${visibleCourses.length
            ? visibleCourses
            .map(publicCourseCard)
            .join("")
            : `<article class="card"><h3>Courses will be available soon</h3><p class="muted">An administrator has not selected courses for the home page yet.</p></article>`}
        </div>
      </section>
      ${homeFooter(feedbackSent)}
    </main>`
  );
}

function loginPage(user, notice = "") {
  if (user) return redirectPage("/dashboard");
  const message = notice === "login_required" ? `<div class="notice">Sign in to access the private part of the platform.</div>` : "";
  return page(
    "Sign in",
    null,
    `<main class="page">
      <section class="section">
        <div><span class="eyebrow">Private access</span><h1>Sign in to Marine LMS</h1><p class="lead">Self-registration is not available. Access is granted by an administrator after the application is processed.</p></div>
        ${message}
        <form class="form-panel" method="post" action="/login">
          <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" required /></div>
          <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" required /></div>
          <button class="button" type="submit">Sign in</button>
          <a class="link-line" href="/forgot-password">Reset password</a>
        </form>
      </section>
    </main>`
  );
}

const imoOfficialRssUrl = "https://www.imo.org/en/Pages/PressBriefingsRSS.aspx";
const imoPressBriefingsUrl = "https://www.imo.org/en/mediacentre/pressbriefings/default.aspx";
const imoArchiveUrls = [
  "https://www.imo.org/en/mediacentre/pressbriefings/pages/2025-archives.aspx?page=1",
  "https://www.imo.org/en/mediacentre/pressbriefings/pages/2025-archives.aspx?page=2"
];
const imoNewsCacheTtlMs = 15 * 60 * 1000;
const imoNewsFixturePath = process.env.IMO_NEWS_FIXTURE_PATH ?? "";

function imoNewsItemsFromPage(html) {
  const items = [];
  const pattern = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>[\s\S]*?<span[^>]*class="badge[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<h3[^>]*class="card-title"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*class="card-text"[^>]*>([\s\S]*?)<\/p>/gi;
  for (const match of html.matchAll(pattern)) {
    const imageUrl = new URL(match[1], imoPressBriefingsUrl).toString();
    const url = new URL(match[3], imoPressBriefingsUrl).toString();
    if (!imageUrl.startsWith("https://wwwcdn.imo.org/") || !url.startsWith("https://www.imo.org/")) continue;
    const title = decodeHtmlText(match[4]);
    if (!title) continue;
    items.push({ imageUrl, date: decodeHtmlText(match[2]), title, summary: decodeHtmlText(match[5]), url });
  }
  return items;
}

function latestImoNews(items) {
  const byUrl = new Map();
  for (const item of items) byUrl.set(item.url, item);
  return [...byUrl.values()]
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0, 20);
}

async function fetchImoNews() {
  if (imoNewsCache.items.length && Date.now() - imoNewsCache.fetchedAt < imoNewsCacheTtlMs) return imoNewsCache.items;
  try {
    if (imoNewsFixturePath) {
      const items = latestImoNews(imoNewsItemsFromPage(readFileSync(imoNewsFixturePath, "utf8")));
      if (!items.length) throw new Error("IMO fixture cards were not found");
      imoNewsCache = { items, fetchedAt: Date.now() };
      return items;
    }
    // IMO still publishes this official RSS URL, but it can temporarily return 404 after site updates.
    await fetch(imoOfficialRssUrl, { signal: AbortSignal.timeout(4000), headers: { "user-agent": "Marine-LMS/1.0" } }).catch(() => null);
    const responses = await Promise.allSettled(
      [imoPressBriefingsUrl, ...imoArchiveUrls].map(async (url) => {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Marine-LMS/1.0" } });
        if (!response.ok) throw new Error(`IMO response ${response.status}`);
        return imoNewsItemsFromPage(await response.text());
      })
    );
    const items = latestImoNews(responses.flatMap((response) => (response.status === "fulfilled" ? response.value : [])));
    if (!items.length) throw new Error("IMO news cards were not found");
    imoNewsCache = { items, fetchedAt: Date.now() };
  } catch {
    // Keep the last successful news set visible during a temporary IMO outage.
  }
  return imoNewsCache.items;
}

async function blogPage(user) {
  const items = await fetchImoNews();
  const cards = items
    .map((item) => `<article class="imo-news-card"><img class="imo-news-image" src="${escapeHtml(item.imageUrl)}" alt="" /><div class="imo-news-content"><div class="imo-news-meta">IMO Press Briefing · ${escapeHtml(item.date)}</div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.summary)}</p><a class="small-button primary" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Read on IMO</a></div></article>`)
    .join("");
  return page(
    "Blog",
    user,
    `<main class="page"><section class="section"><div class="section-heading"><div><span class="eyebrow">International Maritime Organization</span><h1>Maritime news</h1><p class="lead">Latest official IMO press briefings on shipping, safety, seafarers and the marine environment.</p></div><a class="button secondary" href="${imoPressBriefingsUrl}" target="_blank" rel="noopener noreferrer">IMO Press Briefings</a></div>${cards ? `<div class="imo-news-grid">${cards}</div>` : `<article class="panel"><p class="muted">Official IMO news is temporarily unavailable. Please try again shortly.</p></article>`}</section></main>`
  );
}

function contactsPage(user) {
  const email = process.env.SMTP_FROM || "info@maritimelearning.store";
  return page(
    "Contact",
    user,
    `<main class="page"><section class="section"><div class="section-heading"><div><span class="eyebrow">Contact</span><h1>Contact Marine LMS</h1><p class="lead">For training and course applications, use email or submit an application for the course you need.</p></div><a class="button" href="/apply">Apply now</a></div><article class="panel stack"><div><strong>Email</strong><br><a class="link-line" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></div></article></section></main>`
  );
}

function policyPage(user, title, content) {
  const paragraphs = String(content ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
  return page(
    title,
    user,
    `<main class="page"><section class="section"><div><span class="eyebrow">Policies</span><h1>${escapeHtml(title)}</h1></div><article class="panel stack policy-content">${paragraphs || "<p>Policy text has not been added yet.</p>"}</article><a class="button secondary" href="/">Back to home</a></section></main>`
  );
}

function forgotPasswordPage(user, success = false) {
  if (user) return redirectPage("/dashboard");
  return page(
    "Password recovery",
    null,
    `<main class="page">
      <section class="section">
        <div><span class="eyebrow">Access</span><h1>Password recovery</h1><p class="lead">If the email address exists in the system, LMS will send a one-time link to choose a new password.</p></div>
        ${success ? `<div class="notice">If this email address is registered, a recovery link has been sent.</div>` : ""}
        <form class="form-panel" method="post" action="/forgot-password">
          <div class="field"><label>E-mail</label><input name="email" type="email" required /></div>
          <button class="button" type="submit">Get link</button>
          <a class="small-button" href="/login">Back to sign in</a>
        </form>
      </section>
    </main>`
  );
}

function resetPasswordPage(token = "", error = "") {
  const message = error === "invalid" ? `<div class="notice danger">The link is invalid or has expired.</div>` : "";
  return page(
    "New password",
    null,
    `<main class="page"><section class="section"><div><span class="eyebrow">Access</span><h1>New password</h1><p class="lead">The link is valid for 30 minutes and can be used once.</p></div>
      ${message}
      <form class="form-panel" method="post" action="/reset-password">
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <div class="field"><label>New password</label><input name="password" type="password" minlength="12" autocomplete="new-password" required /></div>
        <button class="button" type="submit">Save password</button>
      </form>
    </section></main>`
  );
}

function redirectPage(location) {
  return `<html><head><meta http-equiv="refresh" content="0;url=${location}"></head></html>`;
}

function applyPage(user, success = false, selectedCourseId = "") {
  const activeCourses = db.courses.filter((course) => course.status === "active");
  const isStudentRequest = user?.role === "student";
  return page(
    "Application",
    user,
    `<main class="page">
      <section class="section">
        <div><span class="eyebrow">Course application</span><h1>Apply for a course</h1><p class="lead">${isStudentRequest ? "Your account details will be attached to the application. Select the course you need." : "Submitting an application does not create an account automatically. An administrator will contact the applicant and create the user manually."}</p></div>
        ${success ? `<div class="notice">Your application has been sent. An administrator will see it in the control panel.</div>` : ""}
        <form class="form-panel" method="post" action="/apply">
          ${isStudentRequest ? "" : `<div class="field"><label>Last name</label><input name="lastName" required /></div>
          <div class="field"><label>First name</label><input name="firstName" required /></div>
          <div class="field"><label>Phone number</label><input name="phone" required /></div>
          <div class="field"><label>E-mail</label><input name="email" type="email" required /></div>`}
          <div class="field"><label>Course</label><select name="courseId" required>${activeCourses.map((course) => `<option value="${course.id}" ${selectedCourseId === course.id ? "selected" : ""}>${escapeHtml(course.title)}</option>`).join("")}</select></div>
          <div class="field"><label>Comment</label><textarea name="comment"></textarea></div>
          <button class="button" type="submit">Send application</button>
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
      "Instructor panel",
      `<section class="section">
        <div class="section-heading">
          <div><span class="eyebrow">Instructor</span><h1>Training assignment</h1><p class="lead">An instructor can create a student, edit their details, upload a photo, and assign a course. Deletion, reports, and certificates are unavailable.</p></div>
          <div class="actions"><a class="button" href="/admin/users">Users</a></div>
        </div>
        <div class="grid three">
          <article class="metric"><span class="muted">Active students</span><strong class="metric-value">${students}</strong></article>
          <article class="metric"><span class="muted">Courses available to assign</span><strong class="metric-value">${activeCourses}</strong></article>
        </div>
      </section>`
    );
  }
  const activeStudents = db.users.filter((item) => item.role === "student" && item.status === "active").length;
  const activeCourses = db.courses.filter((course) => course.status === "active").length;
  const completed = db.assignments.filter((assignment) => assignment.status === "completed").length;
  const metrics = [
    ["New applications", db.applications.filter((item) => item.status === "new").length, "awaiting review"],
    ["Active students", activeStudents, "have access"],
    ["Active courses", activeCourses, "available to assign"],
    ["Completed courses", completed, "passed successfully"]
  ];
  return adminShell(
    user,
    "Admin panel",
    `<section class="section">
      <div class="section-heading">
        <div><span class="eyebrow">Learning management</span><h1>Admin dashboard</h1><p class="lead">The operations centre for applications, users, courses, tests, and certificates.</p></div>
        <div class="actions"><a class="button" href="/admin/users">Create user</a><a class="button secondary" href="/admin/courses">Courses</a></div>
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
    "Applications",
    `<section class="section">
      <div><span class="eyebrow">Applications</span><h1>Course applications</h1><p class="lead">An application is stored separately and does not create an account automatically.</p></div>
      <form class="inline-form" method="get" action="/admin/applications">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Search applications" />
        <button class="small-button primary" type="submit">Search</button>
      </form>
      <table class="table">
        <thead><tr><th>Applicant</th><th>Contact details</th><th>Course</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${pagination.items
          .map((application) => {
            const course = courseById(application.courseId);
            return `<tr>
              <td>${escapeHtml(application.lastName)} ${escapeHtml(application.firstName)}<br><span class="muted">${escapeHtml(application.comment)}</span></td>
              <td>${escapeHtml(application.email)}<br><span class="muted">${escapeHtml(application.phone)}</span></td>
              <td>${escapeHtml(course?.title ?? "Course deleted")}</td>
              <td>${badge(application.status)}</td>
              <td><div class="table-actions">
                <form method="post" action="/admin/applications/status" class="inline-form">
                  <input type="hidden" name="id" value="${application.id}" />
                  <select name="status">
                    ${["new", "contacted", "accepted", "rejected"].map((status) => `<option value="${status}" ${application.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
                  </select>
                  <button class="small-button" type="submit">Save</button>
                </form>
                <form method="post" action="/admin/applications/convert">
                  <input type="hidden" name="id" value="${application.id}" />
                  <button class="small-button primary" type="submit">Create user</button>
                </form>
              </div></td>
            </tr>`;
          })
          .join("") || `<tr><td colspan="5"><span class="muted">No applications found.</span></td></tr>`}</tbody>
      </table>
      ${paginationControls("/admin/applications", params, pagination)}
    </section>`
  );
}

function adminStudentCard(student, viewer = null) {
  const assignments = db.assignments.filter((assignment) => assignment.userId === student.id);
  const activeCourses = db.courses.filter((course) => course.status === "active");
  const toggleLabel = student.status === "active" ? "Deactivate" : "Activate";
  const photoLabel = hasCertificatePhoto(student) ? "Photo uploaded" : "No photo uploaded";
  const fullAdmin = isFullAdmin(viewer);
  const canAssign = canAssignCourses(viewer);
  const canEdit = canEditStudents(viewer);
  return `<article class="panel stack admin-user-card">
    <div class="admin-user-summary">
      <div>
        <span class="eyebrow">Student</span>
        <h2>${escapeHtml(student.firstNameEn)} ${escapeHtml(student.lastNameEn)}</h2>
        <p class="muted">${escapeHtml(student.email)}</p>
      </div>
      <div>${badge(student.status)}</div>
      <p><strong>Position:</strong> ${escapeHtml(student.position || "-")}</p>
      <p><strong>Company:</strong> ${escapeHtml(student.company || "-")}</p>
      <p class="muted">${photoLabel}</p>
      ${fullAdmin ? `<a class="small-button" href="/admin/users/${encodeURIComponent(student.id)}">Student profile</a>
      <a class="small-button primary" href="/admin/certificates?userId=${encodeURIComponent(student.id)}">Student certificates</a>` : ""}
      ${hasCertificatePhoto(student) ? `<img class="profile-photo" src="${escapeHtml(student.photoUrl)}" alt="Certificate photo" />` : `<div class="profile-photo"></div>`}
      ${canEdit ? `<form class="stack" method="post" action="/admin/users/photo" enctype="multipart/form-data">
        <input type="hidden" name="id" value="${student.id}" />
        <div class="field"><label>Certificate photo</label><input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required /></div>
        <button class="small-button primary" type="submit">Upload photo</button>
      </form>` : ""}
      ${fullAdmin ? `<div class="table-actions">
        <form method="post" action="/admin/users/toggle">
          <input type="hidden" name="id" value="${student.id}" />
          <button class="small-button" type="submit">${toggleLabel}</button>
        </form>
        <form method="post" action="/admin/users/delete">
          <input type="hidden" name="id" value="${student.id}" />
          <button class="small-button danger" type="submit">Archive</button>
        </form>
        <form method="post" action="/admin/users/reset-password" class="inline-form">
          <input type="hidden" name="id" value="${student.id}" />
          <input name="password" type="password" minlength="12" autocomplete="new-password" placeholder="Temporary password" required />
          <button class="small-button warning" type="submit">Reset password</button>
        </form>
      </div>` : ""}
    </div>
    <div class="stack">
      ${canEdit ? `<form class="stack" method="post" action="/admin/users/update">
        <input type="hidden" name="id" value="${student.id}" />
        <div class="admin-edit-grid">
          <div class="field"><label>Last name</label><input name="lastNameEn" value="${escapeHtml(student.lastNameEn)}" required /></div>
          <div class="field"><label>First name</label><input name="firstNameEn" value="${escapeHtml(student.firstNameEn)}" required /></div>
          <div class="field"><label>Date of birth</label><input name="birthDate" type="date" value="${escapeHtml(student.birthDate || "")}" required /></div>
          <div class="field"><label>E-mail</label><input name="email" type="email" value="${escapeHtml(student.email)}" required /></div>
          <div class="field"><label>Position</label><input name="position" value="${escapeHtml(student.position || "")}" required /></div>
          <div class="field"><label>Company</label><input name="company" value="${escapeHtml(student.company || "")}" /></div>
          <div class="field"><label>Phone</label><input name="phone" value="${escapeHtml(student.phone || "")}" /></div>
        </div>
        <button class="small-button primary" type="submit">Save profile</button>
      </form>` : `<div class="notice"><strong>Limited access.</strong><br>You do not have permission to edit this profile.</div>`}
      <div class="stack">
        <h3>Assigned courses</h3>
        ${assignments.map((assignment) => {
          recalculateAssignment(assignment);
          const course = courseById(assignment.courseId);
          const hasCertificate = Boolean(activeCertificateForAssignment(assignment.id));
          return `<div class="assignment-chip">
            <span>${escapeHtml(course?.title ?? "Course deleted")}</span>
            <span>${badge(assignment.status)} ${assignment.progressPercent ?? 0}%</span>
            ${hasCertificate
              ? `<span class="muted">Certificate issued</span>`
              : fullAdmin ? `<form method="post" action="/admin/assignments/${assignment.id}/delete"><button class="small-button danger" type="submit">Delete</button></form>` : `<span class="muted">No certificate</span>`}
          </div>`;
        }).join("") || `<p class="muted">No assignments yet.</p>`}
        ${canAssign && activeCourses.length
          ? `<form method="post" action="/admin/assignments/create" class="inline-form">
              <input type="hidden" name="userId" value="${student.id}" />
              <select name="courseId">${activeCourses.map((course) => `<option value="${course.id}">${escapeHtml(course.title)}</option>`).join("")}</select>
              <button class="small-button primary" type="submit">Assign course</button>
            </form>`
          : `<p class="muted">No active courses available to assign.</p>`}
        ${fullAdmin && activeCourses.length
          ? `<form method="post" action="/admin/certificates/issue-manual" class="inline-form">
              <input type="hidden" name="userId" value="${student.id}" />
              <select name="courseId">${activeCourses.map((course) => `<option value="${course.id}">${escapeHtml(course.title)}</option>`).join("")}</select>
              <label class="field">Issue date<input name="issuedAt" type="date" value="${dateInputValue()}" required /></label>
              <button class="small-button warning" type="submit" ${hasCertificatePhoto(student) ? "" : "disabled"}>Issue certificate</button>
              ${hasCertificatePhoto(student) ? `<span class="muted">The course will be marked as completed.</span>` : `<span class="muted">Upload the student's photo first.</span>`}
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
    "Users",
    `<section class="section">
      <div class="section-heading">
        <div><span class="eyebrow">Users</span><h1>Students</h1><p class="lead">An administrator creates students, edits required details, and assigns courses.</p></div>
      </div>
      <form class="inline-form" method="get" action="/admin/users">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Search students" />
        <button class="small-button primary" type="submit">Search</button>
      </form>
      <form class="form-panel" method="post" action="/admin/users/create">
        <h2>${isFullAdmin(user) ? "Create user" : "Create student"}</h2>
        ${isFullAdmin(user)
          ? `<div class="field"><label>Role</label><select name="role"><option value="student">Student</option><option value="instructor">Instructor</option></select></div>`
          : `<input type="hidden" name="role" value="student" />`}
        <div class="field"><label>E-mail</label><input name="email" type="email" required /></div>
        <div class="field"><label>First name</label><input name="firstNameEn" required /></div>
        <div class="field"><label>Last name</label><input name="lastNameEn" required /></div>
        <div class="field"><label>Date of birth</label><input name="birthDate" type="date" required /></div>
        <div class="field"><label>Position</label><input name="position" required /></div>
        <div class="field"><label>Company - optional</label><input name="company" /></div>
        <div class="field"><label>Phone</label><input name="phone" /></div>
        <div class="field"><label>Temporary password</label><input name="password" type="password" minlength="12" autocomplete="new-password" required /></div>
        <button class="button" type="submit">Create user</button>
      </form>
      ${isFullAdmin(user) ? `<article class="panel stack">
        <h2>Admin panel staff</h2>
        <table class="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>${staff
            .map((item) => `<tr><td>${escapeHtml(displayUserName(item))}</td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(roleLabel(item.role))}</td><td>${badge(item.status)}</td></tr>`)
            .join("") || `<tr><td colspan="4"><span class="muted">No staff members found.</span></td></tr>`}</tbody>
        </table>
      </article>` : ""}
      <div class="admin-user-list">
        ${pagination.items.map((student) => adminStudentCard(student, user)).join("") || `<article class="panel">No students found.</article>`}
      </div>
      ${paginationControls("/admin/users", params, pagination)}
    </section>`
  );
}

function assignmentAdminActions(assignment, returnTo) {
  return `<div class="table-actions">
    <form method="post" action="/admin/assignments/${assignment.id}/unlock-test">
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
      <button class="small-button warning" type="submit">Unlock retake</button>
    </form>
    <form method="post" action="/admin/assignments/${assignment.id}/reset-attempts">
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
      <button class="small-button danger" type="submit">Reset attempts</button>
    </form>
  </div>`;
}

function attemptWrongAnswersHtml(attempt) {
  const assignment = db.assignments.find((item) => item.id === attempt.assignmentId);
  const course = assignment ? courseById(assignment.courseId) : null;
  const questions = new Map((course?.test?.questions ?? []).map((question) => [question.id, question]));
  const wrongAnswers = (attempt.answers ?? []).filter((answer) => !answer.isCorrect);
  if (!wrongAnswers.length) return `<span class="muted">No errors.</span>`;
  return `<details><summary>${wrongAnswers.length} incorrect answers</summary><div class="stack">${wrongAnswers
    .map((answer) => {
      const question = questions.get(answer.questionId);
      const options = question?.options ?? [];
      const selectedIds = answer.selectedOptionIds ?? [answer.selectedOptionId].filter(Boolean);
      const selected = options.filter((option) => selectedIds.includes(option.id)).map((option) => option.optionText).join(", ") || "No answer";
      const correct = options.filter((option) => option.isCorrect).map((option) => option.optionText).join(", ");
      return `<div class="notice">
        <strong>${escapeHtml(question?.questionText ?? "Question deleted")}</strong>
        <p class="muted">Student answer: ${escapeHtml(selected)}</p>
        <p class="muted">Correct: ${escapeHtml(correct)}</p>
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
        <div><span class="eyebrow">Student profile</span><h1>${escapeHtml(displayUserName(student) || student.email)}</h1><p class="lead">${escapeHtml(student.email)} · ${escapeHtml(student.position || "Position not specified")}</p></div>
        <div class="actions"><a class="button secondary" href="/admin/users">All students</a><a class="button" href="/admin/certificates?userId=${encodeURIComponent(student.id)}">Certificates</a></div>
      </div>
      <div class="grid four">
        <article class="metric"><span class="muted">Courses</span><strong class="metric-value">${assignments.length}</strong></article>
        <article class="metric"><span class="muted">Completed</span><strong class="metric-value">${assignments.filter((item) => item.status === "completed").length}</strong></article>
        <article class="metric"><span class="muted">Test attempts</span><strong class="metric-value">${attempts.length}</strong></article>
        <article class="metric"><span class="muted">Certificates</span><strong class="metric-value">${certificates.length}</strong></article>
      </div>
      ${adminStudentCard(student, admin)}
      <article class="panel stack">
        <h2>Courses and progress</h2>
        <table class="table">
          <thead><tr><th>Course</th><th>Status</th><th>Progress</th><th>Attempts</th><th>Certificate</th><th>Actions</th></tr></thead>
          <tbody>${assignments
            .map((assignment) => {
              const course = courseById(assignment.courseId);
              const cert = activeCertificateForAssignment(assignment.id);
              return `<tr>
                <td>${escapeHtml(course?.title ?? "Course deleted")}</td>
                <td>${badge(assignment.status)}</td>
                <td>${assignment.progressPercent ?? 0}%</td>
                <td>${attemptsFor(assignment.id).length} / ${(course?.test?.attemptsLimit ?? 0) + (assignment.extraTestAttempts ?? 0)}</td>
                <td>${cert ? `<div class="table-actions"><a class="small-button primary" href="/certificates/${cert.id}">Open certificate</a><a class="small-button" href="/certificates/${cert.id}.pdf">PDF</a><span class="muted">${escapeHtml(cert.certificateNumber)}</span></div>` : `<span class="muted">No certificate</span>`}</td>
                <td>${assignmentAdminActions(assignment, returnTo)}</td>
              </tr>`;
            })
            .join("") || `<tr><td colspan="6"><span class="muted">No courses assigned.</span></td></tr>`}</tbody>
        </table>
      </article>
      <article class="panel stack">
        <h2>Test attempts</h2>
        <table class="table">
          <thead><tr><th>Course</th><th>Attempt</th><th>Result</th><th>Date</th><th>Errors</th></tr></thead>
          <tbody>${attempts
            .map((attempt) => {
              const assignment = db.assignments.find((item) => item.id === attempt.assignmentId);
              const course = assignment ? courseById(assignment.courseId) : null;
              return `<tr>
                <td>${escapeHtml(course?.title ?? "Course deleted")}</td>
                <td>${attempt.attemptNumber}</td>
                <td>${attempt.scorePercent}% ${badge(attempt.status === "passed" ? "test_passed" : "test_failed")}</td>
                <td>${new Date(attempt.finishedAt).toLocaleString("en-GB")}</td>
                <td>${attemptWrongAnswersHtml(attempt)}</td>
              </tr>`;
            })
            .join("") || `<tr><td colspan="5"><span class="muted">No attempts yet.</span></td></tr>`}</tbody>
        </table>
      </article>
      <article class="panel stack">
        <h2>Student notifications</h2>
        <table class="table">
          <thead><tr><th>Type</th><th>Event</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>${notifications
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((note) => `<tr><td>${escapeHtml(note.type)}</td><td>${escapeHtml(note.payload || "")}</td><td>${badge(note.status)}</td><td>${new Date(note.createdAt).toLocaleString("en-GB")}</td></tr>`)
            .join("") || `<tr><td colspan="4"><span class="muted">No notifications.</span></td></tr>`}</tbody>
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
    .map((status) => `<option value="${status}" ${selectedStatus === status ? "selected" : ""}>${status ? statusLabel(status) : "All statuses"}</option>`)
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
    "Reports",
    `<section class="section">
      <div><span class="eyebrow">Reports</span><h1>Learning progress</h1><p class="lead">Monitor student status across courses, tests, and certificates.</p></div>
      <form class="form-panel" method="get" action="/admin/reports">
        <h2>Filters</h2>
        <div class="admin-edit-grid">
          <div class="field"><label>Search</label><input name="q" value="${escapeHtml(params.q)}" placeholder="Student, email, course" /></div>
          <div class="field"><label>Student</label><select name="userId"><option value="">All students</option>${userSelectOptions(params.userId)}</select></div>
          <div class="field"><label>Course</label><select name="courseId"><option value="">All courses</option>${courseSelectOptions(params.courseId)}</select></div>
          <div class="field"><label>Status</label><select name="status">${assignmentStatusOptions(params.status)}</select></div>
        </div>
        <div class="table-actions"><button class="small-button primary" type="submit">Apply</button><a class="small-button" href="/admin/reports">Reset</a></div>
      </form>
      <div class="grid four">
        <article class="metric"><span class="muted">Not started</span><strong class="metric-value">${assignments.filter((item) => item.status === "not_started").length}</strong></article>
        <article class="metric"><span class="muted">In progress</span><strong class="metric-value">${assignments.filter((item) => item.status === "in_progress" || item.status === "test_available").length}</strong></article>
        <article class="metric"><span class="muted">Test failed</span><strong class="metric-value">${assignments.filter((item) => item.status === "test_failed").length}</strong></article>
        <article class="metric"><span class="muted">Completed</span><strong class="metric-value">${assignments.filter((item) => item.status === "completed").length}</strong></article>
      </div>
      <table class="table">
        <thead><tr><th>Student</th><th>Course</th><th>Status</th><th>Progress</th><th>Tests</th><th>Certificate</th><th>Actions</th></tr></thead>
        <tbody>${assignments
          .map((assignment) => {
            const student = userById(assignment.userId);
            const course = courseById(assignment.courseId);
            const cert = activeCertificateForAssignment(assignment.id);
            return `<tr>
              <td><a class="link-line" href="/admin/users/${assignment.userId}">${escapeHtml(displayUserName(student) || student?.email || "")}</a><br><span class="muted">${escapeHtml(student?.email ?? "")}</span></td>
              <td>${escapeHtml(course?.title ?? "Course deleted")}</td>
              <td>${badge(assignment.status)}</td>
              <td>${assignment.progressPercent ?? 0}%</td>
              <td>${attemptsFor(assignment.id).length} / ${(course?.test?.attemptsLimit ?? 0) + (assignment.extraTestAttempts ?? 0)}</td>
              <td>${cert ? `<a class="small-button" href="/certificates/${cert.id}">${escapeHtml(cert.certificateNumber)}</a>` : `<span class="muted">No</span>`}</td>
              <td>${assignmentAdminActions(assignment, returnTo)}</td>
            </tr>`;
          })
          .join("") || `<tr><td colspan="7"><span class="muted">No assignments found.</span></td></tr>`}</tbody>
      </table>
    </section>`
  );
}

function checkParams(searchParams = new URLSearchParams()) {
  const from = (searchParams.get("from") ?? "").trim();
  const to = (searchParams.get("to") ?? "").trim();
  return {
    staffId: searchParams.get("staffId") ?? "",
    from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : ""
  };
}

function dateRangeBounds(params) {
  return {
    from: params.from ? new Date(`${params.from}T00:00:00.000`) : null,
    to: params.to ? new Date(`${params.to}T23:59:59.999`) : null
  };
}

function isWithinDateRange(value, bounds) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  if (bounds.from && time < bounds.from.getTime()) return false;
  if (bounds.to && time > bounds.to.getTime()) return false;
  return true;
}

function staffSelectOptions(selectedId) {
  return db.users
    .filter((item) => item.role === "admin" || item.role === "instructor")
    .sort((a, b) => (displayUserName(a) || a.email).localeCompare(displayUserName(b) || b.email, "ru"))
    .map(
      (item) =>
        `<option value="${item.id}" ${selectedId === item.id ? "selected" : ""}>${escapeHtml(displayUserName(item) || item.email)} (${escapeHtml(roleLabel(item.role))})</option>`
    )
    .join("");
}

function parseCoursePriceAmount(value) {
  const text = normalizeCoursePrice(value);
  const match = text.match(/-?\d[\d\s]*(?:[.,]\d+)?/);
  if (!match) return { amount: 0, currency: "" };
  const compact = match[0].replace(/\s/g, "");
  const commaIndex = compact.lastIndexOf(",");
  const dotIndex = compact.lastIndexOf(".");
  let numericText = compact;
  if (commaIndex >= 0 && dotIndex >= 0) {
    const decimalSeparator = commaIndex > dotIndex ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    numericText = compact.split(thousandSeparator).join("").replace(decimalSeparator, ".");
  } else {
    numericText = compact.replace(",", ".");
  }
  const amount = Number(numericText);
  const currency = text.replace(match[0], "").trim();
  return { amount: Number.isFinite(amount) ? amount : 0, currency };
}

function courseRevenuePrice(course) {
  const newPrice = normalizeCoursePrice(course?.newPrice);
  const oldPrice = normalizeCoursePrice(course?.oldPrice);
  const selectedPrice = newPrice || oldPrice;
  return { ...parseCoursePriceAmount(selectedPrice), selectedPrice };
}

function formatReportMoney(amount, currencies = new Set()) {
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount);
  const cleanCurrencies = [...currencies].filter(Boolean);
  if (cleanCurrencies.length === 1) return `${formatted} ${cleanCurrencies[0]}`;
  if (cleanCurrencies.length > 1) return `${formatted} (mixed currency)`;
  return formatted;
}

function checkReportData(searchParams = new URLSearchParams()) {
  const params = checkParams(searchParams);
  const bounds = dateRangeBounds(params);
  const staffFilter = params.staffId;
  const registeredStudents = db.users
    .filter((item) => item.role === "student")
    .filter((item) => !staffFilter || item.createdById === staffFilter)
    .filter((item) => isWithinDateRange(item.createdAt, bounds))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const assignments = db.assignments
    .filter((assignment) => !staffFilter || assignment.assignedById === staffFilter)
    .filter((assignment) => isWithinDateRange(assignment.assignedAt, bounds))
    .sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime());
  const currencies = new Set();
  const total = assignments.reduce((sum, assignment) => {
    const course = courseById(assignment.courseId);
    const price = courseRevenuePrice(course);
    if (price.currency) currencies.add(price.currency);
    return sum + price.amount;
  }, 0);
  const assignedStudentIds = new Set(assignments.map((item) => item.userId));
  const hasStudentsWithoutCreator = registeredStudents.some((student) => !student.createdById);
  return { params, registeredStudents, assignments, currencies, total, assignedStudentIds, hasStudentsWithoutCreator };
}

function adminChecksLegacy(user, searchParams = new URLSearchParams()) {
  const { params, registeredStudents, assignments, currencies, total, assignedStudentIds, hasStudentsWithoutCreator } =
    checkReportData(searchParams);
  const exportHref = `/admin/checks/export.xls${reportQuery(params)}`;
  return adminShell(
    user,
    "Checks",
    `<section class="section">
      <div>
        <span class="eyebrow">Reporting</span>
        <h1>Checks and assignments</h1>
        <p class="lead">Select a staff member and a period to see students they registered, courses they assigned, and the resulting course-price total.</p>
      </div>
      <form class="form-panel" method="get" action="/admin/checks">
        <h2>Filter</h2>
        <div class="admin-edit-grid">
          <div class="field"><label>Staff member</label><select name="staffId"><option value="">All administrators and instructors</option>${staffSelectOptions(params.staffId)}</select></div>
          <div class="field"><label>From</label><input name="from" type="date" value="${escapeHtml(params.from)}" /></div>
          <div class="field"><label>To</label><input name="to" type="date" value="${escapeHtml(params.to)}" /></div>
        </div>
        <div class="table-actions"><button class="small-button primary" type="submit">Show</button><a class="small-button" href="/admin/checks">Reset</a><a class="small-button warning" href="${exportHref}">Export Excel</a></div>
      </form>
      <div class="grid four">
        <article class="metric"><span class="muted">Registered students</span><strong class="metric-value">${registeredStudents.length}</strong></article>
        <article class="metric"><span class="muted">Assigned courses</span><strong class="metric-value">${assignments.length}</strong></article>
        <article class="metric"><span class="muted">Unique assigned students</span><strong class="metric-value">${assignedStudentIds.size}</strong></article>
        <article class="metric"><span class="muted">Total amount</span><strong class="metric-value">${escapeHtml(formatReportMoney(total, currencies))}</strong></article>
      </div>
      <article class="panel stack">
        <div class="section-heading"><div><h2>Courses and amounts</h2><p class="muted">The new price is used; if it is empty, the old price is used.</p></div></div>
        <table class="table">
          <thead><tr><th>Staff member</th><th>Student</th><th>Course</th><th>Old price</th><th>New price</th><th>Included amount</th><th>Date</th></tr></thead>
          <tbody>${assignments
            .map((assignment) => {
              const student = userById(assignment.userId);
              const course = courseById(assignment.courseId);
              const staff = userById(assignment.assignedById);
              const price = courseRevenuePrice(course);
              const rowCurrencies = new Set(price.currency ? [price.currency] : []);
              return `<tr>
                <td>${escapeHtml(displayUserName(staff) || staff?.email || "Not specified")}</td>
                <td><a class="link-line" href="/admin/users/${encodeURIComponent(assignment.userId)}">${escapeHtml(displayUserName(student) || student?.email || "Student deleted")}</a><br><span class="muted">${escapeHtml(student?.email ?? "")}</span></td>
                <td>${escapeHtml(course?.title ?? "Course deleted")}</td>
                <td>${escapeHtml(course?.oldPrice || "-")}</td>
                <td>${escapeHtml(course?.newPrice || "-")}</td>
                <td>${escapeHtml(formatReportMoney(price.amount, rowCurrencies))}</td>
                <td>${new Date(assignment.assignedAt).toLocaleDateString("en-GB")}</td>
              </tr>`;
            })
            .join("") || `<tr><td colspan="7"><span class="muted">No assignments for the selected period.</span></td></tr>`}</tbody>
        </table>
      </article>
      <article class="panel stack">
        <div class="section-heading"><div><h2>Registered students</h2><p class="muted">Shows students created by the staff member in the selected period.</p></div></div>
        <table class="table">
          <thead><tr><th>Staff member</th><th>Student</th><th>Email</th><th>Assignments in period</th><th>Registration date</th></tr></thead>
          <tbody>${registeredStudents
            .map((student) => {
              const creator = userById(student.createdById);
              const assignmentCount = assignments.filter((assignment) => assignment.userId === student.id).length;
              return `<tr>
                <td>${escapeHtml(displayUserName(creator) || creator?.email || "Not specified")}</td>
                <td><a class="link-line" href="/admin/users/${encodeURIComponent(student.id)}">${escapeHtml(displayUserName(student) || student.email)}</a></td>
                <td>${escapeHtml(student.email)}</td>
                <td>${assignmentCount}</td>
                <td>${new Date(student.createdAt).toLocaleDateString("en-GB")}</td>
              </tr>`;
            })
            .join("") || `<tr><td colspan="5"><span class="muted">No registrations for the selected period.</span></td></tr>`}</tbody>
        </table>
      </article>
      ${hasStudentsWithoutCreator ? `<div class="notice">Some older students do not have a recorded creator because they were imported or created before this report was introduced.</div>` : ""}
    </section>`
  );
}

const invoiceStatuses = ["draft", "issued", "sent", "viewed", "partially_paid", "paid", "overdue", "cancelled"];

function defaultInvoiceTemplate() {
  return {
    academyName: "MARITIME LEARNING ACADEMY",
    academySubtitle: "INSTITUTE OF POSTGRADUATE EDUCATION",
    address: "Lyustdorfska road 140A, Odesa, Ukraine, 65000",
    contacts: "Tel: +38 (048) 7933-245-79; E-mail: info@maritimelearning.store",
    iban: "UA5467556555644443467626354",
    paymentDetails: "",
    beneficiaryBank: "JSC CB PRIVATBANK, Kyiv, Ukraine, SWIFT code: PBANUA2X",
    correspondentBank: "The Bank of New York Mellon, New York, USA, SWIFT/BIC: IRVTUS3N",
    directorName: "Director",
    accountantName: "Accountant",
    footerNote: ""
  };
}

function invoiceTemplateValue(value, fallback = "", limit = 500) {
  const text = String(value ?? fallback).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, limit);
}

function invoiceTemplateSettings() {
  db.settings ??= {};
  const defaults = defaultInvoiceTemplate();
  const source = db.settings.invoiceTemplate && typeof db.settings.invoiceTemplate === "object" ? db.settings.invoiceTemplate : {};
  const template = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, invoiceTemplateValue(source[key], fallback)]));
  db.settings.invoiceTemplate = template;
  return template;
}

function updateInvoiceTemplateSettings(form) {
  const template = invoiceTemplateSettings();
  for (const key of Object.keys(template)) {
    template[key] = invoiceTemplateValue(form.get(key)?.toString(), template[key]);
  }
  db.settings.invoiceTemplate = template;
  return template;
}

function invoiceStatusLabel(status) {
  return {
    draft: "Draft", issued: "Issued", sent: "Sent", viewed: "Viewed",
    partially_paid: "Partially paid", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled"
  }[status] ?? status;
}

function invoiceItems() {
  db.settings ??= {};
  db.settings.invoices ??= [];
  return db.settings.invoices;
}

function invoiceById(invoiceId) {
  return invoiceItems().find((item) => item.id === invoiceId);
}

function checkDateForEvent(assignment, event) {
  if (event === "started") return assignment.startedAt;
  if (event === "completed") return assignment.completedAt;
  return assignment.assignedAt;
}

const invoiceReportColumns = [
  { key: "student", label: "Student" },
  { key: "email", label: "Student e-mail" },
  { key: "company", label: "Company" },
  { key: "creator", label: "Created / assigned by" },
  { key: "registeredAt", label: "Registration date" },
  { key: "course", label: "Course" },
  { key: "oldPrice", label: "Old price" },
  { key: "newPrice", label: "New price" },
  { key: "amount", label: "Included price" },
  { key: "assignedAt", label: "Assignment date" },
  { key: "startedAt", label: "Learning started" },
  { key: "completedAt", label: "Completion date" },
  { key: "status", label: "Course status" },
  { key: "certificateNumber", label: "Certificate number" }
];

const defaultInvoiceReportColumns = ["student", "company", "creator", "course", "assignedAt", "startedAt", "completedAt", "status", "certificateNumber", "amount"];

function invoiceSelectedColumns(values = []) {
  const allowed = new Set(invoiceReportColumns.map((column) => column.key));
  const selected = [...new Set(values.filter((value) => allowed.has(value)))];
  return selected.length ? selected : [...defaultInvoiceReportColumns];
}

function invoiceColumnLabel(key) {
  return invoiceReportColumns.find((column) => column.key === key)?.label ?? key;
}

function invoiceColumnText(line, key) {
  const currency = new Set(line.currency ? [line.currency] : []);
  const values = {
    student: line.studentName,
    email: line.studentEmail,
    company: line.company,
    creator: line.creatorName,
    registeredAt: formatDate(line.registeredAt),
    course: line.courseTitle,
    oldPrice: line.oldPrice || "-",
    newPrice: line.newPrice || "-",
    amount: formatReportMoney(Math.max(0, Number(line.amount) || 0), currency),
    assignedAt: formatDate(line.assignedAt),
    startedAt: formatDate(line.startedAt),
    completedAt: formatDate(line.completedAt),
    status: statusLabel(line.status),
    certificateNumber: line.certificateNumber || "-"
  };
  return values[key] ?? "";
}

function invoiceColumnCell(line, key) {
  if (key === "student") return `<a class="link-line" href="/admin/users/${encodeURIComponent(line.studentId)}">${escapeHtml(line.studentName)}</a>`;
  return escapeHtml(invoiceColumnText(line, key));
}

function invoiceReportColumnSelector(columns) {
  return `<div class="field"><label>Report columns</label><div class="checkbox-list">${invoiceReportColumns
    .map((column) => `<label class="checkbox-row"><input name="column" type="checkbox" value="${column.key}" ${columns.includes(column.key) ? "checked" : ""} /> ${escapeHtml(column.label)}</label>`)
    .join("")}</div></div>`;
}

function invoiceFilterParams(searchParams = new URLSearchParams()) {
  const basic = checkParams(searchParams);
  const today = new Date();
  const preset = ["current_month", "previous_month", "custom"].includes(searchParams.get("period")) ? searchParams.get("period") : "custom";
  let { from, to } = basic;
  if (preset !== "custom") {
    const anchor = new Date(today.getFullYear(), today.getMonth() + (preset === "previous_month" ? -1 : 0), 1);
    from = anchor.toISOString().slice(0, 10);
    to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).toISOString().slice(0, 10);
  }
  return {
    ...basic,
    from,
    to,
    period: preset,
    event: ["assigned", "started", "completed"].includes(searchParams.get("event")) ? searchParams.get("event") : "assigned",
    studentIds: searchParams.getAll("studentId").filter(Boolean),
    columns: invoiceSelectedColumns(searchParams.getAll("column")),
    company: (searchParams.get("company") ?? "").trim(),
    status: searchParams.get("status") ?? "",
    groupBy: ["student", "course", "company", "staff", "date", "status"].includes(searchParams.get("groupBy")) ? searchParams.get("groupBy") : "student"
  };
}

function invoiceFilterQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "studentIds") {
      for (const studentId of value ?? []) query.append("studentId", studentId);
    } else if (key === "columns") {
      for (const column of value ?? []) query.append("column", column);
    } else if (value) {
      query.set(key, String(value));
    }
  }
  return query.toString();
}

function invoiceAssignmentData(params) {
  const bounds = dateRangeBounds(params);
  return db.assignments
    .map(recalculateAssignment)
    .filter((assignment) => {
      const student = userById(assignment.userId);
      if (!student) return false;
      if (params.staffId && assignment.assignedById !== params.staffId && student.createdById !== params.staffId) return false;
      if (params.studentIds.length && !params.studentIds.includes(assignment.userId)) return false;
      if (params.company && String(student.company || "").toLowerCase() !== params.company.toLowerCase()) return false;
      if (params.status && assignment.status !== params.status) return false;
      return isWithinDateRange(checkDateForEvent(assignment, params.event), bounds);
    })
    .sort((a, b) => new Date(checkDateForEvent(b, params.event) || 0).getTime() - new Date(checkDateForEvent(a, params.event) || 0).getTime());
}

function invoiceGroupKey(assignment, groupBy) {
  const student = userById(assignment.userId);
  const course = courseById(assignment.courseId);
  const staff = userById(assignment.assignedById || student?.createdById);
  if (groupBy === "course") return course?.title || "";
  if (groupBy === "company") return student?.company || "";
  if (groupBy === "staff") return displayUserName(staff) || staff?.email || "";
  if (groupBy === "date") return String(assignment.assignedAt || "").slice(0, 10);
  if (groupBy === "status") return statusLabel(assignment.status);
  return displayUserName(student) || student?.email || "";
}

function invoiceLineFromAssignment(assignment) {
  const student = userById(assignment.userId);
  const course = courseById(assignment.courseId);
  const creator = userById(assignment.assignedById || student?.createdById);
  const price = courseRevenuePrice(course);
  const certificate = activeCertificateForAssignment(assignment.id);
  return {
    id: id("invoice_line"), assignmentId: assignment.id, studentId: assignment.userId,
    studentName: displayUserName(student) || student?.email || "Student deleted",
    studentEmail: student?.email || "", company: student?.company || "",
    creatorName: displayUserName(creator) || creator?.email || "Not specified",
    registeredAt: student?.createdAt || "",
    courseId: assignment.courseId, courseTitle: course?.title || "Course deleted",
    oldPrice: course?.oldPrice || "", newPrice: course?.newPrice || "",
    assignedAt: assignment.assignedAt || "", startedAt: assignment.startedAt || "", completedAt: assignment.completedAt || "",
    status: assignment.status, certificateNumber: certificate?.certificateNumber || "",
    baseAmount: price.amount, discount: 0, amount: price.amount, currency: price.currency || ""
  };
}

function invoiceTotals(invoice) {
  const lines = (invoice.lines ?? []).filter((line) => line.included !== false);
  const subtotal = lines.reduce((sum, line) => sum + Math.max(0, Number(line.amount) || 0), 0);
  const lineDiscount = lines.reduce((sum, line) => sum + Math.max(0, Number(line.discount) || 0), 0);
  const invoiceDiscount = Math.max(0, Number(invoice.discount) || 0);
  const extraCharge = Math.max(0, Number(invoice.extraCharge) || 0);
  const taxable = Math.max(0, subtotal - lineDiscount - invoiceDiscount + extraCharge);
  const vatAmount = taxable * Math.max(0, Number(invoice.vatRate) || 0) / 100;
  return { subtotal, lineDiscount, invoiceDiscount, extraCharge, vatAmount, total: taxable + vatAmount };
}

function invoiceNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const count = invoiceItems().filter((invoice) => String(invoice.number).includes(date)).length + 1;
  return `INV-${date}-${String(count).padStart(4, "0")}`;
}

function invoiceStatusOptions(selected) {
  return invoiceStatuses.map((status) => `<option value="${status}" ${selected === status ? "selected" : ""}>${invoiceStatusLabel(status)}</option>`).join("");
}

function invoicePdfPath(invoice) {
  return resolve(uploadsDir, "invoices", `${invoice.id}.pdf`);
}

function invoiceAmountInWords(amount, currency = "USD") {
  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const underThousand = (value) => {
    const number = Math.max(0, Math.floor(value));
    if (number < 20) return ones[number];
    if (number < 100) return `${tens[Math.floor(number / 10)]}${number % 10 ? `-${ones[number % 10]}` : ""}`;
    return `${ones[Math.floor(number / 100)]} hundred${number % 100 ? ` ${underThousand(number % 100)}` : ""}`;
  };
  const whole = Math.max(0, Math.floor(Number(amount) || 0));
  const groups = [[1000000000, "billion"], [1000000, "million"], [1000, "thousand"]];
  let rest = whole;
  const words = [];
  for (const [divisor, label] of groups) {
    if (rest >= divisor) {
      const group = Math.floor(rest / divisor);
      words.push(`${underThousand(group)} ${label}`);
      rest %= divisor;
    }
  }
  if (rest || !words.length) words.push(underThousand(rest));
  const cents = Math.round(((Number(amount) || 0) - whole) * 100);
  return `${words.join(" ")} ${currency}${cents ? ` and ${String(Math.abs(cents)).padStart(2, "0")}/100` : ""}`;
}

function invoicePdfBuffer(invoice) {
  const totals = invoiceTotals(invoice);
  const reportColumns = invoiceSelectedColumns(invoice.columns ?? []);
  const template = invoiceTemplateSettings();
  return new Promise((resolvePdf, rejectPdf) => {
    const doc = new PDFDocument({ size: "A4", layout: reportColumns.length > 6 ? "landscape" : "portrait", margin: 34 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolvePdf(Buffer.concat(chunks)));
    doc.on("error", rejectPdf);
    const font = ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].find(existsSync);
    if (font) doc.font(font);
    doc.fillColor("#06395d").fontSize(17).text(template.academyName, { align: "center" });
    if (template.academySubtitle) doc.fontSize(10).text(template.academySubtitle, { align: "center" });
    doc.fillColor("#587087").fontSize(8).text(template.address, { align: "center" });
    doc.text(template.contacts, { align: "center" });
    doc.moveDown(0.6);
    doc.fillColor("#0d1b2a").fontSize(20).text("INVOICE", { align: "right" });
    doc.fontSize(10).text(`INVOICE No: ${invoice.number}`, { align: "right" });
    doc.text(`DATE: ${formatDate(invoice.issueDate)}`, { align: "right" });
    doc.moveDown(0.4);
    if (template.iban) doc.fontSize(9).text(`IBAN: ${template.iban}`);
    doc.fontSize(12).fillColor("#0d1b2a").text(`INVOICE TO: ${invoice.recipientName || invoice.recipientCompany || "Not specified"}`);
    if (invoice.recipientEmail) doc.text(`E-mail: ${invoice.recipientEmail}`);
    if (invoice.recipientCompany) doc.text(`Company: ${invoice.recipientCompany}`);
    doc.fontSize(8).fillColor("#587087").text(`Status: ${invoiceStatusLabel(invoice.status)}    Period: ${invoice.period?.from || "-"} - ${invoice.period?.to || "-"}`);
    doc.moveDown(0.55);
    const paymentRows = [
      ["Details of payment", template.paymentDetails],
      ["Beneficiary's bank", template.beneficiaryBank],
      ["Correspondent bank", template.correspondentBank]
    ].filter(([, value]) => value);
    for (const [label, value] of paymentRows) {
      const paymentY = doc.y;
      doc.fillColor("#06395d").fontSize(8).text(label, 34, paymentY, { width: 125 });
      doc.fillColor("#0d1b2a").text(value, 162, paymentY, { width: doc.page.width - 196 });
      doc.y = Math.max(doc.y, paymentY + 15);
    }
    if (paymentRows.length) doc.moveDown(0.45);
    const tableLeft = 34;
    const tableWidth = doc.page.width - tableLeft * 2;
    const columnWidth = tableWidth / reportColumns.length;
    const drawTableHeader = () => {
      const headerY = doc.y;
      doc.fillColor("#06395d").fontSize(7);
      reportColumns.forEach((key, index) => doc.text(invoiceColumnLabel(key), tableLeft + index * columnWidth, headerY, { width: columnWidth - 4, height: 18 }));
      doc.moveTo(tableLeft, headerY + 20).lineTo(tableLeft + tableWidth, headerY + 20).stroke("#8aaac1");
      doc.y = headerY + 24;
    };
    drawTableHeader();
    for (const line of (invoice.lines ?? []).filter((item) => item.included !== false)) {
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
        drawTableHeader();
      }
      const y = doc.y + 4;
      doc.fillColor("#0d1b2a").fontSize(7);
      reportColumns.forEach((key, index) => doc.text(pdfText(invoiceColumnText(line, key)), tableLeft + index * columnWidth, y, { width: columnWidth - 4, height: 26 }));
      doc.y = y + 30;
    }
    doc.moveDown();
    doc.fontSize(10).fillColor("#0d1b2a");
    for (const [label, amount] of [["Subtotal", totals.subtotal], ["Discount", -(totals.lineDiscount + totals.invoiceDiscount)], ["Extra charge", totals.extraCharge], [`VAT ${invoice.vatRate || 0}%`, totals.vatAmount], ["TOTAL", totals.total]]) {
      doc.text(label, 350, doc.y, { width: 120 }).text(formatReportMoney(amount, new Set(invoice.currency ? [invoice.currency] : [])), 470, doc.y - 12, { width: 82, align: "right" });
    }
    doc.moveDown(0.6);
    doc.fillColor("#0d1b2a").fontSize(9).text(`Sum in words: ${invoiceAmountInWords(totals.total, invoice.currency || "USD")}`);
    if (invoice.comment) { doc.moveDown(0.25); doc.fillColor("#587087").fontSize(8).text(`Comment: ${pdfText(invoice.comment)}`); }
    if (template.footerNote) { doc.moveDown(0.25); doc.fillColor("#587087").fontSize(8).text(template.footerNote); }
    doc.moveDown(1.2);
    doc.fillColor("#0d1b2a").fontSize(9).text(`${template.directorName} __________________________`);
    doc.moveDown(0.6);
    doc.text(`${template.accountantName} ________________________`);
    doc.end();
  });
}

async function persistInvoicePdf(invoice) {
  mkdirSync(dirname(invoicePdfPath(invoice)), { recursive: true });
  writeFileSync(invoicePdfPath(invoice), await invoicePdfBuffer(invoice));
  invoice.pdfUrl = `/admin/checks/invoices/${encodeURIComponent(invoice.id)}.pdf`;
}

function invoiceHistoryRows() {
  return invoiceItems().slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function adminChecks(user, searchParams = new URLSearchParams()) {
  if (searchParams.get("legacy") === "1") return adminChecksLegacy(user, searchParams);
  const params = invoiceFilterParams(searchParams);
  const assignments = invoiceAssignmentData(params).sort((a, b) => invoiceGroupKey(a, params.groupBy).localeCompare(invoiceGroupKey(b, params.groupBy), "ru"));
  const total = assignments.reduce((sum, assignment) => sum + courseRevenuePrice(courseById(assignment.courseId)).amount, 0);
  const students = db.users.filter((item) => item.role === "student").sort((a, b) => displayUserName(a).localeCompare(displayUserName(b), "ru"));
  const companies = [...new Set(students.map((item) => item.company).filter(Boolean))].sort();
  const query = invoiceFilterQuery(params);
  const selectedStaff = userById(params.staffId);
  const draftHeaders = params.columns.map((key) => `<th>${escapeHtml(invoiceColumnLabel(key))}</th>`).join("");
  const draftRows = assignments
    .map((assignment) => {
      const line = invoiceLineFromAssignment(assignment);
      return `<tr><td><input form="invoice-create-form" type="checkbox" name="assignmentId" value="${assignment.id}" checked aria-label="Add to invoice" /></td>${params.columns.map((key) => `<td>${invoiceColumnCell(line, key)}</td>`).join("")}</tr>`;
    })
    .join("");
  return adminShell(user, "Invoices", `<section class="section stack">
    <div class="toolbar"><div><span class="eyebrow">Invoices and reports</span><h1>Invoices</h1><p class="lead">Select assignments, prepare a draft invoice, and save it to the history.</p></div><a class="small-button" href="/admin/checks/template">Edit invoice template</a></div>
    <form class="form-panel" method="get" action="/admin/checks"><h2>Filters</h2><div class="admin-edit-grid">
      <div class="field"><label>User / manager</label><select name="staffId"><option value="">All users</option>${staffSelectOptions(params.staffId)}</select></div>
      <div class="field"><label>Company</label><select name="company"><option value="">All companies</option>${companies.map((company) => `<option value="${escapeHtml(company)}" ${params.company === company ? "selected" : ""}>${escapeHtml(company)}</option>`).join("")}</select></div>
      <div class="field"><label>Students</label><select name="studentId" multiple size="4">${students.map((student) => `<option value="${student.id}" ${params.studentIds.includes(student.id) ? "selected" : ""}>${escapeHtml(displayUserName(student) || student.email)}</option>`).join("")}</select></div>
      <div class="field"><label>Period event</label><select name="event"><option value="assigned" ${params.event === "assigned" ? "selected" : ""}>Assignment</option><option value="started" ${params.event === "started" ? "selected" : ""}>Learning started</option><option value="completed" ${params.event === "completed" ? "selected" : ""}>Completed</option></select></div>
      <div class="field"><label>Period</label><select name="period"><option value="current_month" ${params.period === "current_month" ? "selected" : ""}>Current month</option><option value="previous_month" ${params.period === "previous_month" ? "selected" : ""}>Previous month</option><option value="custom" ${params.period === "custom" ? "selected" : ""}>Custom range</option></select></div>
      <div class="field"><label>From</label><input name="from" type="date" value="${escapeHtml(params.from)}" /></div><div class="field"><label>To</label><input name="to" type="date" value="${escapeHtml(params.to)}" /></div>
      <div class="field"><label>Course status</label><select name="status">${assignmentStatusOptions(params.status)}</select></div>
      <div class="field"><label>Group by</label><select name="groupBy"><option value="student" ${params.groupBy === "student" ? "selected" : ""}>Student</option><option value="course" ${params.groupBy === "course" ? "selected" : ""}>Course</option><option value="company" ${params.groupBy === "company" ? "selected" : ""}>Company</option><option value="staff" ${params.groupBy === "staff" ? "selected" : ""}>User</option><option value="date" ${params.groupBy === "date" ? "selected" : ""}>Date</option><option value="status" ${params.groupBy === "status" ? "selected" : ""}>Status</option></select></div>
    </div>${invoiceReportColumnSelector(params.columns)}<div class="table-actions"><button class="small-button primary">Show</button><a class="small-button" href="/admin/checks">Reset</a><a class="small-button warning" href="/admin/checks/export.xls?${query}">Export Excel</a></div></form>
    <div class="grid four"><article class="metric"><span class="muted">Courses in selection</span><strong class="metric-value">${assignments.length}</strong></article><article class="metric"><span class="muted">Students</span><strong class="metric-value">${new Set(assignments.map((item) => item.userId)).size}</strong></article><article class="metric"><span class="muted">Recipient</span><strong class="metric-value">${escapeHtml(displayUserName(selectedStaff) || selectedStaff?.email || params.company || "All")}</strong></article><article class="metric"><span class="muted">Estimated total</span><strong class="metric-value">${escapeHtml(formatReportMoney(total))}</strong></article></div>
    <article class="panel stack"><div class="section-heading"><div><h2>Draft calculation</h2><p class="muted">Select the items to include in the document. Prices can be changed in the draft.</p></div></div>
      <form id="invoice-create-form" method="post" action="/admin/checks/invoices/create" class="inline-form"><input type="hidden" name="filterQuery" value="${escapeHtml(query)}" /><input type="hidden" name="recipientName" value="${escapeHtml(displayUserName(selectedStaff) || selectedStaff?.company || params.company)}" /><input type="hidden" name="recipientEmail" value="${escapeHtml(selectedStaff?.email || "")}" /><input type="hidden" name="recipientCompany" value="${escapeHtml(params.company || selectedStaff?.company || "")}" /><button class="button" type="submit">Create invoice draft</button></form>
      <table class="table"><thead><tr><th>Include</th>${draftHeaders}</tr></thead><tbody>${draftRows || `<tr><td colspan="${params.columns.length + 1}"><span class="muted">No assignments in this selection.</span></td></tr>`}</tbody></table>
    </article>
    <article class="panel stack"><div class="section-heading"><div><h2>Invoice history</h2><p class="muted">All amounts and items are fixed when the document is created.</p></div></div><table class="table"><thead><tr><th>Number</th><th>Recipient</th><th>Period</th><th>Amount</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${invoiceHistoryRows().map((invoice) => { const totals = invoiceTotals(invoice); return `<tr><td>${escapeHtml(invoice.number)}</td><td>${escapeHtml(invoice.recipientName || invoice.recipientCompany || "Not specified")}</td><td>${escapeHtml(invoice.period?.from || "-")} - ${escapeHtml(invoice.period?.to || "-")}</td><td>${escapeHtml(formatReportMoney(totals.total, new Set(invoice.currency ? [invoice.currency] : [])))}</td><td>${badge(invoiceStatusLabel(invoice.status))}</td><td>${formatDate(invoice.createdAt)}</td><td><a class="small-button" href="/admin/checks/invoices/${invoice.id}">Open</a></td></tr>`; }).join("") || `<tr><td colspan="7"><span class="muted">No invoices yet.</span></td></tr>`}</tbody></table></article>
  </section>`);
}

function adminInvoiceDetail(user, invoice) {
  const totals = invoiceTotals(invoice);
  return adminShell(user, `Invoice ${invoice.number}`, `<section class="section stack"><div class="toolbar"><div><span class="eyebrow">Invoice</span><h1>${escapeHtml(invoice.number)}</h1><p class="lead">Edit items before sending. Changes are saved in the history.</p></div><div class="table-actions"><a class="small-button" href="/admin/checks">Back to list</a><a class="small-button" href="/admin/checks/template">Template</a><a class="small-button warning" href="${invoice.pdfUrl || `/admin/checks/invoices/${invoice.id}.pdf`}">PDF and print</a></div></div>
    <form method="post" action="/admin/checks/invoices/${invoice.id}/update" class="stack"><article class="panel"><div class="admin-edit-grid"><div class="field"><label>Recipient</label><input name="recipientName" value="${escapeHtml(invoice.recipientName || "")}" /></div><div class="field"><label>Company</label><input name="recipientCompany" value="${escapeHtml(invoice.recipientCompany || "")}" /></div><div class="field"><label>Email</label><input name="recipientEmail" type="email" value="${escapeHtml(invoice.recipientEmail || "")}" /></div><div class="field"><label>Issue date</label><input name="issueDate" type="date" value="${escapeHtml(String(invoice.issueDate || "").slice(0, 10))}" /></div><div class="field"><label>Due date</label><input name="dueDate" type="date" value="${escapeHtml(String(invoice.dueDate || "").slice(0, 10))}" /></div><div class="field"><label>Currency</label><input name="currency" value="${escapeHtml(invoice.currency || "")}" placeholder="USD" /></div><div class="field"><label>Invoice discount</label><input name="discount" type="number" min="0" step="0.01" value="${Number(invoice.discount) || 0}" /></div><div class="field"><label>Extra charge</label><input name="extraCharge" type="number" min="0" step="0.01" value="${Number(invoice.extraCharge) || 0}" /></div><div class="field"><label>VAT, %</label><input name="vatRate" type="number" min="0" step="0.01" value="${Number(invoice.vatRate) || 0}" /></div><div class="field"><label>Status</label><select name="status">${invoiceStatusOptions(invoice.status)}</select></div><div class="field"><label>Payment date</label><input name="paidAt" type="date" value="${escapeHtml(String(invoice.paidAt || "").slice(0, 10))}" /></div></div>${invoiceReportColumnSelector(invoiceSelectedColumns(invoice.columns ?? []))}<div class="field"><label>Comment</label><textarea name="comment">${escapeHtml(invoice.comment || "")}</textarea></div></article>
      <article class="panel stack"><h2>Items</h2><table class="table"><thead><tr><th>Include</th><th>Student</th><th>Course</th><th>Status / certificate</th><th>Price</th><th>Discount</th></tr></thead><tbody>${(invoice.lines ?? []).map((line) => `<tr><td><input type="checkbox" name="included_${line.id}" ${line.included !== false ? "checked" : ""} /></td><td>${escapeHtml(line.studentName)}<br><span class="muted">${escapeHtml(line.company || line.studentEmail)}</span></td><td>${escapeHtml(line.courseTitle)}<br><span class="muted">${formatDate(line.assignedAt)}</span></td><td>${badge(line.status)}<br><span class="muted">${escapeHtml(line.certificateNumber || "No certificate")}</span></td><td><input name="amount_${line.id}" type="number" min="0" step="0.01" value="${Number(line.amount) || 0}" /></td><td><input name="lineDiscount_${line.id}" type="number" min="0" step="0.01" value="${Number(line.discount) || 0}" /></td></tr>`).join("")}</tbody></table></article>
      <article class="panel"><div class="grid four"><article class="metric"><span class="muted">Subtotal</span><strong class="metric-value">${escapeHtml(formatReportMoney(totals.subtotal, new Set(invoice.currency ? [invoice.currency] : [])))}</strong></article><article class="metric"><span class="muted">Discounts</span><strong class="metric-value">${escapeHtml(formatReportMoney(totals.lineDiscount + totals.invoiceDiscount, new Set(invoice.currency ? [invoice.currency] : [])))}</strong></article><article class="metric"><span class="muted">VAT</span><strong class="metric-value">${escapeHtml(formatReportMoney(totals.vatAmount, new Set(invoice.currency ? [invoice.currency] : [])))}</strong></article><article class="metric"><span class="muted">Total</span><strong class="metric-value">${escapeHtml(formatReportMoney(totals.total, new Set(invoice.currency ? [invoice.currency] : [])))}</strong></article></div></article><div class="table-actions"><button class="button" type="submit">Save and update PDF</button><button class="small-button warning" type="submit" name="sendEmail" value="1">Send by email</button></div></form>
    <article class="panel stack"><h2>Change history</h2><table class="table"><thead><tr><th>Date</th><th>User</th><th>Event</th></tr></thead><tbody>${(invoice.changes ?? []).slice().reverse().map((change) => `<tr><td>${new Date(change.at).toLocaleString("en-GB")}</td><td>${escapeHtml(change.byName || "")}</td><td>${escapeHtml(change.action)}</td></tr>`).join("") || `<tr><td colspan="3"><span class="muted">No changes yet.</span></td></tr>`}</tbody></table></article></section>`);
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
    .map((status) => `<option value="${status}" ${selectedStatus === status ? "selected" : ""}>${status ? (status === "passed" ? "Passed" : "Failed") : "All results"}</option>`)
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
    "Tests",
    `<section class="section">
      <div><span class="eyebrow">Tests</span><h1>Attempts and errors</h1><p class="lead">View results and incorrect answers, then open a student to reset or unlock a retake.</p></div>
      <form class="form-panel" method="get" action="/admin/tests">
        <h2>Filters</h2>
        <div class="admin-edit-grid">
          <div class="field"><label>Search</label><input name="q" value="${escapeHtml(params.q)}" placeholder="Student, email, course" /></div>
          <div class="field"><label>Student</label><select name="userId"><option value="">All students</option>${userSelectOptions(params.userId)}</select></div>
          <div class="field"><label>Course</label><select name="courseId"><option value="">All courses</option>${courseSelectOptions(params.courseId)}</select></div>
          <div class="field"><label>Result</label><select name="status">${testStatusOptions(params.status)}</select></div>
        </div>
        <div class="table-actions"><button class="small-button primary" type="submit">Apply</button><a class="small-button" href="/admin/tests">Reset</a></div>
      </form>
      <div class="grid three">
        <article class="metric"><span class="muted">Attempts</span><strong class="metric-value">${attempts.length}</strong></article>
        <article class="metric"><span class="muted">Passed</span><strong class="metric-value">${passed}</strong></article>
        <article class="metric"><span class="muted">Failed</span><strong class="metric-value">${attempts.length - passed}</strong></article>
      </div>
      <table class="table">
        <thead><tr><th>Student</th><th>Course</th><th>Attempt</th><th>Result</th><th>Date</th><th>Errors</th></tr></thead>
        <tbody>${attempts
          .map((attempt) => {
            const student = userById(attempt.userId);
            const assignment = db.assignments.find((item) => item.id === attempt.assignmentId);
            const course = assignment ? courseById(assignment.courseId) : null;
            return `<tr>
              <td><a class="link-line" href="/admin/users/${attempt.userId}">${escapeHtml(displayUserName(student) || student?.email || "")}</a><br><span class="muted">${escapeHtml(student?.email ?? "")}</span></td>
              <td>${escapeHtml(course?.title ?? "Course deleted")}</td>
              <td>${attempt.attemptNumber}</td>
              <td>${attempt.scorePercent}% ${badge(attempt.status === "passed" ? "test_passed" : "test_failed")}</td>
              <td>${new Date(attempt.finishedAt).toLocaleString("en-GB")}</td>
              <td>${attemptWrongAnswersHtml(attempt)}</td>
            </tr>`;
          })
          .join("") || `<tr><td colspan="6"><span class="muted">No attempts found.</span></td></tr>`}</tbody>
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
  const footer = homeFooterSettings();
  const selectionMode = db.settings?.homepageCourseSelectionEnabled
    ? `<div class="notice"><strong>Course showcase configured.</strong><br>Only selected active courses appear on the home page.</div>`
    : `<div class="notice"><strong>The course showcase has not been saved yet.</strong><br>Until the first save, the home page automatically shows several active courses.</div>`;
  return adminShell(
    user,
    "Home page",
    `<section class="section">
      <div>
        <span class="eyebrow">Home page</span>
        <h1>Course showcase</h1>
        <p class="lead">Choose which courses appear on the first page and set their display order.</p>
      </div>
      ${selectionMode}
      <form class="form-panel" method="post" action="/admin/homepage/courses">
        <div class="section-heading">
          <div><h2>Courses on home page</h2><p class="muted">Active courses selected: ${selectedCount}</p></div>
          <button class="button" type="submit">Save showcase</button>
        </div>
        <table class="table">
          <thead><tr><th>Display</th><th>Course</th><th>Status</th><th>Order</th></tr></thead>
          <tbody>${courses
            .map(
              (course) => `<tr>
                <td><label class="checkbox-row"><input name="showOnHome" type="checkbox" value="${course.id}" ${course.showOnHome ? "checked" : ""} /> Show on home page</label></td>
                <td><div class="course-title-cell admin-course-title-cell">${courseCoverHtml(course, "admin-course-avatar")}<strong>${escapeHtml(course.title)}</strong></div></td>
                <td>${badge(course.status)}</td>
                <td><input name="homeSortOrder:${course.id}" type="number" min="1" value="${courseHomeSortValue(course)}" /></td>
              </tr>`
            )
            .join("")}</tbody>
        </table>
        <div class="table-actions"><button class="button" type="submit">Save showcase</button><a class="button secondary" href="/">Open home page</a></div>
      </form>
      <form class="form-panel" method="post" action="/admin/homepage/footer">
        <h2>Home page footer</h2>
        <div class="admin-edit-grid">
          <div class="field"><label>Policies heading</label><input name="policiesTitle" value="${escapeHtml(footer.policiesTitle)}" required /></div>
          <div class="field"><label>Form heading</label><input name="feedbackTitle" value="${escapeHtml(footer.feedbackTitle)}" required /></div>
        </div>
        <div class="admin-edit-grid">
          <div class="field"><label>Link 1 text</label><input name="termsLabel" value="${escapeHtml(footer.termsLabel)}" required /></div>
          <div class="field"><label>Link 1 URL</label><input name="termsUrl" value="${escapeHtml(footer.termsUrl)}" required /></div>
          <div class="field"><label>Link 2 text</label><input name="privacyLabel" value="${escapeHtml(footer.privacyLabel)}" required /></div>
          <div class="field"><label>Link 2 URL</label><input name="privacyUrl" value="${escapeHtml(footer.privacyUrl)}" required /></div>
          <div class="field"><label>Link 3 text</label><input name="userPolicyLabel" value="${escapeHtml(footer.userPolicyLabel)}" required /></div>
          <div class="field"><label>Link 3 URL</label><input name="userPolicyUrl" value="${escapeHtml(footer.userPolicyUrl)}" required /></div>
        </div>
        <div class="field"><label>Content for “${escapeHtml(footer.termsLabel)}”</label><textarea name="termsContent" rows="8">${escapeHtml(footer.termsContent)}</textarea></div>
        <div class="field"><label>Content for “${escapeHtml(footer.privacyLabel)}”</label><textarea name="privacyContent" rows="8">${escapeHtml(footer.privacyContent)}</textarea></div>
        <div class="field"><label>Content for “${escapeHtml(footer.userPolicyLabel)}”</label><textarea name="userPolicyContent" rows="8">${escapeHtml(footer.userPolicyContent)}</textarea></div>
        <div class="admin-edit-grid">
          <div class="field"><label>Name placeholder</label><input name="namePlaceholder" value="${escapeHtml(footer.namePlaceholder)}" required /></div>
          <div class="field"><label>Email placeholder</label><input name="emailPlaceholder" value="${escapeHtml(footer.emailPlaceholder)}" required /></div>
          <div class="field"><label>Subject placeholder</label><input name="subjectPlaceholder" value="${escapeHtml(footer.subjectPlaceholder)}" required /></div>
          <div class="field"><label>Message placeholder</label><input name="messagePlaceholder" value="${escapeHtml(footer.messagePlaceholder)}" required /></div>
          <div class="field"><label>Button text</label><input name="submitLabel" value="${escapeHtml(footer.submitLabel)}" required /></div>
        </div>
        <button class="button" type="submit">Save footer</button>
      </form>
    </section>`
  );
}

function adminCourses(user, searchParams = new URLSearchParams()) {
  const params = listParams(searchParams);
  const courses = db.courses.filter((course) =>
    matchesQuery([course.title, course.shortDescription, course.fullDescription, course.goals, course.oldPrice, course.newPrice, course.status], params.q)
  );
  const pagination = paginateItems(courses, params);
  return adminShell(
    user,
    "Courses",
    `<section class="section">
      <div class="section-heading">
        <div><span class="eyebrow">Courses</span><h1>Course management</h1><p class="lead">A course consists of lessons, required materials, and a final test.</p></div>
        <div class="table-actions"><a class="button secondary" href="/admin/course-prices">Course prices</a><a class="button secondary" href="/admin/homepage">Configure home page</a></div>
      </div>
      <form class="inline-form" method="get" action="/admin/courses">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Search courses" />
        <button class="small-button primary" type="submit">Search</button>
      </form>
      <form class="form-panel" method="post" action="/admin/courses/create" enctype="multipart/form-data">
        <h2>Create course</h2>
        <div class="field"><label>Title</label><input name="title" required /></div>
        <div class="field"><label>Short description</label><textarea name="shortDescription" required></textarea></div>
        <div class="field"><label>Learning objectives</label><textarea name="goals"></textarea></div>
        <div class="admin-edit-grid">
          <div class="field"><label>Old price</label><input name="oldPrice" placeholder="e.g. 250 USD" /></div>
          <div class="field"><label>New price</label><input name="newPrice" placeholder="e.g. 199 USD" /></div>
        </div>
        ${courseCatalogFields({})}
        <div class="field"><label>Course cover</label><input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></div>
        <div class="admin-edit-grid">
          <label class="checkbox-row"><input name="showOnHome" type="checkbox" /> Show on home page</label>
          <div class="field"><label>Home page order</label><input name="homeSortOrder" type="number" min="1" value="999" /></div>
        </div>
        <button class="button" type="submit">Create course</button>
      </form>
      <table class="table">
        <thead><tr><th>Course</th><th>Price</th><th>Home page</th><th>Status</th><th>Materials</th><th>Test</th><th>Actions</th></tr></thead>
        <tbody>${pagination.items
          .map((course) => `<tr>
            <td><div class="course-title-cell admin-course-title-cell">${courseCoverHtml(course, "admin-course-avatar")}<strong>${escapeHtml(course.title)}</strong></div></td>
            <td>${coursePriceHtml(course, { showEmpty: true })}</td>
            <td>${course.showOnHome ? `<span class="status-pill">Shown</span><br><span class="muted">#${courseHomeSortValue(course)}</span>` : `<span class="muted">No</span>`}</td>
            <td>${badge(course.status)}</td>
            <td>${requiredMaterials(course).length} required</td>
            <td>${course.test?.questions.length ?? 0} questions, pass mark ${course.test?.passingPercent ?? 0}%</td>
            <td><a class="small-button primary" href="/admin/courses/${course.id}">Edit</a></td>
          </tr>`)
          .join("") || `<tr><td colspan="7"><span class="muted">No courses found.</span></td></tr>`}</tbody>
      </table>
      ${paginationControls("/admin/courses", params, pagination)}
    </section>`
  );
}

function coursePriceParams(searchParams = new URLSearchParams()) {
  const status = searchParams.get("status") ?? "";
  return {
    q: (searchParams.get("q") ?? "").trim(),
    status: ["active", "inactive"].includes(status) ? status : ""
  };
}

function coursePriceStatusOptions(selectedStatus) {
  return ["", "active", "inactive"]
    .map((status) => `<option value="${status}" ${selectedStatus === status ? "selected" : ""}>${status ? statusLabel(status) : "All statuses"}</option>`)
    .join("");
}

function filteredCoursePrices(params) {
  return [...db.courses]
    .filter((course) => !params.status || course.status === params.status)
    .filter((course) => matchesQuery([course.title, course.shortDescription, course.oldPrice, course.newPrice, statusLabel(course.status)], params.q))
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

function adminCoursePrices(user, searchParams = new URLSearchParams()) {
  const params = coursePriceParams(searchParams);
  const courses = filteredCoursePrices(params);
  const exportHref = `/admin/course-prices/export.xls${reportQuery(params)}`;
  const returnTo = `/admin/course-prices${reportQuery(params)}`;
  return adminShell(
    user,
    "Course prices",
    `<section class="section">
      <div class="section-heading">
        <div><span class="eyebrow">Prices</span><h1>Prices for all courses</h1></div>
        <button class="button" form="course-prices-form" type="submit">Save prices</button>
      </div>
      <form class="form-panel" method="get" action="/admin/course-prices">
        <h2>Filter</h2>
        <div class="admin-edit-grid">
          <div class="field"><label>Search</label><input name="q" value="${escapeHtml(params.q)}" placeholder="Course or price" /></div>
          <div class="field"><label>Status</label><select name="status">${coursePriceStatusOptions(params.status)}</select></div>
        </div>
        <div class="table-actions"><button class="small-button primary" type="submit">Show</button><a class="small-button" href="/admin/course-prices">Reset</a><a class="small-button warning" href="${exportHref}">Export Excel</a></div>
      </form>
      <form id="course-prices-form" class="form-panel" method="post" action="/admin/course-prices/update">
        <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
        <table class="table course-prices-table">
          <thead><tr><th>Course</th><th>Old price</th><th>New price</th></tr></thead>
          <tbody>${courses
            .map((course) => `<tr>
              <td class="course-name-cell">${escapeHtml(course.title)}</td>
              <td><input name="oldPrice:${course.id}" value="${escapeHtml(course.oldPrice ?? "")}" placeholder="e.g. 250 USD" /></td>
              <td><input name="newPrice:${course.id}" value="${escapeHtml(course.newPrice ?? "")}" placeholder="e.g. 199 USD" /></td>
            </tr>`)
            .join("") || `<tr><td colspan="3"><span class="muted">No courses found.</span></td></tr>`}</tbody>
        </table>
        <div class="table-actions"><button class="button" type="submit">Save prices</button></div>
      </form>
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
    "Files",
    `<section class="section">
      <div><span class="eyebrow">Files and video</span><h1>Learning file check</h1><p class="lead">This report compares course materials with files in data/uploads and helps find broken links after import.</p></div>
      <form class="inline-form" method="get" action="/admin/files">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Search course, lesson, or file" />
        <button class="small-button primary" type="submit">Search</button>
        <a class="small-button" href="/admin/files">Reset</a>
        <a class="small-button" href="/admin/files/import-report.csv">Export import report</a>
      </form>
      <form method="post" action="/admin/files/auto-link-videos">
        <button class="small-button warning" type="submit">Auto-link videos by title</button>
      </form>
      <div class="grid four">
        <article class="metric"><span class="muted">Files in uploads</span><strong class="metric-value">${report.uploadFiles.length}</strong></article>
        <article class="metric"><span class="muted">Files in materials</span><strong class="metric-value">${report.materialFiles.length}</strong></article>
        <article class="metric"><span class="muted">Broken links</span><strong class="metric-value">${report.missingMaterialFiles.length}</strong></article>
        <article class="metric"><span class="muted">Videos without lessons</span><strong class="metric-value">${report.unlinkedVideos.length}</strong></article>
      </div>
      <article class="panel stack">
        <h2>Materials with missing files</h2>
        <table class="table">
          <thead><tr><th>Course</th><th>Lesson</th><th>Material</th><th>Path</th></tr></thead>
          <tbody>${missingFiles
            .map((item) => `<tr>
              <td>${escapeHtml(item.course.title)}</td>
              <td>${escapeHtml(item.lesson.title)}</td>
              <td>${escapeHtml(item.material.title)}<br><span class="muted">${escapeHtml(item.material.type)}</span></td>
              <td><span class="link-line">${escapeHtml(item.publicPath)}</span></td>
            </tr>`)
            .join("") || `<tr><td colspan="4"><span class="muted">No broken links to local files found.</span></td></tr>`}</tbody>
        </table>
      </article>
      <article class="panel stack">
        <h2>Videos in uploads not linked to lessons</h2>
        <table class="table">
          <thead><tr><th>File</th><th>Size</th><th>Modified</th><th>Actions</th></tr></thead>
          <tbody>${unlinkedVideos
            .map((file) => `<tr>
              <td><span class="link-line">${escapeHtml(file.relativePath)}</span></td>
              <td>${formatBytes(file.size)}</td>
              <td>${formatDate(file.modifiedAt)}</td>
              <td><div class="table-actions">
                <a class="small-button primary" href="${escapeHtml(file.publicPath)}" target="_blank" rel="noopener">Open</a>
                ${lessonOptions ? `<form class="inline-form" method="post" action="/admin/files/link-video">
                  <input type="hidden" name="publicPath" value="${escapeHtml(file.publicPath)}" />
                  <input name="title" value="${escapeHtml(file.relativePath.split("/").at(-1) ?? "Video")}" />
                  <select name="lessonRef">${lessonOptions}</select>
                  <label class="checkbox-row"><input name="isRequired" type="checkbox" checked /> required</label>
                  <button class="small-button warning" type="submit">Link</button>
                </form>` : `<span class="muted">Create a lesson first.</span>`}
              </div></td>
            </tr>`)
            .join("") || `<tr><td colspan="4"><span class="muted">No unlinked videos found.</span></td></tr>`}</tbody>
        </table>
        ${filteredUnlinkedVideos.length > unlinkedVideos.length ? `<p class="muted">The first 50 videos are shown. Use search to narrow the list.</p>` : ""}
      </article>
      <article class="panel stack">
        <h2>Imported WordPress/Tutor LMS courses</h2>
        <table class="table">
          <thead><tr><th>Course</th><th>WP ID</th><th>Lessons</th><th>Materials</th><th>Videos</th><th>Missing files</th><th>Actions</th></tr></thead>
          <tbody>${importedCourses
            .map((item) => `<tr>
              <td>${escapeHtml(item.course.title)}</td>
              <td>${escapeHtml(item.course.source?.wpCourseId ?? "")}</td>
              <td>${item.lessons}</td>
              <td>${item.materials}</td>
              <td>${item.videos}</td>
              <td>${item.missing ? `<span class="badge warning">${item.missing}</span>` : `<span class="badge success">0</span>`}</td>
              <td><a class="small-button primary" href="/admin/courses/${item.course.id}">Open course</a></td>
            </tr>`)
            .join("") || `<tr><td colspan="7"><span class="muted">No imported courses found.</span></td></tr>`}</tbody>
        </table>
      </article>
      <article class="panel stack">
        <h2>Empty imported courses and lessons</h2>
        <table class="table">
          <thead><tr><th>Type</th><th>Course</th><th>Lesson</th><th>Actions</th></tr></thead>
          <tbody>${[
            ...importedCourses
              .filter((item) => item.lessons === 0 || item.materials === 0)
              .map((item) => `<tr><td>${item.lessons === 0 ? "Course without lessons" : "Course without materials"}</td><td>${escapeHtml(item.course.title)}</td><td><span class="muted">-</span></td><td><a class="small-button primary" href="/admin/courses/${item.course.id}">Open</a></td></tr>`),
            ...emptyImportedLessons.map(({ course, lesson }) => `<tr><td>Lesson without materials</td><td>${escapeHtml(course.title)}</td><td>${escapeHtml(lesson.title)}</td><td><a class="small-button primary" href="/admin/courses/${course.id}">Open</a></td></tr>`)
          ].join("") || `<tr><td colspan="4"><span class="muted">No empty imported courses or lessons found.</span></td></tr>`}</tbody>
        </table>
      </article>
      <article class="panel stack">
        <h2>Files not linked to lessons</h2>
        <table class="table">
          <thead><tr><th>File</th><th>Size</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${unlinkedUploads
            .map((file) => `<tr>
              <td><span class="link-line">${escapeHtml(file.relativePath)}</span></td>
              <td>${formatBytes(file.size)}</td>
              <td>${file.usedAsPhoto ? `<span class="badge success">Student photo</span>` : `<span class="badge warning">Not linked</span>`}</td>
              <td><a class="small-button primary" href="${escapeHtml(file.publicPath)}" target="_blank" rel="noopener">Open</a></td>
            </tr>`)
            .join("") || `<tr><td colspan="4"><span class="muted">No unlinked files found.</span></td></tr>`}</tbody>
        </table>
        ${filteredUnlinkedUploads.length > unlinkedUploads.length ? `<p class="muted">The first 50 files are shown. Use search to narrow the list.</p>` : ""}
      </article>
      <article class="panel stack">
        <h2>Materials with local files</h2>
        <table class="table">
          <thead><tr><th>Course</th><th>Lesson</th><th>Material</th><th>File</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${pagination.items
            .map((item) => `<tr>
              <td>${escapeHtml(item.course.title)}</td>
              <td>${escapeHtml(item.lesson.title)}</td>
              <td>${escapeHtml(item.material.title)}<br><span class="muted">${escapeHtml(item.material.type)}</span></td>
              <td><span class="link-line">${escapeHtml(item.relativePath)}</span><br><span class="muted">${formatBytes(item.size)}</span></td>
              <td>${fileBadge(item.exists)}</td>
              <td>${item.exists ? `<a class="small-button primary" href="${escapeHtml(item.publicPath)}" target="_blank" rel="noopener">Open</a>` : ""}</td>
            </tr>`)
            .join("") || `<tr><td colspan="6"><span class="muted">No local files in materials found.</span></td></tr>`}</tbody>
        </table>
        ${paginationControls("/admin/files", params, pagination)}
      </article>
    </section>`
  );
}

function adminCourseDetail(user, course) {
  const previewCertificate = sampleCertificateForCourse(course);
  const certificateDesignerBlock = certificateDesignerEditorHtml(course, previewCertificate);
  const deletionUsage = courseDeletionUsage(course.id);
  const deletionDetails = [
    deletionUsage.assignments ? `assignments: ${deletionUsage.assignments}` : "",
    deletionUsage.applications ? `applications: ${deletionUsage.applications}` : "",
    deletionUsage.certificates ? `certificates: ${deletionUsage.certificates}` : ""
  ].filter(Boolean).join(", ");
  return adminShell(
    user,
    course.title,
    `<section class="section">
      <div><span class="eyebrow">Course editor</span><h1>${escapeHtml(course.title)}</h1><p class="lead">${escapeHtml(course.fullDescription || course.shortDescription)}</p></div>
      ${certificateDesignerBlock}
      <form class="form-panel" method="post" action="/admin/courses/${course.id}/update" enctype="multipart/form-data">
        <h2>Course details</h2>
        ${courseCoverHtml(course, "editor")}
        <div class="field"><label>Title</label><input name="title" value="${escapeHtml(course.title)}" required /></div>
        <div class="field"><label>Short description</label><textarea name="shortDescription" required>${escapeHtml(course.shortDescription)}</textarea></div>
        <div class="field"><label>Full description</label><textarea name="fullDescription">${escapeHtml(course.fullDescription || "")}</textarea></div>
        <div class="field"><label>Learning objectives</label><textarea name="goals">${escapeHtml(course.goals || "")}</textarea></div>
        ${courseCatalogFields(course)}
        <div class="admin-edit-grid">
          <div class="field"><label>Old price</label><input name="oldPrice" value="${escapeHtml(course.oldPrice ?? "")}" placeholder="e.g. 250 USD" /></div>
          <div class="field"><label>New price</label><input name="newPrice" value="${escapeHtml(course.newPrice ?? "")}" placeholder="e.g. 199 USD" /></div>
        </div>
        <div class="admin-edit-grid">
          <div class="field"><label>Replace cover image</label><input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></div>
          <label class="checkbox-row"><input name="removeImage" type="checkbox" /> Remove cover image</label>
        </div>
        <div class="admin-edit-grid">
          <label class="checkbox-row"><input name="showOnHome" type="checkbox" ${course.showOnHome ? "checked" : ""} /> Show on home page</label>
          <div class="field"><label>Home page order</label><input name="homeSortOrder" type="number" min="1" value="${courseHomeSortValue(course)}" /></div>
        </div>
        <div class="field"><label>Status</label><select name="status"><option value="active" ${course.status === "active" ? "selected" : ""}>Active</option><option value="inactive" ${course.status === "inactive" ? "selected" : ""}>Inactive</option></select></div>
        <button class="button" type="submit">Save</button>
      </form>
      ${isFullAdmin(user) ? `<article class="panel stack">
        <h2>Delete course</h2>
        ${courseDeletionBlocked(deletionUsage)
          ? `<p class="muted">This course cannot be deleted: ${escapeHtml(deletionDetails)}. Delete or move the related data first.</p>`
          : `<p class="muted">Deletion permanently removes the course, lessons, materials, and test.</p><form method="post" action="/admin/courses/${course.id}/delete" onsubmit="return confirm('Permanently delete this course?');"><button class="small-button danger" type="submit">Delete course</button></form>`}
      </article>` : ""}
      <article class="panel certificate-template">
        <h2>Certificate template</h2>
        <p class="muted">The certificate expiry date is always calculated automatically: issue date plus 5 years.</p>
        <div class="template-token-list">
          <code>{{firstName}}</code><code>{{lastName}}</code><code>{{fullName}}</code><code>{{birthDate}}</code><code>{{position}}</code><code>{{company}}</code><code>{{courseTitle}}</code><code>{{certificateNumber}}</code><code>{{issuedAt}}</code><code>{{expiresAt}}</code><code>{{photoImage}}</code><code>{{photoUrl}}</code><code>{{verificationUrl}}</code><code>{{qrCode}}</code>
        </div>
        <form class="stack" method="post" action="/admin/courses/${course.id}/certificate-template" enctype="multipart/form-data">
          <div class="field"><label>HTML template</label><textarea name="certificateTemplateHtml">${escapeHtml(course.certificateTemplateHtml || defaultCertificateTemplate())}</textarea></div>
          <div class="admin-edit-grid">
            <div class="field"><label>Upload HTML file</label><input name="templateFile" type="file" accept=".html,text/html,text/plain" /></div>
            <label class="checkbox-row"><input name="resetTemplate" type="checkbox" /> Reset to base template</label>
          </div>
          <button class="button" type="submit">Save template</button>
        </form>
        <div class="certificate-preview-actions">
          <a class="small-button primary" href="/admin/courses/${course.id}/certificate-template/preview">Open preview</a>
          <span class="muted">The sample shows the current HTML template with test student data.</span>
        </div>
        <div class="certificate-preview-frame">
          <div class="${certificateShellClass(previewCertificate.certificateHtml, "certificate-preview")}">${previewCertificate.certificateHtml}</div>
        </div>
      </article>
      <article class="panel stack">
        <h2>Lessons and materials</h2>
        <div class="course-editor-list">${course.lessons
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(
            (lesson) => `<article class="lesson-editor">
              <form class="stack" method="post" action="/admin/courses/${course.id}/lessons/${lesson.id}/update">
                <div class="admin-edit-grid">
                  <div class="field"><label>Lesson title</label><input name="title" value="${escapeHtml(lesson.title)}" required /></div>
                  <div class="field"><label>Order</label><input name="sortOrder" type="number" min="1" value="${lesson.sortOrder}" /></div>
                  <div class="field"><label>Status</label><select name="status"><option value="active" ${lesson.status === "active" ? "selected" : ""}>Active</option><option value="inactive" ${lesson.status === "inactive" ? "selected" : ""}>Inactive</option></select></div>
                  <div class="field"><label>Description</label><input name="description" value="${escapeHtml(lesson.description || "")}" /></div>
                </div>
                <div class="table-actions">
                  <button class="small-button primary" type="submit">Save lesson</button>
                </div>
              </form>
              <form method="post" action="/admin/courses/${course.id}/lessons/${lesson.id}/delete">
                <button class="small-button danger" type="submit">Delete lesson</button>
              </form>
              ${lesson.materials
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((material) => `<form class="material-editor" method="post" action="/admin/courses/${course.id}/materials/${material.id}/update" enctype="multipart/form-data">
                  <div class="material-edit-grid">
                    <div class="field"><label>Material</label><input name="title" value="${escapeHtml(material.title)}" required /></div>
                    <div class="field"><label>Type</label><select name="type"><option value="text" ${material.type === "text" ? "selected" : ""}>Text</option><option value="video" ${material.type === "video" ? "selected" : ""}>Video</option><option value="pdf" ${material.type === "pdf" ? "selected" : ""}>PDF</option><option value="download" ${material.type === "download" ? "selected" : ""}>File</option><option value="image" ${material.type === "image" ? "selected" : ""}>Image</option></select></div>
                    <div class="field"><label>Order</label><input name="sortOrder" type="number" min="1" value="${material.sortOrder}" /></div>
                  </div>
                  <div class="field"><label>Text or link</label><input name="content" value="${escapeHtml(material.content || "")}" /></div>
                  ${materialContentHtml(material)}
                  <div class="admin-edit-grid">
                    <label class="checkbox-row"><input name="isRequired" type="checkbox" ${material.isRequired ? "checked" : ""} /> Required</label>
                    <div class="field"><label>Replace file</label><input name="file" type="file" /></div>
                  </div>
                  <div class="table-actions">
                    <button class="small-button primary" type="submit">Save material</button>
                  </div>
                </form>
                <form method="post" action="/admin/courses/${course.id}/materials/${material.id}/delete">
                  <button class="small-button danger" type="submit">Delete material</button>
                </form>`)
                .join("")}
              <form class="inline-form" method="post" action="/admin/courses/${course.id}/materials/create" enctype="multipart/form-data">
                <input type="hidden" name="lessonId" value="${lesson.id}" />
                <input name="title" placeholder="Material title" required />
                <select name="type"><option value="text">Text</option><option value="video">Video</option><option value="pdf">PDF</option><option value="download">File</option><option value="image">Image</option></select>
                <input name="content" placeholder="Text or link" />
                <label class="checkbox-row"><input name="isRequired" type="checkbox" checked /> Required</label>
                <input name="file" type="file" />
                <button class="small-button primary" type="submit">Add material</button>
              </form>
            </article>`
          )
          .join("")}</div>
        <form class="inline-form" method="post" action="/admin/courses/${course.id}/lessons/create">
          <input name="title" placeholder="Lesson title" required />
          <input name="description" placeholder="Description" />
          <button class="small-button primary" type="submit">Add lesson</button>
        </form>
      </article>
      <article class="panel stack">
        <h2>Final test</h2>
        <form class="inline-form" method="post" action="/admin/courses/${course.id}/test/settings">
          <input name="title" value="${escapeHtml(course.test?.title ?? "Final test")}" required />
          <input name="attemptsLimit" type="number" min="1" value="${course.test?.attemptsLimit ?? 3}" />
          <input name="passingPercent" type="number" min="1" max="100" value="${course.test?.passingPercent ?? 80}" />
          <input name="timeLimitMinutes" type="number" min="0" value="${course.test?.timeLimitMinutes ?? 0}" />
          <select name="status"><option value="active" ${course.test?.status === "active" ? "selected" : ""}>Active</option><option value="inactive" ${course.test?.status === "inactive" ? "selected" : ""}>Inactive</option></select>
          <label class="checkbox-row"><input name="showResultToUser" type="checkbox" ${course.test?.showResultToUser ? "checked" : ""} /> Show result</label>
          <label class="checkbox-row"><input name="allowRetake" type="checkbox" ${course.test?.allowRetake ? "checked" : ""} /> Allow retakes</label>
          <button class="small-button primary" type="submit">Save test</button>
        </form>
        ${(course.test?.questions ?? [])
          .map(
            (question) => {
              return `<article class="card stack">
                <form class="stack" method="post" action="/admin/courses/${course.id}/test/questions/${question.id}/update">
                  <div class="field"><label>Question</label><input name="questionText" value="${escapeHtml(question.questionText)}" required /></div>
                  <div class="admin-edit-grid">
                    ${questionEditorFields(question)}
                    <div class="field"><label>Order</label><input name="sortOrder" type="number" min="1" value="${question.sortOrder}" /></div>
                  </div>
                  <button class="small-button primary" type="submit">Save question</button>
                </form>
                <form method="post" action="/admin/courses/${course.id}/test/questions/${question.id}/delete">
                  <button class="small-button danger" type="submit">Delete question</button>
                </form>
              </article>`;
            }
          )
          .join("")}
        <form class="form-panel" method="post" action="/admin/courses/${course.id}/test/questions/create">
          <h3>Add question</h3>
          <div class="field"><label>Question</label><input name="questionText" required /></div>
          <div class="admin-edit-grid">${questionEditorFields()}</div>
          <button class="button" type="submit">Add question</button>
        </form>
        <a class="small-button primary" href="/admin/courses/${course.id}/test/preview">Preview test</a>
      </article>
    </section>`
  );
}

function adminCertificateTemplatePreview(user, course) {
  const previewCertificate = sampleCertificateForCourse(course);
  return adminShell(
    user,
    "Certificate preview",
    `<section class="section">
      <div>
        <span class="eyebrow">Certificate template</span>
        <h1>${escapeHtml(course.title)}</h1>
        <p class="lead">The preview uses test data and does not create a certificate in the database.</p>
      </div>
      <div class="actions">
        <a class="button secondary" href="/admin/courses/${course.id}">Back to course</a>
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
    <a class="small-button primary" href="/certificates/${certificate.id}">Open</a>
    <a class="small-button" href="/certificates/${certificate.id}.pdf">PDF</a>
    <a class="small-button" href="${escapeHtml(certificateVerificationUrl(certificate))}" target="_blank" rel="noopener">Verify</a>
    ${canRevoke ? `<form method="post" action="/admin/certificates/revoke"><input type="hidden" name="id" value="${certificate.id}" />${returnInput}<button class="small-button danger" type="submit">Revoke</button></form>` : ""}
    ${canReissue ? `<form method="post" action="/admin/certificates/reissue"><input type="hidden" name="id" value="${certificate.id}" />${returnInput}<button class="small-button warning" type="submit">Reissue</button></form>` : ""}
    <form method="post" action="/admin/certificates/resend"><input type="hidden" name="id" value="${certificate.id}" />${returnInput}<button class="small-button" type="submit">Resend</button></form>
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
    issued: "Issued automatically",
    manual_issue: "Issued manually",
    issued_after_student_photo: "Issued after student photo upload",
    issued_after_admin_photo: "Issued after administrator photo upload",
    revoked: "Revoked",
    reissued: "New certificate created on reissue",
    replaced_by_reissue: "Replaced on reissue",
    resent: "Sent again"
  };
  return labels[action] ?? action;
}

function certificateEventActorLabel(event) {
  if (!event.actorEmail || event.actorEmail === "system") return "System";
  return `${event.actorEmail} (${event.actorRole})`;
}

function certificateEventDetailsText(details = {}) {
  const labels = {
    assignmentId: "Assignment",
    replacesCertificateId: "Replaces ID",
    newCertificateId: "New ID",
    newCertificateNumber: "New number"
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
    <h2>Certificate activity log</h2>
    <table class="table">
      <thead><tr><th>Date</th><th>Number</th><th>Student</th><th>Action</th><th>Actor</th><th>Details</th></tr></thead>
      <tbody>${events
        .map((event) => {
          const student = userById(event.userId);
          const details = certificateEventDetailsText(event.details);
          return `<tr>
            <td>${new Date(event.createdAt).toLocaleString("en-GB")}</td>
            <td>${escapeHtml(event.certificateNumber)}</td>
            <td>${escapeHtml(displayUserName(student))}<br><span class="muted">${escapeHtml(student?.email ?? "")}</span></td>
            <td>${escapeHtml(certificateEventActionLabel(event.action))}</td>
            <td>${escapeHtml(certificateEventActorLabel(event))}</td>
            <td><div class="certificate-event-detail">${details ? escapeHtml(details) : "—"}</div></td>
          </tr>`;
        })
        .join("") || `<tr><td colspan="6"><span class="muted">No actions yet.</span></td></tr>`}</tbody>
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
    ["", "All statuses"],
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
    <h2>Certificate filters</h2>
    <div class="admin-edit-grid">
      <div class="field"><label>Search</label><input name="q" value="${escapeHtml(filters.q)}" placeholder="Number, student, email, or course" /></div>
      <div class="field"><label>Student</label><select name="userId"><option value="">All students</option>${students
        .map((student) => `<option value="${student.id}" ${filters.userId === student.id ? "selected" : ""}>${escapeHtml(displayUserName(student) || student.email)} (${escapeHtml(student.email)})</option>`)
        .join("")}</select></div>
      <div class="field"><label>Course</label><select name="courseId"><option value="">All courses</option>${courses
        .map((course) => `<option value="${course.id}" ${filters.courseId === course.id ? "selected" : ""}>${escapeHtml(course.title)}</option>`)
        .join("")}</select></div>
      <div class="field"><label>Status</label><select name="status">${certificateStatusOptions(filters.status)}</select></div>
      <div class="field"><label>Issued from</label><input name="issuedFrom" type="date" value="${escapeHtml(filters.issuedFrom)}" /></div>
      <div class="field"><label>Issued to</label><input name="issuedTo" type="date" value="${escapeHtml(filters.issuedTo)}" /></div>
    </div>
    <div class="table-actions">
      <button class="small-button primary" type="submit">Apply</button>
      <a class="small-button" href="/admin/certificates">Reset</a>
      <a class="small-button" href="${escapeHtml(csvExportHref)}">Export CSV</a>
      <a class="small-button" href="${escapeHtml(excelExportHref)}">Excel register</a>
    </div>
  </form>`;
}

function certificateExportRows(searchParams = new URLSearchParams()) {
  const filters = certificateFilterParams(searchParams);
  const certificates = filteredCertificates(filters);
  return [
    [
      "Number",
      "Status",
      "Student",
      "Email",
      "Position",
      "Company",
      "Course",
      "Issue date",
      "Expiry date",
      "QR verification",
      "Certificate ID",
      "Assignment ID"
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

function excelTableHtml(title, rows) {
  return `<h2>${escapeHtml(title)}</h2>
  <table>
    <thead><tr>${(rows[0] ?? []).map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .slice(1)
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
      .join("")}</tbody>
  </table>`;
}

function excelDocument(title, tables) {
  return `\uFEFF<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Arial, sans-serif; }
    h1 { color: #0b4f7a; }
    h2 { margin-top: 22px; color: #0b4f7a; }
    table { border-collapse: collapse; margin-bottom: 18px; }
    th, td { border: 1px solid #8aaac1; padding: 6px 8px; mso-number-format: "\\@"; }
    th { background: #0b4f7a; color: #ffffff; font-weight: 700; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${tables.map((table) => excelTableHtml(table.title, table.rows)).join("")}
</body>
</html>`;
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

function checksExcel(searchParams = new URLSearchParams()) {
  const params = invoiceFilterParams(searchParams);
  const assignments = invoiceAssignmentData(params);
  const registeredStudents = db.users.filter((student) => student.role === "student" && assignments.some((assignment) => assignment.userId === student.id));
  const currencies = new Set(assignments.map((assignment) => courseRevenuePrice(courseById(assignment.courseId)).currency).filter(Boolean));
  const total = assignments.reduce((sum, assignment) => sum + courseRevenuePrice(courseById(assignment.courseId)).amount, 0);
  const assignedStudentIds = new Set(assignments.map((assignment) => assignment.userId));
  const staff = userById(params.staffId);
  const filterRows = [
    ["Parameter", "Value"],
    ["Staff member", params.staffId ? displayUserName(staff) || staff?.email || "Not found" : "All administrators and instructors"],
    ["From", params.from || "Not specified"],
    ["To", params.to || "Not specified"],
    ["Registered students", registeredStudents.length],
    ["Assigned courses", assignments.length],
    ["Unique assigned students", assignedStudentIds.size],
    ["Total amount", formatReportMoney(total, currencies)]
  ];
  const assignmentRows = [
    ["Staff member", "Student", "Email", "Course", "Old price", "New price", "Included amount", "Assignment date"],
    ...assignments.map((assignment) => {
      const student = userById(assignment.userId);
      const course = courseById(assignment.courseId);
      const assignedBy = userById(assignment.assignedById);
      const price = courseRevenuePrice(course);
      return [
        displayUserName(assignedBy) || assignedBy?.email || "Not specified",
        displayUserName(student) || student?.email || "Student deleted",
        student?.email ?? "",
        course?.title ?? "Course deleted",
        course?.oldPrice || "",
        course?.newPrice || "",
        formatReportMoney(price.amount, new Set(price.currency ? [price.currency] : [])),
        new Date(assignment.assignedAt).toLocaleDateString("en-GB")
      ];
    })
  ];
  const registeredRows = [
    ["Staff member", "Student", "Email", "Assignments in period", "Registration date"],
    ...registeredStudents.map((student) => {
      const creator = userById(student.createdById);
      const assignmentCount = assignments.filter((assignment) => assignment.userId === student.id).length;
      return [
        displayUserName(creator) || creator?.email || "Not specified",
        displayUserName(student) || student.email,
        student.email,
        assignmentCount,
        new Date(student.createdAt).toLocaleDateString("en-GB")
      ];
    })
  ];
  return excelDocument("Checks and assignments", [
    { title: "Summary and filters", rows: filterRows },
    { title: "Courses and amounts", rows: assignmentRows },
    { title: "Registered students", rows: registeredRows }
  ]);
}

function sendChecksExcel(response, searchParams = new URLSearchParams()) {
  const fileDate = new Date().toISOString().slice(0, 10);
  response.writeHead(200, {
    "Content-Type": "application/vnd.ms-excel; charset=utf-8",
    "Content-Disposition": `attachment; filename="checks-${fileDate}.xls"`
  });
  response.end(searchParams.get("legacy") === "1" ? checksExcel(searchParams) : invoiceReportExcel(searchParams));
}

function adminInvoiceTemplate(user) {
  const template = invoiceTemplateSettings();
  const field = (name, label, options = {}) => `<div class="field${options.wide ? " field-wide" : ""}"><label>${label}</label>${options.textarea ? `<textarea name="${name}" rows="${options.rows || 3}">${escapeHtml(template[name] || "")}</textarea>` : `<input name="${name}" value="${escapeHtml(template[name] || "")}" />`}</div>`;
  return adminShell(user, "Invoice template", `<section class="section stack"><div class="toolbar"><div><span class="eyebrow">Invoices</span><h1>Invoice template</h1><p class="lead">The values below are used for every newly generated invoice and PDF. Existing invoices can be re-generated from their page.</p></div><a class="small-button" href="/admin/checks">Back to invoices</a></div><form class="form-panel stack" method="post" action="/admin/checks/template"><div class="admin-edit-grid">${field("academyName", "Organisation name", { wide: true })}${field("academySubtitle", "Organisation subtitle", { wide: true })}${field("address", "Address", { wide: true, textarea: true, rows: 2 })}${field("contacts", "Contact line", { wide: true, textarea: true, rows: 2 })}${field("iban", "IBAN")}${field("paymentDetails", "Details of payment", { textarea: true, rows: 3 })}${field("beneficiaryBank", "Beneficiary's bank", { wide: true, textarea: true, rows: 3 })}${field("correspondentBank", "Correspondent bank", { wide: true, textarea: true, rows: 3 })}${field("directorName", "Director signature label")}${field("accountantName", "Accountant signature label")}${field("footerNote", "Footer note", { wide: true, textarea: true, rows: 2 })}</div><div class="table-actions"><button class="button" type="submit">Save invoice template</button><a class="small-button" href="/admin/checks">Cancel</a></div></form></section>`);
}

function invoiceReportExcel(searchParams = new URLSearchParams()) {
  const params = invoiceFilterParams(searchParams);
  const lines = invoiceAssignmentData(params).map(invoiceLineFromAssignment);
  const rows = [
    params.columns.map(invoiceColumnLabel),
    ...lines.map((line) => params.columns.map((key) => invoiceColumnText(line, key)))
  ];
  const filterRows = [
    ["Parameter", "Value"],
    ["Period", `${params.from || "-"} - ${params.to || "-"}`],
    ["Period event", params.event],
    ["Grouping", params.groupBy],
    ["Columns", params.columns.map(invoiceColumnLabel).join(", ")],
    ["Courses in export", lines.length]
  ];
  return excelDocument("Invoice report", [
    { title: "Filters", rows: filterRows },
    { title: "Invoice report", rows }
  ]);
}

function coursePricesExcel(searchParams = new URLSearchParams()) {
  const params = coursePriceParams(searchParams);
  const courses = filteredCoursePrices(params);
  const rows = [
    ["Course", "Status", "Old price", "New price"],
    ...courses.map((course) => [course.title, statusLabel(course.status), course.oldPrice || "", course.newPrice || ""])
  ];
  const filterRows = [
    ["Parameter", "Value"],
    ["Search", params.q || "Not specified"],
    ["Status", params.status ? statusLabel(params.status) : "All statuses"],
    ["Courses in export", courses.length]
  ];
  return excelDocument("Course prices", [
    { title: "Filter", rows: filterRows },
    { title: "Price list", rows }
  ]);
}

function sendCoursePricesExcel(response, searchParams = new URLSearchParams()) {
  const fileDate = new Date().toISOString().slice(0, 10);
  response.writeHead(200, {
    "Content-Type": "application/vnd.ms-excel; charset=utf-8",
    "Content-Disposition": `attachment; filename="course-prices-${fileDate}.xls"`
  });
  response.end(coursePricesExcel(searchParams));
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

function auditActionLabel(action = "") {
  const exact = {
    "/admin/users/create": "New user registered",
    "/admin/assignments/create": "Course assigned to student",
    "/admin/course-prices/update": "Course prices updated",
    "/admin/courses/create": "New course created",
    "/admin/homepage/courses": "Home page course showcase updated",
    "/admin/homepage/footer": "Home page footer updated",
    "/admin/notifications/send-pending": "Email queue sent",
    "/admin/notifications/templates": "Email templates updated",
    "/admin/notifications/test-smtp": "SMTP connection checked"
  };
  if (exact[action]) return exact[action];
  if (/^\/admin\/users\/[^/]+\/update$/.test(action)) return "User details updated";
  if (/^\/admin\/users\/[^/]+\/photo$/.test(action)) return "User photo updated";
  if (/^\/admin\/users\/[^/]+\/delete$/.test(action)) return "User deleted";
  if (/^\/admin\/courses\/[^/]+\/update$/.test(action)) return "Course information updated";
  if (/^\/admin\/courses\/[^/]+\/delete$/.test(action)) return "Course deleted";
  if (/^\/admin\/courses\/[^/]+\/certificate-template$/.test(action)) return "Course certificate template updated";
  if (/^\/admin\/courses\/[^/]+\/certificate-designer$/.test(action)) return "Certificate visual template updated";
  if (/^\/admin\/courses\/[^/]+\/lessons\/create$/.test(action)) return "Lesson added";
  if (/^\/admin\/courses\/[^/]+\/lessons\/[^/]+\/update$/.test(action)) return "Lesson updated";
  if (/^\/admin\/courses\/[^/]+\/lessons\/[^/]+\/delete$/.test(action)) return "Lesson deleted";
  if (/^\/admin\/courses\/[^/]+\/materials\/create$/.test(action)) return "Course material added";
  if (/^\/admin\/courses\/[^/]+\/materials\/[^/]+\/update$/.test(action)) return "Course material updated";
  if (/^\/admin\/courses\/[^/]+\/materials\/[^/]+\/delete$/.test(action)) return "Course material deleted";
  if (/^\/admin\/certificates\//.test(action)) return "Certificate status updated";
  if (/^\/admin\/assignments\//.test(action)) return "Learning progress updated";
  if (/^\/admin\/checks\//.test(action)) return "Checks or invoices updated";
  return "Administrative action";
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
      ? `<div class="notice"><strong>Student certificates:</strong> ${escapeHtml(displayUserName(selectedStudent))} (${escapeHtml(selectedStudent.email)}) <a class="small-button" href="/admin/certificates">Show all</a></div>`
      : `<div class="notice danger">The student for the selected filter was not found. <a class="small-button" href="/admin/certificates">Show all</a></div>`
    : "";
  return adminShell(
    user,
    "Certificates",
    `<section class="section">
      <div><span class="eyebrow">Certificates</span><h1>Issued certificates</h1><p class="lead">Each certificate is linked to a specific student, course, and assignment.</p></div>
      ${selectedStudentNotice}
      ${certificateFilterForm(filters)}
      <table class="table">
        <thead><tr><th>Number</th><th>Student</th><th>Course</th><th>Issue date</th><th>Expires</th><th>Actions</th></tr></thead>
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
          .join("") || `<tr><td colspan="6"><span class="muted">No certificates have been issued yet.</span></td></tr>`}</tbody>
      </table>
      ${pendingCertificates.length
        ? `<article class="panel stack">
            <h2>Awaiting student photo</h2>
            ${pendingCertificates.map((assignment) => {
              const student = userById(assignment.userId);
              const course = courseById(assignment.courseId);
              return `<div class="assignment-chip"><span>${escapeHtml(displayUserName(student))}<br><span class="muted">${escapeHtml(student?.email ?? "")}</span></span><span>${escapeHtml(course?.title ?? "")}</span><span class="muted">The certificate will be created after a photo is uploaded.</span></div>`;
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
    "Notifications",
    `<section class="section">
      <div><span class="eyebrow">Email log</span><h1>Notifications</h1><p class="lead">Without SMTP, events remain in the log. When SMTP is configured through environment variables, the queue can be sent from this page.</p></div>
      <article class="panel stack">
        <h2>SMTP</h2>
        <p class="muted">Status: ${smtpConfigured() ? "SMTP configured; new email enters the queue" : "SMTP is not configured; notifications are saved as a log"}</p>
        <div class="table-actions">
          <form method="post" action="/admin/notifications/test-smtp" class="inline-form">
            <input name="email" type="email" value="${escapeHtml(user.email)}" required />
            <button class="small-button primary" type="submit">Test SMTP</button>
          </form>
          <form method="post" action="/admin/notifications/send-pending">
            <button class="small-button primary" type="submit">Send SMTP queue</button>
          </form>
        </div>
      </article>
      <form class="inline-form" method="get" action="/admin/notifications">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Search log" />
        <button class="small-button primary" type="submit">Search</button>
      </form>
      <table class="table"><thead><tr><th>Type</th><th>Recipient</th><th>Event</th><th>Status</th><th>Date</th></tr></thead><tbody>${pagination.items
        .map((note) => `<tr><td>${escapeHtml(note.type)}</td><td>${escapeHtml(note.recipientEmail)}</td><td>${escapeHtml(note.payload || "")}${note.errorMessage ? `<br><span class="muted">${escapeHtml(note.errorMessage)}</span>` : ""}</td><td>${badge(note.status)}</td><td>${new Date(note.createdAt).toLocaleString("en-GB")}</td></tr>`)
        .join("") || `<tr><td colspan="5"><span class="muted">No events found.</span></td></tr>`}</tbody></table>
      ${paginationControls("/admin/notifications", params, pagination)}
      <form class="form-panel" method="post" action="/admin/notifications/templates">
        <h2>Email templates</h2>
        <p class="muted">Available variables: {{payload}}, {{recipientEmail}}, {{date}}, {{platformUrl}}, {{type}}.</p>
        ${Object.entries(defaultEmailTemplates())
          .map(([type, defaults]) => {
            const template = db.settings?.emailTemplates?.[type] ?? defaults;
            return `<article class="panel stack">
              <h3>${escapeHtml(type)}</h3>
              <div class="field"><label>Subject</label><input name="subject:${type}" value="${escapeHtml(template.subject)}" /></div>
              <div class="field"><label>Email body</label><textarea name="body:${type}">${escapeHtml(template.body)}</textarea></div>
            </article>`;
          })
          .join("")}
        <button class="button" type="submit">Save templates</button>
      </form>
    </section>`
  );
}

function adminAudit(user, searchParams = new URLSearchParams()) {
  const params = listParams(searchParams);
  const events = (db.auditEvents ?? [])
    .filter((event) => matchesQuery([event.adminEmail, auditActionLabel(event.action), event.action, JSON.stringify(event.details ?? {})], params.q))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const pagination = paginateItems(events, params);
  return adminShell(
    user,
    "Audit log",
    `<section class="section">
      <div><span class="eyebrow">Security</span><h1>Admin audit log</h1><p class="lead">The log stores the latest 2,000 administrative POST actions without passwords, files, or CSRF tokens.</p></div>
      <form class="inline-form" method="get" action="/admin/audit">
        <input name="q" value="${escapeHtml(params.q)}" placeholder="Search by action or administrator" />
        <button class="small-button primary" type="submit">Search</button>
      </form>
      <table class="table">
        <thead><tr><th>Date</th><th>Administrator</th><th>Action</th><th></th></tr></thead>
        <tbody>${pagination.items
          .map((event) => `<tr>
            <td>${new Date(event.createdAt).toLocaleString("en-GB")}</td>
            <td>${escapeHtml(event.adminEmail)}</td>
            <td><strong>${escapeHtml(auditActionLabel(event.action))}</strong></td>
            <td><a class="small-button" href="/admin/audit/${event.id}">Details</a></td>
          </tr>`)
          .join("") || `<tr><td colspan="4"><span class="muted">No events found.</span></td></tr>`}</tbody>
      </table>
      ${paginationControls("/admin/audit", params, pagination)}
    </section>`
  );
}

function adminAuditDetail(user, event) {
  return adminShell(
    user,
    "Audit details",
    `<section class="section"><div><span class="eyebrow">Audit</span><h1>${escapeHtml(auditActionLabel(event.action))}</h1><p class="lead">${new Date(event.createdAt).toLocaleString("en-GB")} · ${escapeHtml(event.adminEmail)}</p></div><article class="panel stack"><h2>Technical details</h2><pre class="audit-details"><code>${escapeHtml(JSON.stringify({ action: event.action, details: event.details ?? {} }, null, 2))}</code></pre></article><a class="button secondary" href="/admin/audit">Back to log</a></section>`
  );
}

function studentDashboard(user) {
  const assignments = db.assignments.filter((assignment) => assignment.userId === user.id).map(recalculateAssignment);
  const certs = db.certificates.filter((certificate) => certificate.userId === user.id);
  return studentShell(
    user,
    "My account",
    `<section class="section">
      <div><span class="eyebrow">My account</span><h1>Learning overview</h1><p class="lead">View your assigned courses, progress, test results, and certificates.</p></div>
      <div class="grid three">
        <article class="metric"><span class="muted">Assigned courses</span><strong class="metric-value">${assignments.length}</strong></article>
        <article class="metric"><span class="muted">Available tests</span><strong class="metric-value">${assignments.filter(canTakeTest).length}</strong></article>
        <article class="metric"><span class="muted">Certificates</span><strong class="metric-value">${certs.length}</strong></article>
      </div>
      <div class="grid three">${assignments.map((assignment) => courseCard(assignment)).join("")}</div>
    </section>`
  );
}

function courseCard(assignment) {
  const course = courseById(assignment.courseId);
  const certificate = activeCertificateForAssignment(assignment.id);
  return `<article class="card">
    ${courseCoverHtml(course)}
    ${badge(assignment.status)}
    <h3>${escapeHtml(course?.title ?? "Course deleted")}</h3>
    <p class="muted">${escapeHtml(course?.shortDescription ?? "")}</p>
    <div class="progress-track"><div class="progress-bar" style="width:${assignment.progressPercent}%"></div></div>
    <p class="muted">Progress: ${assignment.progressPercent}%</p>
    <div class="table-actions">
      <a class="small-button primary" href="/dashboard/courses/${assignment.id}">Open course</a>
      ${certificate ? `<a class="small-button" href="/certificates/${certificate.id}.pdf">Certificate</a>` : ""}
    </div>
  </article>`;
}

function studentCourses(user) {
  const assignments = db.assignments.filter((assignment) => assignment.userId === user.id).map(recalculateAssignment);
  return studentShell(
    user,
    "My courses",
    `<section class="section">
      <div><span class="eyebrow">My courses</span><h1>Assigned courses</h1><p class="lead">The test becomes available after you complete the required materials.</p></div>
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
  const certificate = activeCertificateForAssignment(assignment.id);
  return studentShell(
    user,
    course.title,
    `<section class="section">
      <div class="section-heading">
        <div><span class="eyebrow">Course</span><h1>${escapeHtml(course.title)}</h1><p class="lead">${escapeHtml(course.fullDescription || course.shortDescription)}</p></div>
        <div class="course-detail-side">
          ${courseCoverHtml(course)}
          <div class="panel"><strong>${assignment.progressPercent}%</strong><p class="muted">progress</p></div>
        </div>
      </div>
      ${assignment.status === "completed" && !hasCertificatePhoto(user) ? `<div class="photo-warning"><strong>The course has been completed successfully.</strong><br>To receive your certificate, upload a photo in your account.</div>` : ""}
      ${certificate ? `<div class="notice"><strong>Certificate issued:</strong> ${escapeHtml(certificate.certificateNumber)} <a class="small-button primary" href="/certificates/${certificate.id}">Open certificate</a> <a class="small-button" href="/certificates/${certificate.id}.pdf">Download PDF</a></div>` : ""}
      <article class="panel stack">
        <h2>Materials</h2>
        ${materials
          .map((material) => {
            const progress = assignment.materialProgress?.[material.id]?.status ?? "not_started";
            const unlocked = isMaterialUnlocked(course, assignment, material.id);
            return `<div class="material-row">
              <div>
                <strong>${escapeHtml(material.title)}</strong>
                <p class="muted">${escapeHtml(material.lesson.title)} · ${escapeHtml(material.type)} · ${material.isRequired ? "required" : "optional"}</p>
                ${unlocked ? materialContentHtml(material) : `<p class="muted">This material will unlock after the previous required lesson is completed.</p>`}
              </div>
              <div>
                ${progress === "completed" ? `<span class="status-pill">Completed</span>` : unlocked ? `<form method="post" action="/dashboard/materials/complete"><input type="hidden" name="assignmentId" value="${assignment.id}" /><input type="hidden" name="materialId" value="${material.id}" /><button class="small-button primary" type="submit">Mark complete</button></form>` : `<span class="status-pill">Locked</span>`}
              </div>
            </div>`;
          })
          .join("")}
      </article>
      <article id="test-result" class="panel stack">
        <h2>Final test</h2>
        <p class="muted">Attempts used: ${attempts.length} of ${course.test.attemptsLimit + (assignment.extraTestAttempts ?? 0)}. Pass mark: ${course.test.passingPercent}%.</p>
        ${latestAttempt && course.test.showResultToUser ? `<div class="notice"><strong>Latest result:</strong> ${latestAttempt.scorePercent}% · attempt ${latestAttempt.attemptNumber} · ${badge(latestAttempt.status === "passed" ? "test_passed" : "test_failed")}</div>` : ""}
        ${canTakeTest(assignment) ? `<a class="button" href="/dashboard/tests/${assignment.id}">Take test</a>` : `<div class="notice">The test becomes available after the required materials are completed, or it has already been completed.</div>`}
      </article>
    </section>`
  );
}

function studentTestPage(user, assignment) {
  const course = courseById(assignment.courseId);
  if (!canTakeTest(assignment)) {
    return studentShell(user, "Test unavailable", `<section class="section"><div class="notice">The test is not available right now.</div></section>`);
  }
  if (course.test.timeLimitMinutes > 0 && !assignment.activeTestStartedAt) {
    assignment.activeTestStartedAt = now();
    saveDb(db);
  }
  const timeLimitNotice = course.test.timeLimitMinutes > 0
    ? `<div class="notice"><strong>Time limit:</strong> ${course.test.timeLimitMinutes} min. The timer started when this page was opened.</div>`
    : "";
  return studentShell(
    user,
    course.test.title,
    `<section class="section">
      <div><span class="eyebrow">Test</span><h1>${escapeHtml(course.test.title)}</h1><p class="lead">Choose one correct answer for each question.</p></div>
      ${timeLimitNotice}
      <form class="stack" method="post" action="/dashboard/tests/${assignment.id}" data-test-wizard>
        <p class="muted" data-test-progress aria-live="polite"></p>
        ${course.test.questions
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(
            (question, index) => `<article class="panel stack test-step" data-test-step="${index}" ${index ? "hidden" : ""}>
              <h2>${escapeHtml(question.questionText)}</h2>
              ${sortedQuestionOptions(question)
                .map((option) => `<label class="quiz-option"><input type="${question.type === "multiple_choice" ? "checkbox" : "radio"}" name="${question.id}" value="${option.id}" ${question.type === "multiple_choice" ? "" : "required"} /> ${escapeHtml(option.optionText)}</label>`)
                .join("")}
            </article>`
          )
          .join("")}
        <div class="table-actions">
          <button class="small-button" type="button" data-test-previous hidden>Previous</button>
          <button class="button" type="button" data-test-next>Next</button>
          <button class="button" type="submit" data-test-submit hidden>Submit test</button>
        </div>
      </form>
      <script nonce="{{CSP_NONCE}}">
        (() => {
          const form = document.querySelector("[data-test-wizard]");
          if (!form) return;
          const steps = [...form.querySelectorAll("[data-test-step]")];
          const previous = form.querySelector("[data-test-previous]");
          const next = form.querySelector("[data-test-next]");
          const submit = form.querySelector("[data-test-submit]");
          const progress = form.querySelector("[data-test-progress]");
          let current = 0;

          const showStep = () => {
            steps.forEach((step, index) => { step.hidden = index !== current; });
            progress.textContent = "Question " + (current + 1) + " of " + steps.length;
            previous.hidden = current === 0;
            next.hidden = current === steps.length - 1;
            submit.hidden = current !== steps.length - 1;
            const heading = steps[current]?.querySelector("h2");
            if (heading) heading.scrollIntoView({ behavior: "smooth", block: "start" });
          };

          const currentStepIsValid = () => {
            const required = [...steps[current].querySelectorAll("input[required]")];
            const invalid = required.find((input) => !input.checkValidity());
            if (!invalid) return true;
            invalid.reportValidity();
            return false;
          };

          previous.addEventListener("click", () => { current = Math.max(0, current - 1); showStep(); });
          next.addEventListener("click", () => {
            if (!currentStepIsValid()) return;
            current = Math.min(steps.length - 1, current + 1);
            showStep();
          });
          showStep();
        })();
      </script>
    </section>`
  );
}

function adminTestPreview(user, course) {
  return adminShell(
    user,
    `Preview: ${course.test?.title ?? course.title}`,
    `<section class="section">
      <div><span class="eyebrow">Test preview</span><h1>${escapeHtml(course.test?.title ?? "Test")}</h1><p class="lead">This is how a student sees the questions after completing required materials.</p></div>
      ${course.test?.timeLimitMinutes ? `<div class="notice">Time limit: ${course.test.timeLimitMinutes} min.</div>` : ""}
      ${(course.test?.questions ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((question) => `<article class="panel stack">
          <h2>${escapeHtml(question.questionText)}</h2>
          ${sortedQuestionOptions(question)
            .map((option) => `<label class="quiz-option"><input type="radio" disabled /> ${escapeHtml(option.optionText)} ${option.isCorrect ? "<span class='muted'>correct</span>" : ""}</label>`)
            .join("")}
        </article>`)
        .join("") || `<article class="panel">No questions have been added yet.</article>`}
      <a class="button secondary" href="/admin/courses/${course.id}">Back to course</a>
    </section>`
  );
}

function studentTests(user) {
  const attempts = db.testAttempts.filter((attempt) => attempt.userId === user.id);
  return studentShell(
    user,
    "Completed tests",
    `<section class="section">
      <div><span class="eyebrow">History</span><h1>Completed tests</h1></div>
      <table class="table"><thead><tr><th>Course</th><th>Attempt</th><th>Result</th><th>Status</th></tr></thead><tbody>${attempts
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
    "Certificates",
    `<section class="section">
      <div><span class="eyebrow">Certificates</span><h1>My certificates</h1></div>
      ${pendingCertificates.length && !hasCertificatePhoto(user) ? `<div class="photo-warning"><strong>You have a completed course without a certificate.</strong><br>Upload a photo in your profile so the system can issue it.</div>` : ""}
      <div class="grid three">${certs
        .map((certificate) => `<article class="card">${badge(certificate.status)}<h3>${escapeHtml(certificate.snapshotCourseTitle)}</h3><p class="muted">Number: ${escapeHtml(certificate.certificateNumber)}</p><p class="muted">Valid until: ${formatDate(certificate.expiresAt)}</p><a class="small-button primary" href="/certificates/${certificate.id}">Open</a></article>`)
        .join("") || `<article class="panel">Certificates will appear after a successful test.</article>`}</div>
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
    "Profile",
    `<section class="section">
      <div><span class="eyebrow">Profile</span><h1>${escapeHtml(user.firstNameEn)} ${escapeHtml(user.lastNameEn)}</h1><p class="lead">These details are required for learning and issuing certificates.</p></div>
      ${pendingCertificates.length && !hasCertificatePhoto(user) ? `<div class="photo-warning"><strong>The course is complete, but the certificate is waiting for a photo.</strong><br>Upload a photo in your account and the certificate will be issued automatically.</div>` : ""}
      <div class="grid three">
        <article class="panel stack">
          <h2>Certificate photo</h2>
          ${hasCertificatePhoto(user) ? `<img class="profile-photo" src="${escapeHtml(user.photoUrl)}" alt="Student photo" />` : `<div class="profile-photo"></div>`}
          <form class="stack" method="post" action="/dashboard/profile/photo" enctype="multipart/form-data">
            <div class="field"><label for="photo">Upload photo</label><input id="photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp" required /></div>
            <button class="button" type="submit">Save photo</button>
          </form>
        </article>
        <form class="form-panel" method="post" action="/dashboard/profile/update" style="grid-column: span 2;">
          <h2>Required details</h2>
          <div class="field"><label>Last name</label><input name="lastNameEn" value="${escapeHtml(user.lastNameEn)}" required /></div>
          <div class="field"><label>First name</label><input name="firstNameEn" value="${escapeHtml(user.firstNameEn)}" required /></div>
          <div class="field"><label>Date of birth</label><input name="birthDate" type="date" value="${escapeHtml(user.birthDate || "")}" required /></div>
          <div class="field"><label>Email</label><input name="email" type="email" value="${escapeHtml(user.email)}" required /></div>
          <div class="field"><label>Position</label><input name="position" value="${escapeHtml(user.position || "")}" required /></div>
          <div class="field"><label>Company - optional</label><input name="company" value="${escapeHtml(user.company || "")}" /></div>
          <button class="button" type="submit">Save profile</button>
        </form>
      </div>
      <form class="form-panel" method="post" action="/dashboard/profile/password">
        <h2>Change password</h2>
        <div class="field"><label>Current password</label><input name="currentPassword" type="password" required /></div>
        <div class="field"><label>New password</label><input name="newPassword" type="password" minlength="8" required /></div>
        <button class="button" type="submit">Change password</button>
      </form>
    </section>`
  );
}

function certificatePage(requestUser, certificate) {
  if (!requestUser) return page("Access denied", null, `<main class="page"><div class="notice">Sign in to open this certificate.</div></main>`);
  if (requestUser.role !== "admin" && certificate.userId !== requestUser.id) {
    return page("Access denied", requestUser, `<main class="page"><div class="notice">You cannot open another student's certificate.</div></main>`);
  }
  const certificateHtml =
    certificate.certificateHtml ||
    renderCertificateTemplate(certificate, certificate.snapshotCertificateTemplateHtml || defaultCertificateTemplate());
  return page(
    "Certificate",
    requestUser,
    `<main class="page">
      ${certificate.status === "issued" ? "" : `<div class="notice danger">This certificate is not active: current status ${escapeHtml(statusLabel(certificate.status))}.</div>`}
      <section class="${certificateShellClass(certificateHtml)}">
        ${certificateHtml}
        <div class="actions" style="justify-content:center;margin-top:24px"><a class="button" href="/certificates/${certificate.id}.pdf">Download PDF</a><button class="button secondary" type="button" data-print-certificate>Print</button></div>
      </section>
    </main>`
  );
}

function verifyCertificatePage(certificate) {
  const isValidCertificate = certificate?.status === "issued";
  const body = certificate
    ? `<main class="page">
        <section class="section">
          <div><span class="eyebrow">Certificate verification</span><h1>Certificate is valid</h1><p class="lead">The number was found in the Marine LMS register.</p></div>
          ${isValidCertificate ? "" : `<div class="notice danger">This certificate is not valid: it has been revoked or replaced by a new certificate.</div>`}
          <article class="panel stack">
            ${badge(certificate.status)}
            <p><strong>Number:</strong> ${escapeHtml(certificate.certificateNumber)}</p>
            <p><strong>Student:</strong> ${escapeHtml(certificate.snapshotFirstName)} ${escapeHtml(certificate.snapshotLastName)}</p>
            <p><strong>Course:</strong> ${escapeHtml(certificate.snapshotCourseTitle)}</p>
            <p><strong>Issue date:</strong> ${new Date(certificate.issuedAt).toLocaleDateString("en-GB")}</p>
            <p><strong>Valid until:</strong> ${formatDate(certificate.expiresAt)}</p>
          </article>
        </section>
      </main>`
    : `<main class="page"><section class="section"><div class="notice danger">No certificate was found with this number.</div></section></main>`;
  return page("Certificate verification", null, body);
}

async function handlePost(request, response, pathname, user) {
  const form = await parseBody(request);
  if (user && !csrfFormValid(user, form)) {
    send(response, page("Request rejected", user, `<main class="page"><div class="notice danger">The POST request was rejected: invalid CSRF token. Refresh the page and try again.</div></main>`), 403);
    return;
  }

  if (pathname === "/login") {
    const email = form.get("email")?.toString().trim().toLowerCase();
    const password = form.get("password")?.toString() ?? "";
    if (loginRateLimited(request)) {
      send(response, page("Too many attempts", null, `<main class="page"><div class="notice danger">Too many sign-in attempts. Wait a few minutes and try again.</div></main>`), 429);
      return;
    }
    const found = db.users.find((item) => item.email.toLowerCase() === email && item.status === "active");
    if (!found || !verifyPassword(password, found.passwordHash)) {
      send(response, page("Sign-in error", null, `<main class="page"><div class="notice danger">Invalid email or password.</div><p><a class="button" href="/login">Back</a></p></main>`), 401);
      return;
    }
    clearLoginRateLimit(request);
    const sessionId = opaqueToken();
    const csrfToken = randomBytes(32).toString("hex");
    db.sessions = (db.sessions ?? []).filter((session) => session.userId !== found.id || new Date(session.expiresAt).getTime() > Date.now());
    db.sessions.push({
      id: id("session"),
      tokenHash: hashSecret(sessionId),
      csrfToken,
      userId: found.id,
      authVersion: found.authVersion,
      expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
      createdAt: now(),
      lastSeenAt: now()
    });
    csrfTokens.set(found.id, csrfToken);
    saveDb(db);
    response.writeHead(303, {
      Location: canAccessAdminPanel(found) ? "/admin" : "/dashboard",
      "Set-Cookie": sessionCookie(sessionId),
      ...responseSecurityHeaders()
    });
    response.end();
    return;
  }

  if (pathname === "/forgot-password") {
    const email = form.get("email")?.toString().trim().toLowerCase() ?? "";
    const found = db.users.find((item) => item.email.toLowerCase() === email && item.status === "active");
    if (found && !passwordResetRateLimited(request, email)) {
      await sendPasswordRecovery(found, createPasswordResetToken(found));
      saveDb(db);
    }
    redirect(response, "/forgot-password?success=1");
    return;
  }

  if (pathname === "/logout") {
    const sessionId = getCookie(request, "sid");
    db.sessions = (db.sessions ?? []).filter((session) => session.tokenHash !== hashSecret(sessionId));
    saveDb(db);
    response.writeHead(303, {
      Location: "/",
      "Set-Cookie": sessionCookie("", 0),
      ...responseSecurityHeaders()
    });
    response.end();
    return;
  }

  if (pathname === "/reset-password") {
    const token = form.get("token")?.toString() ?? "";
    const password = form.get("password")?.toString() ?? "";
    const reset = (db.passwordResetTokens ?? []).find(
      (item) => item.tokenHash === hashSecret(token) && !item.usedAt && new Date(item.expiresAt).getTime() > Date.now()
    );
    const userToReset = reset && db.users.find((item) => item.id === reset.userId && item.status === "active");
    if (!reset || !userToReset || password.length < 12) {
      return redirect(response, "/reset-password?error=invalid");
    }
    userToReset.passwordHash = hashPassword(password);
    invalidateUserSessions(userToReset);
    reset.usedAt = now();
    db.notifications.push({
      id: id("note"), recipientUserId: userToReset.id, recipientEmail: userToReset.email, type: "password_changed",
      status: notificationInitialStatus(), payload: "Password changed through recovery link.", createdAt: now(), sentAt: ""
    });
    saveDb(db);
    return redirect(response, "/login?notice=password_reset");
  }

  if (pathname === "/feedback") {
    const name = form.get("name")?.toString().trim() ?? "";
    const email = form.get("email")?.toString().trim() ?? "";
    const subject = form.get("subject")?.toString().trim() ?? "";
    const message = form.get("message")?.toString().trim() ?? "";
    if (!name || !email || !subject || !message) {
      redirect(response, "/");
      return;
    }
    const notes = db.users
      .filter((item) => item.role === "admin" && item.status === "active")
      .map((admin) => ({
        id: id("note"),
        recipientUserId: admin.id,
        recipientEmail: admin.email,
        type: "feedback_message",
        status: notificationInitialStatus(),
        payload: `Feedback from ${name} (${email}). Subject: ${subject}. Message: ${message}`,
        createdAt: now(),
        sentAt: ""
      }));
    db.notifications.push(...notes);
    if (smtpConfigured()) await Promise.all(notes.map((note) => deliverNotification(note)));
    saveDb(db);
    redirect(response, "/?feedback=1");
    return;
  }

  if (pathname === "/apply") {
    const student = user?.role === "student" ? user : null;
    const courseId = form.get("courseId")?.toString() ?? "";
    const course = db.courses.find((item) => item.id === courseId && item.status === "active");
    if (!course) {
      redirect(response, "/apply");
      return;
    }
    const application = {
      id: id("app"),
      lastName: student?.lastNameEn ?? form.get("lastName")?.toString() ?? "",
      firstName: student?.firstNameEn ?? form.get("firstName")?.toString() ?? "",
      phone: student?.phone ?? form.get("phone")?.toString() ?? "",
      email: student?.email ?? form.get("email")?.toString() ?? "",
      courseId,
      comment: form.get("comment")?.toString() ?? "",
      status: "new",
      adminNote: "",
      createdAt: now()
    };
    db.applications.unshift(application);
    const applicantName = `${application.firstName} ${application.lastName}`.trim() || application.email;
    const adminNotes = db.users
      .filter((item) => item.role === "admin" && item.status === "active")
      .map((admin) => ({
        id: id("note"),
        recipientUserId: admin.id,
        recipientEmail: admin.email,
        type: "new_application",
        status: notificationInitialStatus(),
        payload: `${student ? "Student course request" : "New application"}: ${applicantName} (${application.email}) requested ${course.title}.`,
        createdAt: now(),
        sentAt: ""
      }));
    db.notifications.push(...adminNotes);
    if (smtpConfigured()) await Promise.all(adminNotes.map((note) => deliverNotification(note)));
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
      send(response, studentShell(student, "Profile", `<section class="section"><div class="notice danger">This email address is already used by another user.</div><a class="button" href="/dashboard/profile">Back</a></section>`), 400);
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
    if (verifyPassword(currentPassword, student.passwordHash) && newPassword.length >= 12) {
      student.passwordHash = hashPassword(newPassword);
      invalidateUserSessions(student);
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
      redirect(response, "/login?notice=password_changed");
      return;
    }
    send(response, studentShell(student, "Change password", `<section class="section"><div class="notice danger">Password not changed: check your current password and the length of the new password.</div><a class="button" href="/dashboard/profile">Back</a></section>`), 400);
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
    if (!photo?.buffer?.length || !imageUploadAllowed(photo)) {
      send(response, studentShell(student, "Photo", `<section class="section"><div class="notice danger">Upload an image file in JPG, PNG, or WebP format.</div><a class="button" href="/dashboard/profile">Back</a></section>`), 400);
      return;
    }
    if (photo.buffer.length > 3 * 1024 * 1024) {
      send(response, studentShell(student, "Photo", `<section class="section"><div class="notice danger">The photo is too large. Maximum size: 3 MB.</div><a class="button" href="/dashboard/profile">Back</a></section>`), 400);
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
      send(response, adminShell(admin, "Access denied", `<section class="section"><div class="notice danger">An instructor can create a student, edit their details, upload a photo, and assign a course. This action is not permitted.</div><a class="button" href="/admin/users">Users</a></section>`), 403);
      return;
    }

    if (pathname === "/admin/checks/template") {
      if (!isFullAdmin(admin)) return send(response, adminShell(admin, "Access denied", `<section class="section"><div class="notice danger">Insufficient permissions.</div></section>`), 403);
      updateInvoiceTemplateSettings(form);
      saveDb(db);
      redirect(response, "/admin/checks/template");
      return;
    }

    if (pathname === "/admin/checks/invoices/create") {
      const filterParams = invoiceFilterParams(new URLSearchParams(form.get("filterQuery")?.toString() ?? ""));
      const selectedAssignmentIds = new Set(form.getAll("assignmentId").map((value) => value.toString()));
      const lines = invoiceAssignmentData(filterParams).filter((assignment) => selectedAssignmentIds.has(assignment.id)).map(invoiceLineFromAssignment);
      if (!lines.length) return redirect(response, `/admin/checks?${invoiceFilterQuery(filterParams)}`);
      const invoice = {
        id: id("invoice"), number: invoiceNumber(), createdAt: now(), createdById: admin.id,
        recipientName: form.get("recipientName")?.toString().trim() ?? "", recipientEmail: form.get("recipientEmail")?.toString().trim() ?? "", recipientCompany: form.get("recipientCompany")?.toString().trim() ?? "",
        period: { from: filterParams.from, to: filterParams.to, event: filterParams.event }, columns: filterParams.columns, lines, currency: lines.map((line) => line.currency).find(Boolean) ?? "",
        discount: 0, extraCharge: 0, vatRate: 0, comment: "", issueDate: new Date().toISOString().slice(0, 10), dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), status: "draft", paidAt: "", pdfUrl: "", shareToken: opaqueToken(),
        changes: [{ at: now(), byId: admin.id, byName: displayUserName(admin) || admin.email, action: `Lines created: ${lines.length}` }]
      };
      invoiceItems().push(invoice);
      await persistInvoicePdf(invoice);
      saveDb(db);
      redirect(response, `/admin/checks/invoices/${invoice.id}`);
      return;
    }

    const invoiceUpdateMatch = pathname.match(/^\/admin\/checks\/invoices\/([^/]+)\/update$/);
    if (invoiceUpdateMatch) {
      const invoice = invoiceById(invoiceUpdateMatch[1]);
      if (!invoice) return redirect(response, "/admin/checks");
      for (const key of ["recipientName", "recipientCompany", "recipientEmail", "issueDate", "dueDate", "currency", "comment", "paidAt"]) invoice[key] = form.get(key)?.toString().trim() ?? "";
      invoice.columns = invoiceSelectedColumns(form.getAll("column").map((value) => value.toString()));
      for (const key of ["discount", "extraCharge", "vatRate"]) invoice[key] = Math.max(0, Number(form.get(key)) || 0);
      const requestedStatus = form.get("status")?.toString() ?? "draft";
      invoice.status = invoiceStatuses.includes(requestedStatus) ? requestedStatus : "draft";
      for (const line of invoice.lines ?? []) {
        line.included = form.get(`included_${line.id}`) === "on";
        line.amount = Math.max(0, Number(form.get(`amount_${line.id}`)) || 0);
        line.discount = Math.max(0, Number(form.get(`lineDiscount_${line.id}`)) || 0);
      }
      const sendEmail = form.get("sendEmail") === "1" && invoice.recipientEmail;
      if (sendEmail) {
        invoice.status = "sent";
        invoice.shareToken ??= opaqueToken();
        db.notifications.push({ id: id("note"), recipientUserId: "", recipientEmail: invoice.recipientEmail, type: "invoice_sent", status: notificationInitialStatus(), payload: `Invoice ${invoice.number}: ${publicBaseUrl}/invoices/${invoice.id}/${invoice.shareToken}.pdf`, errorMessage: "", createdAt: now(), sentAt: "" });
      }
      invoice.changes ??= [];
      invoice.changes.push({ at: now(), byId: admin.id, byName: displayUserName(admin) || admin.email, action: sendEmail ? "Updated and sent by email" : "Calculation and PDF updated" });
      await persistInvoicePdf(invoice);
      saveDb(db);
      redirect(response, `/admin/checks/invoices/${invoice.id}`);
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

    if (pathname === "/admin/homepage/footer") {
      if (!isFullAdmin(admin)) {
        redirect(response, "/admin");
        return;
      }
      db.settings ??= {};
      db.settings.homeFooter = {
        policiesTitle: form.get("policiesTitle")?.toString().trim() ?? "",
        termsLabel: form.get("termsLabel")?.toString().trim() ?? "",
        termsUrl: form.get("termsUrl")?.toString().trim() ?? "",
        termsContent: form.get("termsContent")?.toString().trim() ?? "",
        privacyLabel: form.get("privacyLabel")?.toString().trim() ?? "",
        privacyUrl: form.get("privacyUrl")?.toString().trim() ?? "",
        privacyContent: form.get("privacyContent")?.toString().trim() ?? "",
        userPolicyLabel: form.get("userPolicyLabel")?.toString().trim() ?? "",
        userPolicyUrl: form.get("userPolicyUrl")?.toString().trim() ?? "",
        userPolicyContent: form.get("userPolicyContent")?.toString().trim() ?? "",
        feedbackTitle: form.get("feedbackTitle")?.toString().trim() ?? "",
        namePlaceholder: form.get("namePlaceholder")?.toString().trim() ?? "",
        emailPlaceholder: form.get("emailPlaceholder")?.toString().trim() ?? "",
        subjectPlaceholder: form.get("subjectPlaceholder")?.toString().trim() ?? "",
        messagePlaceholder: form.get("messagePlaceholder")?.toString().trim() ?? "",
        submitLabel: form.get("submitLabel")?.toString().trim() ?? ""
      };
      saveDb(db);
      redirect(response, "/admin/homepage");
      return;
    }

    if (pathname === "/admin/course-prices/update") {
      if (!isFullAdmin(admin)) {
        redirect(response, "/admin");
        return;
      }
      for (const course of db.courses) {
        const oldPriceKey = `oldPrice:${course.id}`;
        const newPriceKey = `newPrice:${course.id}`;
        if (form.has(oldPriceKey)) course.oldPrice = normalizeCoursePrice(form.get(oldPriceKey));
        if (form.has(newPriceKey)) course.newPrice = normalizeCoursePrice(form.get(newPriceKey));
      }
      saveDb(db);
      redirect(response, adminReturnTo(form, "/admin/course-prices"));
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
            passwordHash: hashPassword(opaqueToken()),
            firstNameEn: application.firstName,
            lastNameEn: application.lastName,
            birthDate: "",
            company: "",
            position: "Trainee",
            phone: application.phone,
            photoUrl: "",
            status: "active",
            createdById: admin.id,
            authVersion: 1,
            createdAt: now()
          };
          db.users.push(student);
          await sendPasswordRecovery(student, createPasswordResetToken(student));
        } else if (!student.createdById) {
          student.createdById = admin.id;
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
      const password = form.get("password")?.toString() ?? "";
      const duplicate = db.users.some((item) => item.email.toLowerCase() === email.toLowerCase());
      if (email && firstNameEn && lastNameEn && birthDate && position && password.length >= 12 && !duplicate) {
        db.users.push({
          id: id("user"),
          role,
          email,
          passwordHash: hashPassword(password),
          firstNameEn,
          lastNameEn,
          birthDate,
          company: form.get("company")?.toString().trim() ?? "",
          position,
          phone: form.get("phone")?.toString().trim() ?? "",
          photoUrl: "",
          status: "active",
          createdById: admin.id,
          authVersion: 1,
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
        send(response, adminShell(admin, "Student photo", `<section class="section"><div class="notice danger">${escapeHtml(savedPhoto.message)}</div><a class="button" href="/admin/users">Back</a></section>`), 400);
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
      if (student) {
        student.status = student.status === "active" ? "inactive" : "active";
        if (student.status !== "active") invalidateUserSessions(student);
      }
      saveDb(db);
      redirect(response, "/admin/users");
      return;
    }

    if (pathname === "/admin/users/delete") {
      const student = db.users.find((item) => item.id === form.get("id") && item.role === "student");
      if (student) {
        student.status = "deleted";
        invalidateUserSessions(student);
      }
      saveDb(db);
      redirect(response, "/admin/users");
      return;
    }

    if (pathname === "/admin/users/reset-password") {
      const student = db.users.find((item) => item.id === form.get("id") && item.role === "student");
      const temporaryPassword = form.get("password")?.toString() ?? "";
      if (student && temporaryPassword.length >= 12) {
        student.passwordHash = hashPassword(temporaryPassword);
        invalidateUserSessions(student);
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
        send(response, adminShell(admin, "Certificate", `<section class="section"><div class="notice danger">Student or course not found.</div><a class="button" href="/admin/users">Back to students</a></section>`), 404);
        return;
      }
      if (!issuedAt) {
        send(response, adminShell(admin, "Certificate", `<section class="section"><div class="notice danger">Enter a valid certificate issue date.</div><a class="button" href="/admin/users">Back to students</a></section>`), 400);
        return;
      }
      if (!hasCertificatePhoto(student)) {
        send(response, adminShell(admin, "Certificate", `<section class="section"><div class="notice danger">Upload the student photo before issuing a certificate.</div><a class="button" href="/admin/users">Back to students</a></section>`), 400);
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
        requirements: "Complete the required materials and pass the test.",
        oldPrice: normalizeCoursePrice(form.get("oldPrice")),
        newPrice: normalizeCoursePrice(form.get("newPrice")),
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
          title: "Final test",
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
        send(response, adminShell(admin, "Courses", `<section class="section"><div class="notice danger">${escapeHtml(savedImage.message)}</div><a class="button" href="/admin/courses">Back to courses</a></section>`), 400);
        return;
      }
      updateCourseCatalogMetadata(course, {
        category: form.get("catalogCategory")?.toString() ?? "",
        positions: form.getAll("catalogPositions").map((value) => value.toString())
      });
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
        updateCourseCatalogMetadata(course, {
          category: form.get("catalogCategory")?.toString() ?? "",
          positions: form.getAll("catalogPositions").map((value) => value.toString())
        });
        if (form.has("oldPrice")) course.oldPrice = normalizeCoursePrice(form.get("oldPrice"));
        if (form.has("newPrice")) course.newPrice = normalizeCoursePrice(form.get("newPrice"));
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
          send(response, adminShell(admin, "Course", `<section class="section"><div class="notice danger">${escapeHtml(savedImage.message)}</div><a class="button" href="/admin/courses/${course.id}">Back to course</a></section>`), 400);
          return;
        }
      }
      saveDb(db);
      redirect(response, `/admin/courses/${courseUpdateMatch[1]}`);
      return;
    }

    const courseDeleteMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/delete$/);
    if (courseDeleteMatch) {
      if (!isFullAdmin(admin)) {
        send(response, adminShell(admin, "Access denied", `<section class="section"><div class="notice danger">Only an administrator can delete courses.</div></section>`), 403);
        return;
      }
      const course = courseById(courseDeleteMatch[1]);
      if (!course) {
        redirect(response, "/admin/courses");
        return;
      }
      const usage = courseDeletionUsage(course.id);
      if (courseDeletionBlocked(usage)) {
        const details = [
          usage.assignments ? `assignments: ${usage.assignments}` : "",
          usage.applications ? `applications: ${usage.applications}` : "",
          usage.certificates ? `certificates: ${usage.certificates}` : ""
        ].filter(Boolean).join(", ");
        send(response, adminShell(admin, "Delete course", `<section class="section"><div class="notice danger">Course “${escapeHtml(course.title)}” cannot be deleted: ${escapeHtml(details)}.</div><a class="button" href="/admin/courses/${course.id}">Back to course</a></section>`), 409);
        return;
      }
      db.courses = db.courses.filter((item) => item.id !== course.id);
      saveDb(db);
      redirect(response, "/admin/courses");
      return;
    }

    const certificateDesignerMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/certificate-designer$/);
    if (certificateDesignerMatch) {
      const course = courseById(certificateDesignerMatch[1]);
      if (course) {
        let designer = certificateDesignerForCourse(course);
        if (form.get("resetDesigner") === "on") {
          designer = defaultCertificateDesigner(
            designer.backgroundUrl,
            designer.backgroundType,
            designer.stampUrl,
            designer.pageWidth,
            designer.pageHeight
          );
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
          designer.pageWidth = 1123;
          designer.pageHeight = 794;
        }
        const savedBackground = await saveCertificateDesignerBackground(course, form.get("backgroundFile"));
        if (!savedBackground.ok) {
          send(response, adminShell(admin, "Certificate designer", `<section class="section"><div class="notice danger">${escapeHtml(savedBackground.message)}</div><a class="button" href="/admin/courses/${course.id}">Back to course</a></section>`), 400);
          return;
        }
        if (savedBackground.backgroundUrl) {
          designer.backgroundUrl = savedBackground.backgroundUrl;
          designer.backgroundType = savedBackground.backgroundType;
          designer.pageWidth = savedBackground.pageWidth ?? designer.pageWidth;
          designer.pageHeight = savedBackground.pageHeight ?? designer.pageHeight;
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

        const overlayImages = [];
        for (const [index, file] of form.getAll("overlayImageFiles").entries()) {
          const savedImage = saveCertificateDesignerOverlayImage(course, file, index);
          if (!savedImage.ok) {
            send(response, adminShell(admin, "Certificate designer", `<section class="section"><div class="notice danger">${escapeHtml(savedImage.message)}</div><a class="button" href="/admin/courses/${course.id}">Back to course</a></section>`), 400);
            return;
          }
          overlayImages[index] = savedImage.imageUrl || "";
        }
        designer.fields = designer.fields
          .filter((field) => !field.isCustomImage || !Number.isInteger(field.pendingImageIndex) || Boolean(overlayImages[field.pendingImageIndex]))
          .map((field) => {
            if (!field.isCustomImage || !Number.isInteger(field.pendingImageIndex)) return field;
            const imageUrl = overlayImages[field.pendingImageIndex];
            const storedField = { ...field };
            delete storedField.pendingImageIndex;
            return { ...storedField, imageUrl };
          });

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
    redirect(response, `/dashboard/courses/${assignment.id}#test-result`);
    return;
  }

  send(response, page("Not found", user, `<main class="page"><div class="notice">Route not found.</div></main>`), 404);
}

async function handleRequest(request, response) {
  await saveQueue;
  if (lastSaveError) throw lastSaveError;
  if (pruneExpiredAuthRecords()) saveDb(db);
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const pathname = url.pathname;
  const user = currentUser(request);

  if (request.method === "GET" && pathname.startsWith("/uploads/")) {
    serveUpload(request, response, user, pathname.slice("/uploads/".length));
    return;
  }

  if (request.method === "GET" && pathname.startsWith("/assets/")) {
    servePublicAsset(response, pathname.slice("/assets/".length));
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
      send(response, page("Request rejected", user, `<main class="page"><div class="notice danger">The POST request was rejected by same-origin protection.</div></main>`), 403);
      return;
    }
    await handlePost(request, response, pathname, user);
    return;
  }

  if (pathname === "/") return send(response, homePage(user, url.searchParams.get("feedback") === "1"));
  if (pathname === "/login") return send(response, loginPage(user, url.searchParams.get("notice") ?? ""));
  if (pathname === "/forgot-password") return send(response, forgotPasswordPage(user, url.searchParams.get("success") === "1"));
  if (pathname === "/reset-password") return send(response, resetPasswordPage(url.searchParams.get("token") ?? "", url.searchParams.get("error") ?? ""));
  if (pathname === "/blog") return send(response, await blogPage(user));
  if (pathname === "/contacts") return send(response, contactsPage(user));
  if (pathname === "/terms") { const footer = homeFooterSettings(); return send(response, policyPage(user, footer.termsLabel, footer.termsContent)); }
  if (pathname === "/privacy") { const footer = homeFooterSettings(); return send(response, policyPage(user, footer.privacyLabel, footer.privacyContent)); }
  if (pathname === "/user-policy") { const footer = homeFooterSettings(); return send(response, policyPage(user, footer.userPolicyLabel, footer.userPolicyContent)); }
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
        : page("Course not found", user, `<main class="page"><section class="section"><div class="notice">Course not found or unavailable.</div><a class="button" href="/">Home</a></section></main>`),
      isVisible ? 200 : 404
    );
  }

  const sharedInvoicePdfMatch = pathname.match(/^\/invoices\/([^/]+)\/([^/]+)\.pdf$/);
  if (sharedInvoicePdfMatch) {
    const invoice = invoiceById(sharedInvoicePdfMatch[1]);
    if (!invoice || !invoice.shareToken || invoice.shareToken !== sharedInvoicePdfMatch[2]) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
      response.end("Not found");
      return;
    }
    const path = invoicePdfPath(invoice);
    if (!existsSync(path)) await persistInvoicePdf(invoice);
    if (invoice.status === "sent") invoice.status = "viewed";
    saveDb(db);
    response.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${invoice.number}.pdf"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
    response.end(readFileSync(path));
    return;
  }

  if (pathname.startsWith("/admin")) {
    const admin = requireAdmin(request, response);
    if (!admin) return;
    if (isInstructor(admin) && !["/admin", "/admin/users"].includes(pathname)) {
      return send(response, adminShell(admin, "Access denied", `<section class="section"><div class="notice danger">An instructor can only register students and assign courses.</div><a class="button" href="/admin/users">Users</a></section>`), 403);
    }
    if (pathname === "/admin") return send(response, adminDashboard(admin));
    if (pathname === "/admin/applications") return send(response, adminApplications(admin, url.searchParams));
    if (pathname === "/admin/users") return send(response, adminUsers(admin, url.searchParams));
    if (pathname === "/admin/reports") return send(response, adminReports(admin, url.searchParams));
    const invoicePdfMatch = pathname.match(/^\/admin\/checks\/invoices\/([^/]+)\.pdf$/);
    if (invoicePdfMatch) {
      const invoice = invoiceById(invoicePdfMatch[1]);
      if (!invoice) return send(response, adminShell(admin, "Not found", `<section class="section"><div class="notice">Invoice not found.</div></section>`), 404);
      const path = invoicePdfPath(invoice);
      if (!existsSync(path)) await persistInvoicePdf(invoice);
      response.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${invoice.number}.pdf"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
      response.end(readFileSync(path));
      return;
    }
    const invoiceMatch = pathname.match(/^\/admin\/checks\/invoices\/([^/]+)$/);
    if (invoiceMatch) {
      const invoice = invoiceById(invoiceMatch[1]);
      return send(response, invoice ? adminInvoiceDetail(admin, invoice) : adminShell(admin, "Not found", `<section class="section"><div class="notice">Invoice not found.</div></section>`), invoice ? 200 : 404);
    }
    if (pathname === "/admin/checks/template") return send(response, isFullAdmin(admin) ? adminInvoiceTemplate(admin) : adminShell(admin, "Access denied", `<section class="section"><div class="notice danger">Insufficient permissions.</div></section>`), isFullAdmin(admin) ? 200 : 403);
    if (pathname === "/admin/checks/export.xls") return isFullAdmin(admin) ? sendChecksExcel(response, url.searchParams) : send(response, adminShell(admin, "Access denied", `<section class="section"><div class="notice danger">Insufficient permissions.</div></section>`), 403);
    if (pathname === "/admin/checks") return send(response, isFullAdmin(admin) ? adminChecks(admin, url.searchParams) : adminShell(admin, "Access denied", `<section class="section"><div class="notice danger">Insufficient permissions.</div></section>`), isFullAdmin(admin) ? 200 : 403);
    if (pathname === "/admin/tests") return send(response, adminTests(admin, url.searchParams));
    if (pathname === "/admin/courses") return send(response, adminCourses(admin, url.searchParams));
    if (pathname === "/admin/course-prices/export.xls") return isFullAdmin(admin) ? sendCoursePricesExcel(response, url.searchParams) : send(response, adminShell(admin, "Access denied", `<section class="section"><div class="notice danger">Insufficient permissions.</div></section>`), 403);
    if (pathname === "/admin/course-prices") return send(response, isFullAdmin(admin) ? adminCoursePrices(admin, url.searchParams) : adminShell(admin, "Access denied", `<section class="section"><div class="notice danger">Insufficient permissions.</div></section>`), isFullAdmin(admin) ? 200 : 403);
    if (pathname === "/admin/homepage") return send(response, adminHomepage(admin));
    if (pathname === "/admin/files/import-report.csv") return sendImportQualityCsv(response);
    if (pathname === "/admin/files") return send(response, adminFiles(admin, url.searchParams));
    if (pathname === "/admin/certificates/export.csv") return sendCertificatesCsv(response, url.searchParams);
    if (pathname === "/admin/certificates/export.xls") return sendCertificatesExcel(response, url.searchParams);
    if (pathname === "/admin/certificates") return send(response, adminCertificates(admin, url.searchParams));
    if (pathname === "/admin/notifications") return send(response, adminNotifications(admin, url.searchParams));
    if (pathname === "/admin/audit") return send(response, adminAudit(admin, url.searchParams));
    const auditDetailMatch = pathname.match(/^\/admin\/audit\/([^/]+)$/);
    if (auditDetailMatch) {
      const event = (db.auditEvents ?? []).find((item) => item.id === auditDetailMatch[1]);
      return send(response, event ? adminAuditDetail(admin, event) : adminShell(admin, "Not found", `<section class="section"><div class="notice">Audit record not found.</div></section>`), event ? 200 : 404);
    }
    const adminUserMatch = pathname.match(/^\/admin\/users\/([^/]+)$/);
    if (adminUserMatch) {
      const student = db.users.find((item) => item.id === decodeURIComponent(adminUserMatch[1]) && item.role === "student");
      return send(response, student ? adminStudentDetail(admin, student) : adminShell(admin, "Not found", `<div class="notice">Student not found.</div>`), student ? 200 : 404);
    }
    const testPreviewMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/test\/preview$/);
    if (testPreviewMatch) {
      const course = courseById(testPreviewMatch[1]);
      return send(response, course ? adminTestPreview(admin, course) : adminShell(admin, "Not found", `<div class="notice">Course not found.</div>`), course ? 200 : 404);
    }
    const certificateTemplatePreviewMatch = pathname.match(/^\/admin\/courses\/([^/]+)\/certificate-template\/preview$/);
    if (certificateTemplatePreviewMatch) {
      const course = courseById(certificateTemplatePreviewMatch[1]);
      return send(response, course ? adminCertificateTemplatePreview(admin, course) : adminShell(admin, "Not found", `<div class="notice">Course not found.</div>`), course ? 200 : 404);
    }
    const courseMatch = pathname.match(/^\/admin\/courses\/([^/]+)$/);
    if (courseMatch) {
      const course = courseById(courseMatch[1]);
      return send(response, course ? adminCourseDetail(admin, course) : adminShell(admin, "Not found", `<div class="notice">Course not found.</div>`), course ? 200 : 404);
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
      return send(response, assignment ? studentCourseDetail(student, assignment) : studentShell(student, "Not found", `<div class="notice">Course not found.</div>`), assignment ? 200 : 404);
    }
    const testMatch = pathname.match(/^\/dashboard\/tests\/([^/]+)$/);
    if (testMatch) {
      const assignment = db.assignments.find((item) => item.id === testMatch[1] && item.userId === student.id);
      return send(response, assignment ? studentTestPage(student, assignment) : studentShell(student, "Not found", `<div class="notice">Test not found.</div>`), assignment ? 200 : 404);
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
      "Content-Disposition": `attachment; filename="${cert.certificateNumber.replace(/[^a-zA-Z0-9_-]+/g, "-")}.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    });
    response.end(pdf);
    return;
  }

  const certMatch = pathname.match(/^\/certificates\/([^/]+)$/);
  if (certMatch) {
    const cert = db.certificates.find((certificate) => certificate.id === certMatch[1]);
    return send(response, cert ? certificatePage(user, cert) : page("Not found", user, `<main class="page"><div class="notice">Certificate not found.</div></main>`), cert ? 200 : 404);
  }

  send(response, page("Not found", user, `<main class="page"><div class="notice">Page not found.</div></main>`), 404);
}

const server = createServer((request, response) => {
  const work = requestQueue
    .catch(() => {})
    .then(() => handleRequest(request, response))
    .catch((error) => {
      console.error("Marine LMS request failed:", error);
      if (!response.headersSent) {
        const status = Number(error?.statusCode) === 413 ? 413 : 500;
        send(response, page("Error", null, `<main class="page"><div class="notice danger">The request could not be processed. Try again or contact an administrator.</div></main>`), status);
      }
    });
  requestQueue = work.catch(() => {});
});

server.listen(port, host, () => {
  console.log(`Marine LMS is ready: http://${host}:${port}`);
  console.log(`Storage: ${usePrismaStorage ? `PostgreSQL ${maskedConnectionString(databaseUrl)}` : "JSON data/db.json"}`);
  if (process.env.NODE_ENV !== "production") {
    console.log("Demo admin: admin@example.com / Admin123!");
    console.log("Demo student: student@example.com / Student123!");
  }
});
