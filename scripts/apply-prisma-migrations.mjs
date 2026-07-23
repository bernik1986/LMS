import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadLocalEnv } from "./env.mjs";
import { maskedConnectionString, resolveConnectionString } from "./prisma-db.mjs";

loadLocalEnv();

const migrationsDir = resolve("prisma/migrations");
const connectionString = resolveConnectionString();
const { Client } = pg;

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    );
  `);
}

async function appliedMigrations(client) {
  const result = await client.query('SELECT "migration_name", "checksum" FROM "_prisma_migrations" WHERE "rolled_back_at" IS NULL');
  return new Map(result.rows.map((row) => [row.migration_name, row.checksum]));
}

function migrationDirs(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readMigration(directory, name) {
  const sql = readFileSync(resolve(directory, name, "migration.sql"), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  return { sql, checksum };
}

export async function applyPrismaMigrations(options = {}) {
  const targetConnectionString = resolveConnectionString(options.connectionString);
  const targetMigrationsDir = resolve(options.migrationsDir ?? migrationsDir);
  const client = options.client ?? new Client({ connectionString: targetConnectionString });
  const shouldDisconnect = !options.client;
  const log = options.log ?? console;
  const appliedNames = [];
  const skippedNames = [];

  try {
    log.log(`Applying Prisma SQL migrations to ${maskedConnectionString(targetConnectionString)}`);
    if (shouldDisconnect) await client.connect();
    await ensureMigrationTable(client);
    const applied = await appliedMigrations(client);

    for (const name of migrationDirs(targetMigrationsDir)) {
      const { sql, checksum } = readMigration(targetMigrationsDir, name);
      if (applied.has(name)) {
        if (applied.get(name) !== checksum) {
          throw new Error(`Migration ${name} was already applied with a different checksum.`);
        }
        skippedNames.push(name);
        log.log(`Already applied: ${name}`);
        continue;
      }

      log.log(`Applying: ${name}`);
      const startedAt = new Date();
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
           VALUES ($1, $2, now(), $3, NULL, NULL, $4, 1)`,
          [randomUUID(), checksum, name, startedAt]
        );
        await client.query("COMMIT");
        appliedNames.push(name);
        log.log(`Applied: ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { applied: appliedNames, skipped: skippedNames };
  } finally {
    if (shouldDisconnect) await client.end().catch(() => {});
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  try {
    await applyPrismaMigrations({ connectionString });
  } catch (error) {
    console.error(`Failed to apply Prisma SQL migrations: ${error.message}`);
    process.exitCode = 1;
  }
}
