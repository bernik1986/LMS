import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { loadLocalEnv } from "./env.mjs";
import { loadPrismaDb } from "./prisma-db.mjs";
import { prepareAssessmentCorrection } from "./assessment-regrade.mjs";

loadLocalEnv();
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const asOf = value("--as-of");
if (!args.includes("--as-of") || !asOf) throw new Error("Specify --as-of ISO_TIMESTAMP to freeze the seven-day review window.");
const path = resolve(args.includes("--plan") ? value("--plan") : "scripts/assessment-corrections-2026-11-06.json");
const rawPlan = readFileSync(path, "utf8");
const plan = JSON.parse(rawPlan);
plan.sha256 = createHash("sha256").update(rawPlan).digest("hex");
let report;
if (args.includes("--apply")) {
  if (process.env.LMS_MAINTENANCE_CONFIRMED !== "true") throw new Error("Stop all application writers and set LMS_MAINTENANCE_CONFIRMED=true before applying.");
  process.env.LMS_CLI_MODE = "true";
  process.env.LMS_ASSESSMENT_MAINTENANCE = "true";
  const { applyAssessmentCorrectionMaintenance } = await import("./lms-server.mjs");
  const approvedManualAssignmentIds = args.includes("--approve-certificates") ? value("--approve-certificates").split(",").filter(Boolean) : [];
  report = await applyAssessmentCorrectionMaintenance(plan, { asOf, approvedManualAssignmentIds });
} else {
  const database = await loadPrismaDb();
  report = prepareAssessmentCorrection(database, plan, { asOf }).report;
}
if (args.includes("--report")) writeFileSync(resolve(value("--report")), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
