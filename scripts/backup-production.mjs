import { closeSync, cpSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadLocalEnv } from "./env.mjs";
import { maskedConnectionString, resolveConnectionString } from "./prisma-db.mjs";

loadLocalEnv();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = resolve("backups", `production-${stamp}`);
const uploadsPath = resolve("data/uploads");
const dbDumpPath = resolve(backupDir, "postgres.sql");
const pgDumpBin = process.env.PG_DUMP_BIN || "pg_dump";
const connectionString = resolveConnectionString();
const skipUploads =
  process.argv.includes("--skip-uploads") ||
  ["0", "false", "no"].includes(String(process.env.BACKUP_UPLOADS ?? "").toLowerCase());

function pgDumpConnectionString(value) {
  try {
    const url = new URL(value);
    url.search = "";
    return url.toString();
  } catch {
    return String(value).split("?")[0];
  }
}

mkdirSync(backupDir, { recursive: true });

console.log(`Creating production backup in ${backupDir}`);
console.log(`Database: ${maskedConnectionString(connectionString)}`);

let fd;
try {
  fd = openSync(dbDumpPath, "w");
  const result = spawnSync(pgDumpBin, [pgDumpConnectionString(connectionString)], {
    stdio: ["ignore", fd, "pipe"],
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `pg_dump exited with status ${result.status}`);
  }
  console.log(`Database dump created: ${dbDumpPath}`);
} catch (error) {
  if (existsSync(dbDumpPath)) rmSync(dbDumpPath, { force: true });
  console.error(`Database backup failed: ${error.message}`);
  console.error("Install PostgreSQL client tools or set PG_DUMP_BIN to the full path of pg_dump.");
  process.exitCode = 1;
} finally {
  if (fd !== undefined) closeSync(fd);
}

if (skipUploads) {
  console.log("Uploads backup skipped by --skip-uploads/BACKUP_UPLOADS.");
} else if (existsSync(uploadsPath)) {
  cpSync(uploadsPath, resolve(backupDir, "uploads"), { recursive: true });
  console.log(`Uploads copied: ${resolve(backupDir, "uploads")}`);
} else {
  console.warn("data/uploads does not exist; uploads were not copied.");
}

if (process.exitCode) {
  console.error("Backup finished with errors.");
} else {
  console.log("Backup finished.");
}
