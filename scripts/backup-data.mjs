import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function createDataBackup(options = {}) {
  const rootDir = resolve(options.rootDir ?? ".");
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const backupDir = resolve(options.backupRoot ?? resolve(rootDir, "backups"), stamp);
  const dbPath = resolve(options.dbPath ?? resolve(rootDir, "data/db.json"));
  const uploadsPath = resolve(options.uploadsPath ?? resolve(rootDir, "data/uploads"));
  const log = options.log ?? console;

  mkdirSync(backupDir, { recursive: true });

  let databaseCopied = false;
  let uploadsCopied = false;
  if (existsSync(dbPath)) {
    copyFileSync(dbPath, resolve(backupDir, "db.json"));
    databaseCopied = true;
  }

  if (existsSync(uploadsPath)) {
    cpSync(uploadsPath, resolve(backupDir, "uploads"), { recursive: true });
    uploadsCopied = true;
  }

  log.log(`Backup created: ${backupDir}`);
  return { backupDir, databaseCopied, uploadsCopied };
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) createDataBackup();
