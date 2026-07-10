import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = resolve("backups", stamp);
const dbPath = resolve("data/db.json");
const uploadsPath = resolve("data/uploads");

mkdirSync(backupDir, { recursive: true });

if (existsSync(dbPath)) {
  copyFileSync(dbPath, resolve(backupDir, "db.json"));
}

if (existsSync(uploadsPath)) {
  cpSync(uploadsPath, resolve(backupDir, "uploads"), { recursive: true });
}

console.log(`Backup created: ${backupDir}`);
