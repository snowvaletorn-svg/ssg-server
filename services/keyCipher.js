// ─── Key cipher service (AES-256-GCM) ────────────────────────────────────────
// Encrypts sensitive strings (Torn API keys, FFScouter/TornStats keys) at rest.
//
// Format: composite string "v1.<iv>.<tag>.<ciphertext>" (all base64url). The
// "v1." prefix lets us detect encrypted vs. legacy plaintext rows so migration
// stays idempotent, and supports future re-encryption with a new version.
//
// The encryption key comes from KEY_ENCRYPTION_KEY (32-byte hex = 64 chars).
// Losing this key makes stored ciphertext unrecoverable — acceptable failure
// mode for API keys (members just re-enter them), but back it up anyway.

const crypto = require('crypto');

const KEY_VERSION = 'v1';

let encryptionKey = null;

function loadEncryptionKey() {
  if (encryptionKey) return encryptionKey;

  const raw = (process.env.KEY_ENCRYPTION_KEY || '').trim();

  if (!raw) {
    throw new Error(
      'KEY_ENCRYPTION_KEY is not set. Generate one with: ' +
      'node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))" ' +
      'and add it to .env. Without it, API keys cannot be encrypted or decrypted.'
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'KEY_ENCRYPTION_KEY must be 64 hex characters (32 bytes). ' +
      'Generate one with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
    );
  }

  encryptionKey = Buffer.from(raw, 'hex');
  return encryptionKey;
}

function encrypt(plaintext) {
  const key = loadEncryptionKey();
  if (plaintext == null) return null;

  const plain = String(plaintext);
  if (plain === '') return plain;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    KEY_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url')
  ].join('.');
}

function decrypt(composite) {
  const key = loadEncryptionKey();
  if (composite == null) return null;

  const str = String(composite);

  // Legacy plaintext rows pass through untouched (migration script handles them)
  if (!str.startsWith(KEY_VERSION + '.')) return str;

  const parts = str.split('.');
  if (parts.length !== 4) {
    throw new Error('Malformed ciphertext (expected v1.iv.tag.ciphertext).');
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

  try {
    const plain = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final()
    ]).toString('utf8');
    return plain;
  } catch (err) {
    throw new Error(
      'Decryption failed (wrong KEY_ENCRYPTION_KEY or corrupted data). ' +
      'Members can recover by re-entering their API key.'
    );
  }
}

// True when the stored value is encrypted with the current version prefix
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(KEY_VERSION + '.');
}

// Decrypt a stored key, passing legacy plaintext through unchanged (and
// trimming). Convenience for API-call sites that receive mixed-era values.
function decryptOrRaw(stored) {
  if (stored == null) return null;
  const plain = isEncrypted(stored) ? decrypt(stored) : stored;
  return String(plain).trim() || null;
}

module.exports = { encrypt, decrypt, isEncrypted, loadEncryptionKey, decryptOrRaw };