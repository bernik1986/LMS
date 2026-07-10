import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { loadLocalEnv } from "./env.mjs";
import {
  flattenDb,
  loadPrismaDb,
  maskedConnectionString,
  migrationSummary,
  resolveConnectionString,
  validateFlatDb
} from "./prisma-db.mjs";

loadLocalEnv();

const strict = process.argv.includes("--strict");
const skipUploads = process.argv.includes("--skip-uploads") || process.env.PROD_CHECK_SKIP_UPLOADS === "true";
const uploadsDir = resolve("data/uploads");
const errors = [];
const warnings = [];
const info = [];

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

function addInfo(message) {
  info.push(message);
}

function envValue(name) {
  return process.env[name] ?? "";
}

function checkEnv() {
  const databaseUrl = envValue("DATABASE_URL");
  const storage = envValue("LMS_STORAGE").toLowerCase();
  const publicBaseUrl = envValue("PUBLIC_BASE_URL");
  const port = envValue("PORT") || "3000";

  if (!databaseUrl) addError("DATABASE_URL is not set.");
  if (databaseUrl.includes("postgres:postgres@localhost")) {
    addWarning("DATABASE_URL still points to the local default PostgreSQL password/host.");
  }
  if (!["prisma", "postgres", "postgresql"].includes(storage)) {
    addError('LMS_STORAGE must be "prisma" for production.');
  }
  if (!publicBaseUrl) {
    addError("PUBLIC_BASE_URL is not set.");
  } else {
    if (!/^https:\/\//i.test(publicBaseUrl)) addWarning("PUBLIC_BASE_URL should use HTTPS in production.");
    if (/localhost|127\.0\.0\.1/i.test(publicBaseUrl)) addWarning("PUBLIC_BASE_URL still points to localhost.");
    if (publicBaseUrl.endsWith("/")) addWarning("PUBLIC_BASE_URL should not end with a slash.");
  }
  if (!Number.isInteger(Number(port)) || Number(port) <= 0) addError("PORT must be a positive number.");
  if (envValue("SEED_ADMIN_PASSWORD") === "ChangeMe123!") {
    addWarning("SEED_ADMIN_PASSWORD is still the example value.");
  }
  if (!envValue("SMTP_HOST") || !envValue("SMTP_FROM")) {
    addWarning("SMTP is not configured. Notifications will stay in the admin log until SMTP is configured.");
  }
  if (envValue("SMTP_TLS_REJECT_UNAUTHORIZED") === "false") {
    addWarning("SMTP TLS certificate validation is disabled. Use this only temporarily for local testing; fix the mail server certificate for production.");
  }
  if (process.env.NODE_ENV !== "production") {
    addWarning("NODE_ENV is not set to production.");
  }
}

function directoryStats(path) {
  let files = 0;
  let bytes = 0;
  if (!existsSync(path)) return { files, bytes };
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const childPath = resolve(path, entry.name);
    if (entry.isDirectory()) {
      const child = directoryStats(childPath);
      files += child.files;
      bytes += child.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += statSync(childPath).size;
    }
  }
  return { files, bytes };
}

function formatBytes(value) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function uploadPathFromPublicPath(publicPath) {
  const cleanPublicPath = String(publicPath).split(/[?#]/)[0];
  if (!cleanPublicPath.startsWith("/uploads/")) return null;
  let decoded = "";
  try {
    decoded = decodeURIComponent(cleanPublicPath.slice("/uploads/".length)).replace(/^[/\\]+/, "");
  } catch {
    return null;
  }
  const path = resolve(uploadsDir, decoded);
  const uploadRelativePath = relative(uploadsDir, path);
  if (uploadRelativePath.startsWith("..") || isAbsolute(uploadRelativePath)) return null;
  return path;
}

function collectUploadRefs(value, source, refs) {
  if (typeof value === "string") {
    const matches = value.match(/\/uploads\/[^"'<>\s)]+/g) ?? [];
    for (const match of matches) {
      const publicPath = match.replace(/&amp;/g, "&").split(/[?#]/)[0];
      if (!refs.has(publicPath)) refs.set(publicPath, new Set());
      refs.get(publicPath).add(source);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUploadRefs(item, `${source}[${index}]`, refs));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    collectUploadRefs(child, `${source}.${key}`, refs);
  }
}

function checkUploads(flat) {
  if (skipUploads) {
    addWarning("Upload reference check skipped. Run npm run prod:check after copying data/uploads.");
    if (existsSync(uploadsDir)) {
      const stats = directoryStats(uploadsDir);
      addInfo(`uploads: ${stats.files} files, ${formatBytes(stats.bytes)} (not validated)`);
    }
    return;
  }

  if (!existsSync(uploadsDir)) {
    addError("data/uploads does not exist. Transfer the whole uploads folder before production launch.");
    return;
  }
  try {
    accessSync(uploadsDir, constants.R_OK | constants.W_OK);
  } catch {
    addError("data/uploads is not readable and writable by the application process.");
  }

  const stats = directoryStats(uploadsDir);
  addInfo(`uploads: ${stats.files} files, ${formatBytes(stats.bytes)}`);

  const refs = new Map();
  collectUploadRefs(flat, "db", refs);
  const missing = [];
  for (const [publicPath, sources] of refs.entries()) {
    const filePath = uploadPathFromPublicPath(publicPath);
    if (!filePath || !existsSync(filePath)) {
      missing.push({ publicPath, sources: [...sources].slice(0, 3) });
    }
  }
  if (missing.length) {
    addError(`${missing.length} referenced upload file(s) are missing.`);
    for (const item of missing.slice(0, 20)) {
      addError(`Missing ${item.publicPath} referenced from ${item.sources.join(", ")}`);
    }
    if (missing.length > 20) addError(`...and ${missing.length - 20} more missing upload file(s).`);
  } else {
    addInfo(`upload references: ${refs.size} checked, 0 missing`);
  }
}

async function checkDatabase() {
  const connectionString = resolveConnectionString();
  addInfo(`database: ${maskedConnectionString(connectionString)}`);
  const db = await loadPrismaDb({ connectionString });
  const flat = flattenDb(db);
  const validation = validateFlatDb(flat);
  const summary = migrationSummary(flat);

  addInfo(`db summary: ${JSON.stringify(summary)}`);
  for (const error of validation.errors) addError(error);
  for (const warning of validation.warnings) addWarning(warning);
  checkUploads(flat);
}

async function main() {
  checkEnv();
  if (!existsSync("package-lock.json")) addWarning("package-lock.json is missing. Use npm ci on production when possible.");
  if (!existsSync("prisma/migrations")) addError("prisma/migrations folder is missing.");
  await checkDatabase();

  console.log("Production readiness check");
  for (const line of info) console.log(`OK: ${line}`);
  for (const warning of warnings) console.warn(`WARN: ${warning}`);
  for (const error of errors) console.error(`ERROR: ${error}`);

  const shouldFail = errors.length > 0 || (strict && warnings.length > 0);
  if (shouldFail) {
    console.error(`Result: failed (${errors.length} error(s), ${warnings.length} warning(s)).`);
    process.exit(1);
  }
  console.log(`Result: passed (${warnings.length} warning(s)).`);
}

main().catch((error) => {
  console.error(`Production readiness check crashed: ${error.message}`);
  process.exit(1);
});
