import { Buffer } from 'node:buffer';

const IV_BYTES = 12;
const KEY_BYTES = 32;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;

export function assertValidEncryptionKeyFormat(base64Key: string): Uint8Array {
  if (!BASE64_RE.test(base64Key)) {
    throw new Error('OAUTH_ENCRYPTION_KEY must be valid base64');
  }
  const raw = Buffer.from(base64Key, 'base64');
  if (raw.length !== KEY_BYTES) {
    throw new Error(
      `OAUTH_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (a 256-bit AES-GCM key), got ${raw.length}`
    );
  }
  return raw;
}

export async function importEncryptionKey(base64Key: string): Promise<CryptoKey> {
  const raw = assertValidEncryptionKeyFormat(base64Key);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return Buffer.from(combined).toString('base64url');
}

export async function decryptSecret(key: CryptoKey, encoded: string): Promise<string> {
  const combined = Buffer.from(encoded, 'base64url');
  const iv = combined.subarray(0, IV_BYTES);
  const ciphertext = combined.subarray(IV_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
