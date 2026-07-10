import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const dbPath = resolve("data/db.json");

if (existsSync(dbPath)) {
  rmSync(dbPath);
  console.log("Demo data reset. It will be recreated on the next server start or request.");
} else {
  console.log("Demo data is already clean.");
}
