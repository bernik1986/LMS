import { createRequire } from "node:module";
import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { Client } = require("../.deploy-tools/node_modules/ssh2");

const localRoot = process.argv[2];
const remoteRoot = process.argv[3];

if (!localRoot || !remoteRoot) {
  console.error("Usage: node scripts/deploy-upload-dir.mjs <localDir> <remoteDir>");
  process.exit(2);
}

const host = process.env.DEPLOY_HOST || "109.94.209.94";
const username = process.env.DEPLOY_USER || "root";
const privateKey = readFileSync(".deploy-keys/marine_lms_codex_rsa");

function collectFiles(root, current = root) {
  const entries = readdirSync(current, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(root, fullPath);
    }
    if (!entry.isFile()) {
      return [];
    }
    const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
    return [{ fullPath, relativePath, size: statSync(fullPath).size }];
  });
}

function remoteJoin(...parts) {
  return parts
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
}

function remoteDir(filePath) {
  return filePath.split("/").slice(0, -1).join("/") || "/";
}

function mkdirp(sftp, targetPath) {
  const parts = targetPath.split("/").filter(Boolean);
  let current = targetPath.startsWith("/") ? "/" : "";
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

function statRemote(sftp, targetPath) {
  return new Promise((resolve) => {
    sftp.stat(targetPath, (error, stats) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(stats);
    });
  });
}

async function uploadFile(sftp, file, targetPath, uploadedBefore, totalBytes) {
  const existing = await statRemote(sftp, targetPath);
  if (existing?.size === file.size) {
    console.log(`skip ${file.relativePath} (${file.size} bytes already uploaded)`);
    return { skipped: true, uploaded: 0 };
  }

  await mkdirp(sftp, remoteDir(targetPath));

  return new Promise((resolve, reject) => {
    let fileSent = 0;
    let lastLogAt = Date.now();
    const startAt = Date.now();
    const read = createReadStream(file.fullPath);
    const write = sftp.createWriteStream(targetPath);

    read.on("data", (chunk) => {
      fileSent += chunk.length;
      const now = Date.now();
      if (now - lastLogAt >= 30000 || fileSent === file.size) {
        lastLogAt = now;
        const percent = file.size ? Math.floor((fileSent / file.size) * 100) : 100;
        const totalPercent = totalBytes
          ? Math.floor(((uploadedBefore + fileSent) / totalBytes) * 100)
          : 100;
        const elapsed = Math.max(1, (now - startAt) / 1000);
        const mbps = fileSent / elapsed / 1024 / 1024;
        console.log(
          `upload ${file.relativePath}: ${percent}% (${totalPercent}% total, ${mbps.toFixed(1)} MiB/s)`
        );
      }
    });

    read.on("error", reject);
    write.on("error", reject);
    write.on("close", () => resolve({ skipped: false, uploaded: file.size }));
    read.pipe(write);
  });
}

const files = collectFiles(path.resolve(localRoot)).sort((a, b) =>
  a.relativePath.localeCompare(b.relativePath)
);
const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

console.log(`Found ${files.length} file(s), ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GiB total.`);

const conn = new Client();

conn
  .on("ready", () => {
    conn.sftp(async (error, sftp) => {
      if (error) {
        console.error(error.message);
        conn.end();
        process.exit(1);
        return;
      }

      try {
        await mkdirp(sftp, remoteRoot);
        let uploadedBytes = 0;
        let skippedCount = 0;

        for (const file of files) {
          const targetPath = remoteJoin(remoteRoot, file.relativePath);
          const result = await uploadFile(sftp, file, targetPath, uploadedBytes, totalBytes);
          if (result.skipped) {
            skippedCount += 1;
            uploadedBytes += file.size;
          } else {
            uploadedBytes += result.uploaded;
          }
        }

        console.log(
          `done: ${files.length} file(s), skipped ${skippedCount}, ${(uploadedBytes / 1024 / 1024 / 1024).toFixed(2)} GiB accounted`
        );
        conn.end();
      } catch (uploadError) {
        console.error(uploadError.message);
        conn.end();
        process.exit(1);
      }
    });
  })
  .on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  })
  .connect({
    host,
    username,
    privateKey,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 12,
  });
