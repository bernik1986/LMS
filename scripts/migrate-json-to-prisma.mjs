import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "./env.mjs";
import {
  flattenDb,
  maskedConnectionString,
  migrationSummary,
  prismaDataCounts,
  replacePrismaDb,
  resolveConnectionString,
  validateFlatDb
} from "./prisma-db.mjs";

loadLocalEnv();

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const forceReplace = args.has("--force-replace") || process.env.ALLOW_DB_REPLACE === "true";
const dbJsonPath = resolve("data/db.json");
const connectionString = resolveConnectionString();

function loadJsonDb() {
  return JSON.parse(readFileSync(dbJsonPath, "utf8"));
}

const db = loadJsonDb();
const flat = flattenDb(db);
const summary = migrationSummary(flat);
const validation = validateFlatDb(flat);

console.log(
  JSON.stringify(
    {
      mode: apply ? (forceReplace ? "force-replace" : "apply") : "dry-run",
      databaseUrl: maskedConnectionString(connectionString),
      summary,
      validation: {
        errors: validation.errors.length,
        warnings: validation.warnings.length
      }
    },
    null,
    2
  )
);

if (validation.errors.length || validation.warnings.length) {
  if (validation.errors.length) {
    console.error("Migration preflight errors:");
    for (const error of validation.errors) console.error(`- ${error}`);
  }
  if (validation.warnings.length) {
    console.warn("Migration preflight warnings:");
    for (const warning of validation.warnings) console.warn(`- ${warning}`);
  }
}

if (validation.errors.length) {
  console.error("Migration stopped. Fix data errors before applying to PostgreSQL.");
  process.exit(1);
}

if (!apply) {
  console.log("Dry-run only. Run with --apply after PostgreSQL schema is migrated.");
} else {
  const existing = await prismaDataCounts({ connectionString });
  if (existing.total > 0 && !forceReplace) {
    console.error("Migration stopped. PostgreSQL database already contains LMS data.");
    console.error(JSON.stringify({ existing: existing.counts }, null, 2));
    console.error("This protects production data from accidental replacement.");
    console.error("For a deliberate local/dev replacement only, run with --force-replace or ALLOW_DB_REPLACE=true.");
    process.exit(1);
  }
  await replacePrismaDb(db, { connectionString });
  console.log("JSON data migrated to Prisma/PostgreSQL.");
}
