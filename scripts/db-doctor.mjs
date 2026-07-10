import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { promisify } from "node:util";
import { loadLocalEnv } from "./env.mjs";
import { flattenDb, maskedConnectionString, migrationSummary, resolveConnectionString, validateFlatDb } from "./prisma-db.mjs";

loadLocalEnv();

const execFileAsync = promisify(execFile);

function databaseHostPort(connectionString) {
  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname || "127.0.0.1",
      port: Number(url.port || 5432)
    };
  } catch {
    return { host: "127.0.0.1", port: 5432 };
  }
}

async function dockerStatus() {
  try {
    const { stdout } = await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 15000 });
    return { ok: true, message: stdout.trim() };
  } catch (error) {
    return { ok: false, message: `${error.stderr || error.stdout || error.message}`.trim() };
  }
}

async function tcpStatus(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(3000);
    socket.once("connect", () => {
      socket.destroy();
      resolve({ ok: true, message: `${host}:${port} is open` });
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve({ ok: false, message: `${host}:${port} timed out` });
    });
    socket.once("error", (error) => {
      resolve({ ok: false, message: `${host}:${port} ${error.code || error.message}` });
    });
  });
}

function jsonPreflight() {
  const db = JSON.parse(readFileSync("data/db.json", "utf8"));
  const flat = flattenDb(db);
  const validation = validateFlatDb(flat);
  return {
    summary: migrationSummary(flat),
    errors: validation.errors,
    warnings: validation.warnings
  };
}

const connectionString = resolveConnectionString();
const { host, port } = databaseHostPort(connectionString);
const [docker, tcp] = await Promise.all([dockerStatus(), tcpStatus(host, port)]);
const preflight = jsonPreflight();

console.log(`DATABASE_URL: ${maskedConnectionString(connectionString)}`);
console.log(`Docker: ${docker.ok ? "ok" : "not ready"}${docker.message ? ` (${docker.message})` : ""}`);
console.log(`PostgreSQL TCP: ${tcp.ok ? "ok" : "not ready"} (${tcp.message})`);
console.log(`JSON preflight: ${preflight.errors.length} errors, ${preflight.warnings.length} warnings`);
console.log(JSON.stringify({ summary: preflight.summary }, null, 2));

if (preflight.errors.length) {
  console.error("JSON preflight errors:");
  for (const error of preflight.errors) console.error(`- ${error}`);
}
if (preflight.warnings.length) {
  console.warn("JSON preflight warnings:");
  for (const warning of preflight.warnings) console.warn(`- ${warning}`);
}

if (!docker.ok && tcp.ok) {
  console.warn("Docker API is not available from this process, but PostgreSQL TCP is open. Continuing checks through TCP is enough for migration commands.");
}

if (!tcp.ok || preflight.errors.length) {
  process.exit(1);
}
