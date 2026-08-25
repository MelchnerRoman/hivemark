import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ALGO = "aes-256-gcm";
const PREFIX = "v1";

let cachedKey: Buffer | null = null;

function loadKey(dataDir: string): Buffer {
  if (cachedKey) return cachedKey;
  const keyPath = path.join(dataDir, "secret.key");
  if (existsSync(keyPath)) {
    cachedKey = Buffer.from(readFileSync(keyPath, "utf8"), "hex");
  } else {
    cachedKey = randomBytes(32);
    writeFileSync(keyPath, cachedKey.toString("hex"), { mode: 0o600 });
  }
  return cachedKey;
}

/** Encrypts a credential for storage. Key lives in a separate 0600 file next
 * to the DB, so a stray copy of just the .db file doesn't leak secrets. */
export function encryptSecret(dataDir: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, loadKey(dataDir), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypts a stored credential. Falls back to returning the input unchanged
 * if it isn't in our encrypted format — covers rows written before this was
 * added, which the boot migration re-encrypts on next read anyway. */
export function decryptSecret(dataDir: string, stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) return stored;
  const [, ivB64, tagB64, cipherB64] = parts;
  const decipher = createDecipheriv(ALGO, loadKey(dataDir), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(cipherB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

export function isEncrypted(stored: string): boolean {
  const parts = stored.split(":");
  return parts.length === 4 && parts[0] === PREFIX;
}
