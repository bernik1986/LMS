import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { Client } = require("../.deploy-tools/node_modules/ssh2");

const host = process.env.DEPLOY_HOST || "109.94.209.94";
const username = process.env.DEPLOY_USER || "root";
const privateKey = readFileSync(process.env.DEPLOY_KEY || ".deploy-keys/marine_lms_codex_rsa");
let command = process.argv.slice(2).join(" ");

if (!command) {
  command = readFileSync(0, "utf8").trim();
}

if (!command) {
  console.error("Usage: node scripts/deploy-remote.mjs <command>");
  console.error("   or: <command> | node scripts/deploy-remote.mjs");
  process.exit(2);
}

const conn = new Client();

conn
  .on("ready", () => {
    conn.exec(command, { pty: false }, (error, stream) => {
      if (error) {
        console.error(error.message);
        conn.end();
        process.exit(1);
        return;
      }
      stream.on("data", (chunk) => process.stdout.write(chunk));
      stream.stderr.on("data", (chunk) => process.stderr.write(chunk));
      stream.on("close", (code) => {
        conn.end();
        process.exit(code ?? 0);
      });
    });
  })
  .on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  })
  .connect({ host, username, privateKey, readyTimeout: 20000 });
