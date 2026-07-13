import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import sharp from "sharp";
import { loadLocalEnv } from "./env.mjs";
import { loadPrismaDb, resolveConnectionString, syncPrismaDb } from "./prisma-db.mjs";

loadLocalEnv();

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const fileIndex = args.indexOf("--file");
const sourceFile = fileIndex >= 0 ? args[fileIndex + 1] : "";

if (!sourceFile) {
  console.error("Usage: node scripts/import-course-price-revision.mjs --file <course-price.xlsx> [--apply]");
  process.exit(1);
}

function readZipEntry(zipPath, entryName) {
  const archive = readFileSync(zipPath);
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Workbook is not a valid ZIP archive.");
  let offset = archive.readUInt32LE(end + 16);
  const entries = archive.readUInt16LE(end + 10);
  for (let index = 0; index < entries; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error("Workbook ZIP directory is invalid.");
    const compression = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === entryName) {
      if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Workbook ZIP entry ${entryName} is invalid.`);
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(dataStart, dataStart + compressedSize);
      if (compression === 0) return compressed.toString("utf8");
      if (compression === 8) return inflateRawSync(compressed).toString("utf8");
      throw new Error(`Unsupported workbook compression method: ${compression}.`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Missing ${entryName} in workbook.`);
}

function xmlText(value = "") {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function readWorkbookRows(filePath) {
  const [sharedXml, sheetXml] = [readZipEntry(filePath, "xl/sharedStrings.xml"), readZipEntry(filePath, "xl/worksheets/sheet1.xml")];
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => xmlText([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => item[1]).join("")));
  const rows = [];
  for (const row of sheetXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const values = {};
    for (const cell of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1];
      const column = attributes.match(/\br="([A-Z]+)\d+"/)?.[1];
      if (!column) continue;
      const value = cell[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      values[column] = /\bt="s"/.test(attributes) ? shared[Number(value)] ?? "" : xmlText(value);
    }
    rows.push({ row: Number(row[1]), ...values });
  }
  return rows;
}

function titleKey(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function price(value) {
  const amount = String(value ?? "").trim();
  return amount ? `${amount} USD` : "";
}

function courseIdFor(title) {
  const slug = titleKey(title).replaceAll(" ", "-").slice(0, 42) || "course";
  const digest = createHash("sha256").update(title).digest("hex").slice(0, 8);
  return `catalog_${slug}_${digest}`;
}

function svgEscape(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function splitTitle(title) {
  const words = title.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > 26 && line) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

async function createCover(title, outputPath, variant) {
  const palette = ["#0b4f7a", "#0d5e84", "#075f73"][variant % 3];
  const lines = splitTitle(title)
    .map((line, index) => `<text x="92" y="${222 + index * 72}" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="#ffffff">${svgEscape(line)}</text>`)
    .join("");
  const svg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
    <rect width="1280" height="720" fill="${palette}"/>
    <path d="M0 526 C205 444 360 616 584 520 S983 424 1280 522 V720 H0Z" fill="#053b5c" opacity="0.78"/>
    <path d="M0 578 C198 486 402 654 631 558 S1040 466 1280 570" fill="none" stroke="#71c5df" stroke-width="5" opacity="0.7"/>
    <circle cx="1110" cy="150" r="164" fill="none" stroke="#b4e5f2" stroke-width="2" opacity="0.45"/>
    <circle cx="1110" cy="150" r="100" fill="none" stroke="#b4e5f2" stroke-width="2" opacity="0.4"/>
    <path d="M1110 0 V300 M960 150 H1260 M1004 44 L1216 256 M1216 44 L1004 256" stroke="#b4e5f2" stroke-width="2" opacity="0.35"/>
    <text x="92" y="106" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="2" fill="#b4e5f2">MARINE LEARNING ACADEMY</text>
    <rect x="92" y="138" width="112" height="5" fill="#56c6e5"/>
    ${lines}
    <text x="92" y="652" font-family="Arial, sans-serif" font-size="24" fill="#d9f3fa">ONLINE MARITIME COURSE</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

const rows = (await readWorkbookRows(resolve(sourceFile)))
  .filter((row) => row.row >= 13 && row.B && row.D)
  .map((row) => ({ title: String(row.B).trim(), usualCost: String(row.D).trim(), offer: String(row.E ?? "").trim() }));

const previousDb = await loadPrismaDb({ connectionString: resolveConnectionString() });
const nextDb = structuredClone(previousDb);
const importedTitleKeys = new Set(rows.map((row) => titleKey(row.title)));
nextDb.courses = nextDb.courses.filter(
  (course) => course.source?.kind !== "course_price_revision" || importedTitleKeys.has(titleKey(course.source?.sourceTitle || course.title))
);
const coursesByTitle = new Map(nextDb.courses.map((course) => [titleKey(course.title), course]));
const templateCourse = nextDb.courses.find((course) => course.certificateTemplateHtml)?.certificateTemplateHtml ?? "";
const updated = [];
const created = [];

for (const [index, row] of rows.entries()) {
  let course = coursesByTitle.get(titleKey(row.title));
  if (course) {
    course.oldPrice = price(row.usualCost);
    course.newPrice = price(row.offer);
    updated.push(course.title);
    continue;
  }

  const id = courseIdFor(row.title);
  const coverPath = `/uploads/generated-covers/${id}.png`;
  course = {
    id,
    title: row.title,
    shortDescription: "",
    fullDescription: "",
    goals: "",
    requirements: "",
    oldPrice: price(row.usualCost),
    newPrice: price(row.offer),
    status: "active",
    isSequential: true,
    imageUrl: coverPath,
    showOnHome: false,
    homeSortOrder: 999,
    certificateTemplateHtml: templateCourse,
    lessons: [],
    test: null,
    source: { kind: "course_price_revision", sourceTitle: row.title, importedAt: new Date().toISOString() },
    createdAt: new Date().toISOString()
  };
  nextDb.courses.push(course);
  coursesByTitle.set(titleKey(course.title), course);
  created.push({ ...course, coverPath, variant: index });
}

console.log(`Workbook: ${basename(sourceFile)}`);
console.log(`Rows with Usual Cost: ${rows.length}`);
console.log(`Updated courses: ${updated.length}`);
console.log(`Created courses: ${created.length}`);
console.log(`New: ${created.map((course) => course.title).join(" | ") || "none"}`);

if (!apply) {
  console.log("Dry run complete. Re-run with --apply to save prices, courses, and covers.");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = resolve("backups", `course-price-revision-${stamp}`);
mkdirSync(backupDir, { recursive: true });
writeFileSync(resolve(backupDir, "database-before.json"), `${JSON.stringify(previousDb, null, 2)}\n`);

const coversDir = resolve("data/uploads/generated-covers");
mkdirSync(coversDir, { recursive: true });
for (const course of created) {
  await createCover(course.title, resolve(coversDir, `${course.id}.png`), course.variant);
}

await syncPrismaDb(previousDb, nextDb, { connectionString: resolveConnectionString() });
console.log(`Saved. Database snapshot: ${backupDir}`);
console.log(`Generated covers: ${coversDir}`);
