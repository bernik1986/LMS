import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const keyDir = resolve(".deploy-keys");
const privatePath = resolve(keyDir, "marine_lms_codex_rsa");
const publicPath = `${privatePath}.pub`;

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function base64UrlToBuffer(value) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function mpint(value) {
  let buffer = value;
  while (buffer.length > 1 && buffer[0] === 0) buffer = buffer.subarray(1);
  if (buffer[0] & 0x80) buffer = Buffer.concat([Buffer.from([0]), buffer]);
  return Buffer.concat([uint32(buffer.length), buffer]);
}

function sshString(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([uint32(buffer.length), buffer]);
}

mkdirSync(keyDir, { recursive: true });

if (!existsSync(privatePath) || !existsSync(publicPath)) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicExponent: 0x10001
  });
  const privatePem = privateKey.export({ type: "pkcs1", format: "pem" });
  const jwk = publicKey.export({ format: "jwk" });
  const body = Buffer.concat([
    sshString("ssh-rsa"),
    mpint(base64UrlToBuffer(jwk.e)),
    mpint(base64UrlToBuffer(jwk.n))
  ]);
  const publicOpenSsh = `ssh-rsa ${body.toString("base64")} codex-marine-lms-deploy`;
  writeFileSync(privatePath, privatePem, { mode: 0o600 });
  writeFileSync(publicPath, publicOpenSsh);
}

console.log(publicPath);
