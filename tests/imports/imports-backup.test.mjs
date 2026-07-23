import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import pg from "pg";
import { createDataBackup } from "../../scripts/backup-data.mjs";
import { applyPrismaMigrations } from "../../scripts/apply-prisma-migrations.mjs";
import { importCoursePriceRevision } from "../../scripts/import-course-price-revision.mjs";
import { loadPrismaDb, replacePrismaDb } from "../../scripts/prisma-db.mjs";

const { Client } = pg;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const silentLog = { log() {}, error() {} };

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries) {
  const localParts = [];
  const directoryParts = [];
  let offset = 0;

  for (const [name, rawValue] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const value = Buffer.from(rawValue, "utf8");
    const checksum = crc32(value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(value.length, 18);
    local.writeUInt32LE(value.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, value);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(value.length, 20);
    central.writeUInt32LE(value.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    directoryParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + value.length;
  }

  const directory = Buffer.concat(directoryParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, directory, end]);
}

function createPriceWorkbook(filePath) {
  const sharedStrings = [
    "Existing Maritime Course",
    "180",
    "150",
    "New Maritime Operations",
    "220"
  ];
  const sharedXml = `<?xml version="1.0" encoding="UTF-8"?>
    <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">
      ${sharedStrings.map((value) => `<si><t>${value}</t></si>`).join("")}
    </sst>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row r="13"><c r="B13" t="s"><v>0</v></c><c r="D13" t="s"><v>1</v></c><c r="E13" t="s"><v>2</v></c></row>
      <row r="14"><c r="B14" t="s"><v>3</v></c><c r="D14" t="s"><v>4</v></c></row>
    </sheetData></worksheet>`;
  writeFileSync(
    filePath,
    createStoredZip({
      "xl/sharedStrings.xml": sharedXml,
      "xl/worksheets/sheet1.xml": sheetXml
    })
  );
}

async function createTemporaryPostgresDatabase() {
  const adminConnectionString =
    process.env.TEST_POSTGRES_ADMIN_URL ??
    "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
  const databaseName = `marine_import_test_${process.pid}_${Date.now()}_${randomUUID().slice(0, 6)}`.toLowerCase();
  const targetUrl = new URL(adminConnectionString);
  targetUrl.pathname = `/${databaseName}`;
  targetUrl.search = "";
  const connectionString = targetUrl.toString();
  const admin = new Client({ connectionString: adminConnectionString });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await applyPrismaMigrations({ connectionString, log: silentLog });
  return {
    connectionString,
    async cleanup() {
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [databaseName]
      );
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  };
}

function sqlValue(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function insertSql(table, rows) {
  return `INSERT INTO \`${table}\` VALUES\n${rows.map((row) => `(${row.map(sqlValue).join(",")})`).join(",\n")};`;
}

function postRow({
  id,
  author = 1,
  content = "",
  title,
  excerpt = "",
  status = "publish",
  parent = 0,
  order = 0,
  type,
  guid = ""
}) {
  return [
    id,
    author,
    "2026-07-01 10:00:00",
    "2026-07-01 10:00:00",
    content,
    title,
    excerpt,
    status,
    "closed",
    "closed",
    "",
    String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    "",
    "",
    "2026-07-01 11:00:00",
    "2026-07-01 11:00:00",
    "",
    parent,
    guid,
    order,
    type,
    "",
    0
  ];
}

function createWordPressFixture(root) {
  const uploadsRoot = resolve(root, "wordpress", "wp-content", "uploads");
  const videoPath = resolve(uploadsRoot, "2024/01/test-video.mp4");
  mkdirSync(dirname(videoPath), { recursive: true });
  writeFileSync(videoPath, Buffer.from("test-video-content"));

  const videoUrl = "https://maritimelearning.store/wp-content/uploads/2024/01/test-video.mp4";
  const sql = [
    insertSql("wp_posts", [
      postRow({ id: 100, title: "Imported Safety Course", excerpt: "Imported summary", type: "courses" }),
      postRow({ id: 110, title: "Safety topic", parent: 100, type: "topics" }),
      postRow({
        id: 120,
        title: "Video lesson",
        content: `<p>Read the safety briefing.</p><video src="${videoUrl}"></video>`,
        parent: 110,
        type: "lesson"
      }),
      postRow({ id: 130, title: "Final safety quiz", parent: 110, type: "tutor_quiz" }),
      postRow({
        id: 140,
        author: 2,
        title: "Enrollment",
        status: "completed",
        parent: 100,
        type: "tutor_enrolled"
      })
    ]),
    insertSql("wp_users", [
      [
        2,
        "imported.student",
        "$P$wordpress",
        "imported-student",
        "imported.student@example.com",
        "",
        "2026-07-01 09:00:00",
        "",
        0,
        "Imported Student"
      ]
    ]),
    insertSql("wp_usermeta", [
      [1, 2, "first_name", "Imported"],
      [2, 2, "last_name", "Student"],
      [3, 2, "_is_tutor_student", "1"],
      [4, 2, "_tutor_profile_job_title", "Deck Officer"]
    ]),
    insertSql("wp_tutor_quiz_questions", [
      [501, 130, "Which answer is safe?", "", "", "single_choice", 1, "", 1]
    ]),
    insertSql("wp_tutor_quiz_question_answers", [
      [601, 501, "single_choice", "Correct answer", 1, 0, "", "text", "", 1],
      [602, 501, "single_choice", "Wrong answer", 0, 0, "", "text", "", 2]
    ])
  ].join("\n");
  const sqlPath = resolve(root, "wordpress.sql");
  writeFileSync(sqlPath, sql, "utf8");
  return { sqlPath, siteRoot: resolve(root, "wordpress"), uploadsRoot, videoPath };
}

function minimalJsonDb() {
  return {
    users: [],
    applications: [],
    courses: [],
    assignments: [],
    testAttempts: [],
    certificates: [],
    notifications: [],
    sessions: [],
    passwordResetTokens: [],
    auditEvents: [],
    certificateEvents: [],
    settings: {}
  };
}

test("course price XLSX import supports dry-run, apply, covers, backups, and idempotency", async () => {
  const root = mkdtempSync(join(tmpdir(), "marine-price-import-"));
  const workbook = resolve(root, "prices.xlsx");
  createPriceWorkbook(workbook);
  const database = await createTemporaryPostgresDatabase();
  try {
    const db = await loadPrismaDb({ connectionString: database.connectionString });
    db.courses.push({
      id: "existing_course",
      title: "Existing Maritime Course",
      shortDescription: "",
      fullDescription: "",
      goals: "",
      requirements: "",
      oldPrice: "90 USD",
      newPrice: "",
      status: "active",
      isSequential: true,
      imageUrl: "",
      showOnHome: false,
      homeSortOrder: 999,
      autoIssueCertificate: true,
      certificateTemplateHtml: "<h1>{{courseTitle}}</h1>",
      lessons: [],
      test: null,
      createdAt: "2026-07-01T00:00:00.000Z"
    });
    await replacePrismaDb(db, { connectionString: database.connectionString });

    const dryRun = await importCoursePriceRevision({
      sourceFile: workbook,
      connectionString: database.connectionString,
      apply: false,
      log: silentLog
    });
    assert.equal(dryRun.updated.length, 1);
    assert.equal(dryRun.created.length, 1);
    assert.equal((await loadPrismaDb({ connectionString: database.connectionString })).courses.length, 1);

    const applied = await importCoursePriceRevision({
      sourceFile: workbook,
      connectionString: database.connectionString,
      apply: true,
      backupRoot: resolve(root, "backups"),
      coversDir: resolve(root, "covers"),
      log: silentLog
    });
    const importedDb = await loadPrismaDb({ connectionString: database.connectionString });
    assert.equal(applied.applied, true);
    assert.equal(importedDb.courses.length, 2);
    assert.equal(importedDb.courses.find((course) => course.id === "existing_course").oldPrice, "180 USD");
    assert.equal(importedDb.courses.find((course) => course.id === "existing_course").newPrice, "150 USD");
    const created = importedDb.courses.find((course) => course.title === "New Maritime Operations");
    assert.equal(created.oldPrice, "220 USD");
    assert.equal(created.newPrice, "");
    assert.ok(existsSync(resolve(root, "covers", `${created.id}.png`)));
    assert.ok(existsSync(resolve(applied.backupDir, "database-before.json")));

    const repeated = await importCoursePriceRevision({
      sourceFile: workbook,
      connectionString: database.connectionString,
      apply: true,
      backupRoot: resolve(root, "backups"),
      coversDir: resolve(root, "covers"),
      log: silentLog
    });
    assert.equal(repeated.created.length, 0);
    assert.equal((await loadPrismaDb({ connectionString: database.connectionString })).courses.length, 2);
  } finally {
    await database.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("WordPress/Tutor import dry-run is safe and apply imports course, test, enrollment, and video", async () => {
  const root = mkdtempSync(join(tmpdir(), "marine-wp-import-"));
  const fixture = createWordPressFixture(root);
  const dataDir = resolve(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = resolve(dataDir, "db.json");
  writeFileSync(dbPath, `${JSON.stringify(minimalJsonDb(), null, 2)}\n`, "utf8");

  const previousCwd = process.cwd();
  const previousArgv = [...process.argv];
  const previousEnv = {
    WP_SQL_PATH: process.env.WP_SQL_PATH,
    WP_SITE_ROOT: process.env.WP_SITE_ROOT,
    WP_UPLOADS_ROOT: process.env.WP_UPLOADS_ROOT,
    WP_VIDEO_ROOT: process.env.WP_VIDEO_ROOT
  };
  try {
    process.chdir(root);
    Object.assign(process.env, {
      WP_SQL_PATH: fixture.sqlPath,
      WP_SITE_ROOT: fixture.siteRoot,
      WP_UPLOADS_ROOT: fixture.uploadsRoot,
      WP_VIDEO_ROOT: resolve(root, "video")
    });
    const scriptUrl = pathToFileURL(resolve(projectRoot, "scripts/import-wordpress-tutor.mjs")).href;

    process.argv = [process.execPath, resolve(projectRoot, "scripts/import-wordpress-tutor.mjs"), "--dry-run", "--skip-attempts"];
    await import(`${scriptUrl}?dry=${Date.now()}-${Math.random()}`);
    assert.deepEqual(JSON.parse(readFileSync(dbPath, "utf8")), minimalJsonDb());
    const drySummary = JSON.parse(readFileSync(resolve(root, "imports/wordpress/output/summary.json"), "utf8"));
    assert.equal(drySummary.mode, "dry-run");
    assert.equal(drySummary.imported.users, 1);
    assert.equal(drySummary.imported.courses, 1);
    assert.equal(drySummary.imported.questions, 1);

    process.argv = [
      process.execPath,
      resolve(projectRoot, "scripts/import-wordpress-tutor.mjs"),
      "--apply",
      "--copy-files",
      "--skip-attempts"
    ];
    await import(`${scriptUrl}?apply=${Date.now()}-${Math.random()}`);

    const imported = JSON.parse(readFileSync(dbPath, "utf8"));
    assert.equal(imported.users.length, 1);
    assert.equal(imported.users[0].email, "imported.student@example.com");
    assert.equal(imported.courses.length, 1);
    assert.equal(imported.courses[0].lessons.length, 1);
    assert.equal(imported.courses[0].test.questions.length, 1);
    assert.equal(imported.assignments.length, 1);
    assert.equal(imported.assignments[0].status, "completed");
    const video = imported.courses[0].lessons[0].materials.find((material) => material.type === "video");
    assert.equal(video.content, "/uploads/imported-wordpress/2024/01/test-video.mp4");
    const copiedVideo = resolve(root, "data/uploads/imported-wordpress/2024/01/test-video.mp4");
    assert.ok(existsSync(copiedVideo));
    assert.deepEqual(readFileSync(copiedVideo), readFileSync(fixture.videoPath));
    const applySummary = JSON.parse(readFileSync(resolve(root, "imports/wordpress/output/summary.json"), "utf8"));
    assert.equal(applySummary.mode, "apply");
    assert.equal(applySummary.copied.files, 1);
    assert.equal(applySummary.copied.failed, 0);
  } finally {
    process.chdir(previousCwd);
    process.argv = previousArgv;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("data backup copies database and uploads without changing source files", () => {
  const root = mkdtempSync(join(tmpdir(), "marine-backup-"));
  try {
    const dbPath = resolve(root, "data/db.json");
    const uploadPath = resolve(root, "data/uploads/nested/manual.pdf");
    mkdirSync(dirname(uploadPath), { recursive: true });
    const database = `${JSON.stringify({ marker: "backup-source" }, null, 2)}\n`;
    const upload = Buffer.from("pdf-fixture");
    writeFileSync(dbPath, database, "utf8");
    writeFileSync(uploadPath, upload);

    const result = createDataBackup({
      rootDir: root,
      now: new Date("2026-07-23T12:34:56.789Z"),
      log: silentLog
    });
    assert.equal(result.databaseCopied, true);
    assert.equal(result.uploadsCopied, true);
    assert.equal(readFileSync(resolve(result.backupDir, "db.json"), "utf8"), database);
    assert.deepEqual(readFileSync(resolve(result.backupDir, "uploads/nested/manual.pdf")), upload);
    assert.equal(readFileSync(dbPath, "utf8"), database);
    assert.deepEqual(readFileSync(uploadPath), upload);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
