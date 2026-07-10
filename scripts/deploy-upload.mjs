import { createRequire } from "node:module";
import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";

const require = createRequire(import.meta.url);
const { Client } = require("../.deploy-tools/node_modules/ssh2");

const localPath = process.argv[2];
const remotePath = process.argv[3];

if (!localPath || !remotePath) {
  console.error("Usage: node scripts/deploy-upload.mjs <localPath> <remotePath>");
  process.exit(2);
}

const host = process.env.DEPLOY_HOST || "109.94.209.94";
const username = process.env.DEPLOY_USER || "root";
const privateKey = statSync(".deploy-keys/marine_lms_codex_rsa") && require("node:fs").readFileSync(".deploy-keys/marine_lms_codex_rsa");
const size = statSync(localPath).size;
let sent = 0;
let lastLogged = 0;

const conn = new Client();

function remoteDir(path) {
  return path.split("/").slice(0, -1).join("/") || "/";
}

function sftpMkdirp(sftp, path) {
  const parts = path.split("/").filter(Boolean);
  let current = path.startsWith("/") ? "/" : "";
  return parts.reduce(
    (promise, part) =>
      promise.then(
        () =>
          new Promise((resolve) => {
            current = current === "/" ? `/${part}` : `${current}/${part}`;
            sftp.mkdir(current, () => resolve());
          })
      ),
    Promise.resolve()
  );
}

conn
  .on("ready", () => {
    conn.sftp(async (error, sftp) => {
      if (error) {
        console.error(error.message);
        conn.end();
        process.exit(1);
        return;
      }
      await sftpMkdirp(sftp, remoteDir(remotePath));
      const read = createReadStream(localPath);
      const write = sftp.createWriteStream(remotePath);
      read.on("data", (chunk) => {
        sent += chunk.length;
        const percent = size ? Math.floor((sent / size) * 100) : 100;
        if (percent >= lastLogged + 10 || percent === 100) {
          lastLogged = percent;
          console.log(`${basename(localPath)}: ${percent}%`);
        }
      });
      write.on("close", () => {
        console.log(`uploaded ${localPath} -> ${remotePath}`);
        conn.end();
      });
      write.on("error", (streamError) => {
        console.error(streamError.message);
        conn.end();
        process.exit(1);
      });
      read.pipe(write);
    });
  })
  .on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  })
  .connect({ host, username, privateKey, readyTimeout: 20000 });
