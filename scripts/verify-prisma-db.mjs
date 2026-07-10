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

const connectionString = resolveConnectionString();

try {
  const db = await loadPrismaDb({ connectionString });
  const flat = flattenDb(db);
  const validation = validateFlatDb(flat);

  console.log(
    JSON.stringify(
      {
        databaseUrl: maskedConnectionString(connectionString),
        summary: migrationSummary(flat),
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
      console.error("Database verification errors:");
      for (const error of validation.errors) console.error(`- ${error}`);
    }
    if (validation.warnings.length) {
      console.warn("Database verification warnings:");
      for (const warning of validation.warnings) console.warn(`- ${warning}`);
    }
  }

  if (validation.errors.length) {
    process.exit(1);
  }
} catch (error) {
  console.error(`Cannot verify PostgreSQL database: ${error.message}`);
  process.exit(1);
}
