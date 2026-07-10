import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
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

function migrationDirs() {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readMigration(name) {
  const sql = readFileSync(resolve(migrationsDir, name, "migration.sql"), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  return { sql, checksum };
}

const client = new Client({ connectionString });

try {
  console.log(`Applying Prisma SQL migrations to ${maskedConnectionString(connectionString)}`);
  await client.connect();
  await ensureMigrationTable(client);
  const applied = await appliedMigrations(client);

  for (const name of migrationDirs()) {
    const { sql, checksum } = readMigration(name);
    if (applied.has(name)) {
      if (applied.get(name) !== checksum) {
        throw new Error(`Migration ${name} was already applied with a different checksum.`);
      }
      console.log(`Already applied: ${name}`);
      continue;
    }

    console.log(`Applying: ${name}`);
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
      console.log(`Applied: ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} catch (error) {
  console.error(`Failed to apply Prisma SQL migrations: ${error.message}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
