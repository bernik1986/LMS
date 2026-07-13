import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { loadLocalEnv } from "./env.mjs";
import { loadPrismaDb, resolveConnectionString, syncPrismaDb } from "./prisma-db.mjs";

loadLocalEnv();

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const packArg = args.find((arg) => !arg.startsWith("--"));

if (!packArg) {
  console.error("Usage: node scripts/install-certificate-template-pack.mjs <pack-directory> [--apply]");
  process.exitCode = 1;
} else {
  await main();
}

async function main() {
  const packDir = resolve(packArg);
  const manifestPath = resolve(packDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validateManifest(manifest);
  await validateAssets(packDir, manifest);

  const { db, storage } = await loadDatabaseForInstall(apply);
  const matches = matchTemplatesToCourses(manifest.templates, db.courses ?? []);

  console.log(`Certificate template pack: ${manifest.name}`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log("");
  for (const match of matches) {
    if (match.course) {
      console.log(`MATCHED  ${match.template.title} -> ${match.course.title} (${match.course.id})`);
    } else {
      console.log(`MISSING  ${match.template.title}`);
    }
  }

  const matched = matches.filter((item) => item.course);
  const missing = matches.filter((item) => !item.course);
  console.log("");
  console.log(`Matched: ${matched.length}; missing courses: ${missing.length}`);

  if (!apply) {
    console.log("No files or database records were changed. Add --apply to install matched templates.");
    return;
  }
  if (storage !== "prisma") {
    throw new Error("PostgreSQL is unavailable. Start Docker/PostgreSQL before applying the template pack.");
  }
  if (!matched.length) {
    throw new Error("No matching courses were found; nothing was installed.");
  }

  const originalDb = structuredClone(db);
  const nextDb = structuredClone(db);
  const uploadsDir = resolve("data/uploads");
  await mkdir(uploadsDir, { recursive: true });
  const createdFiles = [];

  try {
    for (const match of matched) {
      const course = nextDb.courses.find((item) => item.id === match.course.id);
      const backgroundSource = resolve(packDir, match.template.background);
      const stampSource = resolve(packDir, manifest.stamp);
      const backgroundHash = await shortFileHash(backgroundSource);
      const stampHash = await shortFileHash(stampSource);
      const safeCourseId = fileSafe(course.id);
      const backgroundName = `certificate_template_${safeCourseId}-${match.template.id}-${backgroundHash}.pdf`;
      const stampName = `certificate_stamp_${safeCourseId}-${stampHash}.png`;
      const backgroundTarget = resolve(uploadsDir, backgroundName);
      const stampTarget = resolve(uploadsDir, stampName);

      if (!(await fileExists(backgroundTarget))) {
        await copyFile(backgroundSource, backgroundTarget);
        createdFiles.push(backgroundTarget);
      }
      if (!(await fileExists(stampTarget))) {
        await copyFile(stampSource, stampTarget);
        createdFiles.push(stampTarget);
      }

      const fields = mergeFields(manifest.fields, match.template.overrides ?? {});
      const designer = {
        version: 2,
        backgroundUrl: `/uploads/${backgroundName}`,
        backgroundType: "pdf",
        stampUrl: `/uploads/${stampName}`,
        pageWidth: manifest.page.width,
        pageHeight: manifest.page.height,
        fields
      };
      course.source = isPlainObject(course.source) ? course.source : {};
      course.source.certificateDesigner = designer;
      course.certificateTemplateHtml = templateHtmlFromDesigner(designer);
    }

    await syncPrismaDb(originalDb, nextDb, { connectionString: resolveConnectionString() });
  } catch (error) {
    await Promise.all(createdFiles.map((path) => rm(path, { force: true }).catch(() => {})));
    throw error;
  }

  console.log(`Installed ${matched.length} template(s). Existing issued certificates were not changed.`);
  if (missing.length) {
    console.log("Create the missing courses, then run the same command again to install their templates.");
  }
}

async function loadDatabaseForInstall(isApply) {
  try {
    return { db: await loadPrismaDb(), storage: "prisma" };
  } catch (error) {
    if (isApply) throw error;
    const fallbackPath = resolve("data/db.json");
    const db = JSON.parse(await readFile(fallbackPath, "utf8"));
    console.warn("PostgreSQL is unavailable; dry run is using data/db.json for course matching.");
    return { db, storage: "json-preview" };
  }
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1) throw new Error("Unsupported certificate template manifest version.");
  if (!manifest.name || !manifest.stamp || !Array.isArray(manifest.fields) || !Array.isArray(manifest.templates)) {
    throw new Error("Certificate template manifest is incomplete.");
  }
  if (!Number.isFinite(manifest.page?.width) || !Number.isFinite(manifest.page?.height)) {
    throw new Error("Certificate template page size is missing.");
  }
  const fieldKeys = new Set(manifest.fields.map((field) => field.key));
  for (const required of ["fullName", "birthDateEn", "certificateNumber", "issuedAt", "expiresAt", "photoImage", "qrCode", "stampImage"]) {
    if (!fieldKeys.has(required)) throw new Error(`Required field is missing from manifest: ${required}`);
  }
}

async function validateAssets(packDir, manifest) {
  const stamp = await readFile(resolve(packDir, manifest.stamp));
  if (!(stamp[0] === 0x89 && stamp.subarray(1, 4).toString("ascii") === "PNG")) {
    throw new Error(`${manifest.stamp} is not a valid PNG file.`);
  }
  for (const template of manifest.templates) {
    if (!template.id || !template.title || !template.background || !Array.isArray(template.aliases)) {
      throw new Error("Each certificate template requires id, title, aliases and background.");
    }
    const pdf = await readFile(resolve(packDir, template.background));
    if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error(`${template.background} is not a valid PDF file.`);
    }
  }
}

function matchTemplatesToCourses(templates, courses) {
  const claimedCourseIds = new Set();
  return templates.map((template) => {
    const names = new Set([template.title, ...template.aliases].map(normalizeName));
    const candidates = courses.filter((course) => names.has(normalizeName(course.title)) && !claimedCourseIds.has(course.id));
    if (candidates.length > 1) {
      throw new Error(`More than one course matches template ${template.title}. Add a more specific alias.`);
    }
    const course = candidates[0] ?? null;
    if (course) claimedCourseIds.add(course.id);
    return { template, course };
  });
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function mergeFields(fields, overrides) {
  return fields.map((field) => ({ ...field, ...(overrides[field.key] ?? {}) }));
}

function templateHtmlFromDesigner(designer) {
  const style = [
    `aspect-ratio:${designer.pageWidth}/${designer.pageHeight}`,
    `max-width:${designer.pageHeight > designer.pageWidth ? 794 : 1123}px`,
    ...(designer.pageHeight > designer.pageWidth ? ["margin-inline:auto"] : [])
  ].join(";");
  const background = `<iframe class="visual-cert-pdf-bg" src="${escapeHtml(designer.backgroundUrl)}#zoom=page-width&toolbar=0&navpanes=0&scrollbar=0" title="Certificate background" tabindex="-1"></iframe>`;
  const fields = [...designer.fields]
    .filter((field) => field.visible)
    .sort((a, b) => Number(a.key === "stampImage") - Number(b.key === "stampImage"))
    .map((field) => {
      const classes = ["visual-cert-field", `align-${field.align}`, ...(field.key === "stampImage" ? ["is-stamp"] : [])].join(" ");
      const fieldStyle = [
        `left:${field.x}%`,
        `top:${field.y}%`,
        `width:${field.width}%`,
        `height:${field.height}%`,
        `font-size:${field.fontSize}px`,
        `color:${field.color}`,
        `font-weight:${field.fontWeight}`,
        `text-align:${field.align}`
      ].join(";");
      const token = field.key === "stampImage"
        ? `<img class="certificate-stamp" src="${escapeHtml(designer.stampUrl)}" alt="Stamp" />`
        : `{{${field.key}}}`;
      return `<div class="${classes}" style="${fieldStyle}">${token}</div>`;
    })
    .join("");
  return `<div class="visual-certificate has-pdf-background" data-visual-certificate="1" data-background-type="pdf" data-background-url="${escapeHtml(designer.backgroundUrl)}" data-page-width="${designer.pageWidth}" data-page-height="${designer.pageHeight}" style="${style}">${background}${fields}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function fileSafe(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function shortFileHash(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
