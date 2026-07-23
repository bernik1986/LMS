import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const testsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const projectRoot = resolve(testsDir, "..");

function sleep(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function availablePort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

export async function startSmtpFixture() {
  const messages = [];
  const sockets = new Set();
  const state = {
    rejectRecipients: false,
    transientRecipientFailure: false,
    rcptCommands: 0
  };
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    let receivingData = false;
    let messageLines = [];
    socket.write("220 tests.smtp ESMTP ready\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\r\n")) {
        const lineEnd = buffer.indexOf("\r\n");
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        if (receivingData) {
          if (line === ".") {
            messages.push(messageLines.join("\r\n"));
            messageLines = [];
            receivingData = false;
            socket.write("250 2.0.0 queued\r\n");
          } else {
            messageLines.push(line.startsWith("..") ? line.slice(1) : line);
          }
          continue;
        }
        const command = line.toUpperCase();
        if (command.startsWith("EHLO") || command.startsWith("HELO")) {
          socket.write("250-tests.smtp\r\n250 SIZE 52428800\r\n");
        } else if (command.startsWith("MAIL FROM")) {
          socket.write("250 2.1.0 sender accepted\r\n");
        } else if (command.startsWith("RCPT TO")) {
          state.rcptCommands += 1;
          if (state.rejectRecipients) socket.write("550 5.1.1 recipient rejected\r\n");
          else if (state.transientRecipientFailure) socket.write("451 4.7.1 temporary rate limit\r\n");
          else socket.write("250 2.1.5 recipient accepted\r\n");
        } else if (command === "DATA") {
          receivingData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (command === "QUIT") {
          socket.write("221 2.0.0 closing connection\r\n");
          socket.end();
        } else {
          socket.write("250 2.0.0 accepted\r\n");
        }
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    messages,
    state,
    port: server.address().port,
    async stop() {
      for (const socket of sockets) socket.destroy();
      if (!server.listening) return;
      const closed = once(server, "close");
      server.close();
      await closed;
    }
  };
}

export function decodedSmtpText(message) {
  const parts = [];
  const pattern = /Content-Type: text\/(?:plain|html); charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)(?=\r\n--)/g;
  for (const match of String(message ?? "").matchAll(pattern)) {
    parts.push(Buffer.from(match[1].replace(/\s/g, ""), "base64").toString("utf8"));
  }
  return parts.join("\n");
}

export function smtpAttachmentNames(message) {
  return [...String(message ?? "").matchAll(/Content-Disposition: attachment;\s*filename="([^"]+)"/g)].map((match) => match[1]);
}

function createImoFixture(path) {
  const cards = Array.from({ length: 22 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `<div><img src="https://wwwcdn.imo.org/localresources/test-${index + 1}.jpg"><span class="badge badge-primary">${day} January 2026</span><h3 class="card-title"><a href="/en/MediaCentre/PressBriefings/pages/test-${index + 1}.aspx">IMO test news ${index + 1}</a></h3><p class="card-text">Official test summary ${index + 1}</p></div>`;
  }).reverse().join("\n");
  writeFileSync(path, cards, "utf8");
}

function cookieFrom(response) {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

export async function startTestServer(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "marine-lms-tests-"));
  const dbPath = resolve(root, "db.json");
  const uploadsDir = resolve(root, "uploads");
  const imoFixturePath = resolve(root, "imo-news.html");
  mkdirSync(uploadsDir, { recursive: true });
  createImoFixture(imoFixturePath);
  if (options.seedDb) writeFileSync(dbPath, `${JSON.stringify(options.seedDb, null, 2)}\n`, "utf8");

  const smtp = options.smtp === false ? null : await startSmtpFixture();
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const stdout = [];
  const stderr = [];
  const serverEnv = {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    PUBLIC_BASE_URL: baseUrl,
    LMS_STORAGE: "json",
    LMS_DB_PATH: dbPath,
    LMS_UPLOADS_DIR: uploadsDir,
    IMO_NEWS_FIXTURE_PATH: imoFixturePath,
    SMTP_HOST: smtp ? "127.0.0.1" : "",
    SMTP_PORT: smtp ? String(smtp.port) : "",
    SMTP_SECURE: "false",
    SMTP_STARTTLS: "false",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM: "info@maritimeportal.test",
    SMTP_FROM_NAME: "Maritime Portal",
    SMTP_CONNECTION_TIMEOUT_SECONDS: "5",
    SMTP_RETRY_MINUTES: "1",
    SMTP_RATE_LIMIT_RETRY_MINUTES: "1",
    ...options.env
  };
  let child = null;
  let inProcessServer = null;
  let previousEnv = null;
  if (options.inProcess) {
    previousEnv = Object.fromEntries(Object.keys(serverEnv).map((key) => [key, process.env[key]]));
    Object.assign(process.env, serverEnv);
    const serverModuleUrl = `${pathToFileURL(resolve(projectRoot, "scripts/lms-server.mjs")).href}?test=${Date.now()}-${Math.random()}`;
    ({ server: inProcessServer } = await import(serverModuleUrl));
  } else {
    child = spawn(process.execPath, [resolve(projectRoot, "scripts/lms-server.mjs")], {
      cwd: projectRoot,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
  }

  async function request(path, requestOptions = {}) {
    const response = await fetch(`${baseUrl}${path}`, { redirect: "manual", ...requestOptions });
    const body = Buffer.from(await response.arrayBuffer());
    return { response, body, text: body.toString("utf8") };
  }

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child && child.exitCode !== null) {
      throw new Error(`Test server exited early (${child.exitCode}).\n${stderr.join("")}\n${stdout.join("")}`);
    }
    try {
      const health = await request("/healthz");
      if (health.response.status === 200) break;
    } catch {
      // The isolated database is still being initialized.
    }
    if (attempt === 79) {
      child?.kill();
      inProcessServer?.close();
      await smtp?.stop();
      throw new Error(`Test server did not become ready.\n${stderr.join("")}\n${stdout.join("")}`);
    }
    await sleep(100);
  }

  const csrfTokens = new Map();
  async function cacheCsrf(path, cookie) {
    const page = await request(path, { headers: cookie ? { cookie } : {} });
    const token = page.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
    if (!token) throw new Error(`CSRF token was not found on ${path}.`);
    csrfTokens.set(cookie, token);
    return token;
  }

  async function postForm(path, fields = {}, cookie = "", requestOptions = {}) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
      for (const item of Array.isArray(value) ? value : [value]) form.append(key, String(item));
    }
    const token = csrfTokens.get(cookie);
    if (token && !form.has("_csrf")) form.set("_csrf", token);
    return request(path, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: baseUrl,
        referer: `${baseUrl}${requestOptions.refererPath ?? path}`,
        ...(cookie ? { cookie } : {}),
        ...requestOptions.headers
      },
      body: form
    });
  }

  async function postMultipart(path, fields = {}, files = {}, cookie = "") {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      for (const item of Array.isArray(value) ? value : [value]) form.append(key, String(item));
    }
    const token = csrfTokens.get(cookie);
    if (token && !form.has("_csrf")) form.set("_csrf", token);
    for (const [field, file] of Object.entries(files)) {
      form.set(field, new Blob([file.buffer], { type: file.type }), file.name);
    }
    return request(path, {
      method: "POST",
      headers: { origin: baseUrl, referer: `${baseUrl}${path}`, ...(cookie ? { cookie } : {}) },
      body: form
    });
  }

  async function login(email, password) {
    const result = await postForm("/login", { email, password });
    const cookie = cookieFrom(result.response);
    if (result.response.status !== 303 || !cookie) {
      throw new Error(`Login failed for ${email}: ${result.response.status} ${result.text.slice(0, 200)}`);
    }
    return cookie;
  }

  async function waitFor(check, message = "Condition was not met", attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await check()) return;
      await sleep(50);
    }
    throw new Error(message);
  }

  return {
    root,
    port,
    baseUrl,
    dbPath,
    uploadsDir,
    smtp,
    stdout,
    stderr,
    request,
    postForm,
    postMultipart,
    login,
    cacheCsrf,
    waitFor,
    readDb() {
      if (!existsSync(dbPath)) throw new Error(`Test database does not exist: ${dbPath}`);
      return JSON.parse(readFileSync(dbPath, "utf8"));
    },
    async stop() {
      if (child?.exitCode === null) {
        child.kill();
        await Promise.race([once(child, "exit"), sleep(3000)]);
      }
      if (inProcessServer) {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          if (!existsSync(dbPath)) break;
          const currentDb = JSON.parse(readFileSync(dbPath, "utf8"));
          if (!currentDb.notifications?.some((note) => note.status === "queued")) break;
          await sleep(25);
        }
        await sleep(50);
      }
      if (inProcessServer?.listening) {
        const closed = once(inProcessServer, "close");
        inProcessServer.close();
        inProcessServer.closeAllConnections?.();
        await closed;
      }
      await smtp?.stop();
      if (previousEnv) {
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  };
}
