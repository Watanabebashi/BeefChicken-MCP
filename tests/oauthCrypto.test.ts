import { describe, it, expect } from 'vitest';
import { importEncryptionKey, encryptSecret, decryptSecret } from '../src/oauthCrypto';

function randomKeyB64(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
}

describe('oauthCrypto', () => {
  it('round-trips a secret through encrypt/decrypt', async () => {
    const key = await importEncryptionKey(randomKeyB64());
    const ciphertext = await encryptSecret(key, 'sk_live_super_secret');
    expect(ciphertext).not.toContain('sk_live_super_secret');
    await expect(decryptSecret(key, ciphertext)).resolves.toBe('sk_live_super_secret');
  });

  it('produces different ciphertext for the same plaintext on each call (random IV)', async () => {
    const key = await importEncryptionKey(randomKeyB64());
    const a = await encryptSecret(key, 'same-value');
    const b = await encryptSecret(key, 'same-value');
    expect(a).not.toBe(b);
  });

  it('fails to decrypt with the wrong key', async () => {
    const key1 = await importEncryptionKey(randomKeyB64());
    const key2 = await importEncryptionKey(randomKeyB64());
    const ciphertext = await encryptSecret(key1, 'secret');
    await expect(decryptSecret(key2, ciphertext)).rejects.toThrow();
  });

  it('rejects a key that is not 32 bytes when decoded', async () => {
    const shortKey = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
    await expect(importEncryptionKey(shortKey)).rejects.toThrow(/32 bytes/);
  });

  it('rejects invalid base64', async () => {
    await expect(importEncryptionKey('not-valid-base64!!!')).rejects.toThrow();
  });
});
