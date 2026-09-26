import * as crypto from 'crypto';

/**
 * Symmetric encryption for secrets-at-rest (AI provider API keys).
 * Uses AES-256-GCM with a key derived from JWT_SECRET so no extra env var
 * is required for this assessment; in a real production deployment this
 * would use a dedicated KMS-managed key instead (documented in AI_USAGE.md).
 */
const ALGORITHM = 'aes-256-gcm';

function getKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plainText: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const key = getKey(secret);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptSecret(payload: string, secret: string): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const key = getKey(secret);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
