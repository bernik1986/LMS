import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { loadLocalEnv } from "./env.mjs";
import { loadPrismaDb, maskedConnectionString, replacePrismaDb, resolveConnectionString } from "./prisma-db.mjs";

loadLocalEnv();

const apply = process.argv.includes("--apply");
const uploadsDir = resolve("data/uploads");
const backupDir = resolve("backups", `upload-path-repair-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const connectionString = resolveConnectionString();

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

function publicPathFromUploadPath(path) {
  const uploadRelativePath = relative(uploadsDir, path).replaceAll("\\", "/");
  return `/uploads/${uploadRelativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function collectUploadRefs(value, refs) {
  if (typeof value === "string") {
    for (const match of value.match(/\/uploads\/[^"'<>\s)]+/g) ?? []) {
      refs.add(match.replace(/&amp;/g, "&").split(/[?#]/)[0]);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectUploadRefs(item, refs));
    return;
  }
  Object.values(value).forEach((item) => collectUploadRefs(item, refs));
}

function candidateByImportedWordpressPath(publicPath) {
  const clean = publicPath.replace(/^\/uploads\//, "");
  return resolve(uploadsDir, "imported-wordpress", clean);
}

function candidateByDirectorySearch(publicPath) {
  const exactImported = candidateByImportedWordpressPath(publicPath);
  const dir = dirname(exactImported);
  if (!existsSync(dir)) return null;

  const requestedName = basename(exactImported);
  const requestedExt = extname(requestedName).toLowerCase();
  const requestedStem = requestedExt ? requestedName.slice(0, -requestedExt.length) : requestedName;
  const normalizedRequestedName = normalizeFileName(requestedName);
  const normalizedRequestedStem = normalizeFileName(requestedStem);
  const files = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);

  const normalizedMatches = files.filter((name) => normalizeFileName(name) === normalizedRequestedName);
  if (normalizedMatches.length === 1) return resolve(dir, normalizedMatches[0]);

  const prefixMatches = files.filter((name) => {
    const ext = extname(name).toLowerCase();
    const stem = ext ? name.slice(0, -ext.length) : name;
    if (requestedExt && ext && requestedExt !== ext) return false;
    return normalizeFileName(stem).startsWith(normalizedRequestedStem);
  });
  if (prefixMatches.length === 1) return resolve(dir, prefixMatches[0]);

  return null;
}

function replacementFor(publicPath) {
  const current = uploadPathFromPublicPath(publicPath);
  if (current && existsSync(current)) return null;

  const exactImported = candidateByImportedWordpressPath(publicPath);
  if (existsSync(exactImported)) return publicPathFromUploadPath(exactImported);

  const searched = candidateByDirectorySearch(publicPath);
  if (searched && existsSync(searched)) return publicPathFromUploadPath(searched);

  return null;
}

function replaceInValue(value, replacements) {
  if (typeof value === "string") {
    let next = value;
    for (const [from, to] of replacements) next = next.split(from).join(to);
    return next;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => replaceInValue(item, replacements));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceInValue(item, replacements)]));
}

const db = await loadPrismaDb({ connectionString });
const refs = new Set();
collectUploadRefs(db, refs);

const replacements = new Map();
const unresolved = [];
for (const publicPath of refs) {
  const current = uploadPathFromPublicPath(publicPath);
  if (current && existsSync(current)) continue;
  const replacement = replacementFor(publicPath);
  if (replacement) {
    replacements.set(publicPath, replacement);
  } else {
    unresolved.push(publicPath);
  }
}

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      databaseUrl: maskedConnectionString(connectionString),
      replacements: replacements.size,
      unresolved: unresolved.length
    },
    null,
    2
  )
);

for (const [from, to] of [...replacements.entries()].slice(0, 80)) {
  console.log(`${from} -> ${to}`);
}
if (replacements.size > 80) console.log(`...and ${replacements.size - 80} more replacements.`);

if (unresolved.length) {
  console.warn("Unresolved missing upload paths:");
  for (const item of unresolved.slice(0, 40)) console.warn(`- ${item}`);
  if (unresolved.length > 40) console.warn(`...and ${unresolved.length - 40} more unresolved path(s).`);
}

if (!apply) {
  console.log("Dry-run only. Run npm run prod:repair-uploads:apply to update database links.");
} else {
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(resolve(backupDir, "db-before.json"), JSON.stringify(db, null, 2));
  const repaired = replaceInValue(db, replacements);
  writeFileSync(resolve(backupDir, "db-after.json"), JSON.stringify(repaired, null, 2));
  await replacePrismaDb(repaired, { connectionString });
  console.log(`Database links updated. JSON backup written to ${backupDir}`);
}
