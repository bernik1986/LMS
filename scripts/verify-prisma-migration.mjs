import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve("prisma/migrations/20260702160000_init/migration.sql"), "utf8");

const models = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]);
const enums = [...schema.matchAll(/^enum\s+(\w+)\s+\{/gm)].map((match) => match[1]);
const missing = [];

for (const name of models) {
  if (!migration.includes(`CREATE TABLE "${name}"`)) {
    missing.push(`Missing CREATE TABLE for model ${name}`);
  }
}

for (const name of enums) {
  if (!migration.includes(`CREATE TYPE "${name}" AS ENUM`)) {
    missing.push(`Missing CREATE TYPE for enum ${name}`);
  }
}

if (!migration.includes('CREATE UNIQUE INDEX "User_email_key"')) {
  missing.push("Missing unique user email index");
}
if (!migration.includes('CREATE UNIQUE INDEX "CourseAssignment_userId_courseId_key"')) {
  missing.push("Missing unique assignment user/course index");
}
if (!migration.includes('CREATE UNIQUE INDEX "Certificate_certificateNumber_key"')) {
  missing.push("Missing unique certificate number index");
}

if (missing.length) {
  console.error("Prisma migration verification failed:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Prisma migration covers ${models.length} models and ${enums.length} enums.`);
