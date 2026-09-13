// Unit tests for the key cipher service. No MongoDB or network required.
process.env.KEY_ENCRYPTION_KEY = 'ab'.repeat(32); // 64 hex chars

const crypto = require('crypto');
const { encrypt, decrypt, isEncrypted, loadEncryptionKey } = require('../services/keyCipher');

describe('keyCipher', () => {
  afterAll(() => {
    delete process.env.KEY_ENCRYPTION_KEY;
  });

  test('loadEncryptionKey accepts valid 64-char hex', () => {
    expect(loadEncryptionKey()).toEqual(Buffer.from('ab'.repeat(32), 'hex'));
  });

  test('encrypt/decrypt round-trips arbitrary text', () => {
    const samples = [
      'K7d9xQ2mNp4vBn8s',
      'key-with-dashes-and-more-chars-1234',
      'pünctuation ✓ and unicode 中文',
      'a'.repeat(1000)
    ];
    for (const s of samples) {
      expect(decrypt(encrypt(s))).toBe(s);
    }
  });

  test('ciphertexts are unique per call (random IV)', () => {
    const a = encrypt('same-value');
    const b = encrypt('same-value');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  test('output has the v1.iv.tag.ciphertext shape', () => {
    const composite = encrypt('hello');
    const parts = composite.split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/); // base64url IV
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/); // base64url GCM tag
    expect(parts[3]).toMatch(/^[A-Za-z0-9_-]+$/); // base64url ciphertext
  });

  test('ciphertext contains no trace of plaintext', () => {
    const secret = 'MYSECRETKEY16chars';
    const composite = encrypt(secret);
    expect(composite.includes(secret)).toBe(false);
    expect(composite.includes(Buffer.from(secret).toString('base64'))).toBe(false);
  });

  test('isEncrypted detects encrypted vs plaintext values', () => {
    expect(isEncrypted(encrypt('abc'))).toBe(true);
    expect(isEncrypted('PlainTornKey12345')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted('v1.not-really-cipher')).toBe(true); // prefix match is the contract
  });

  test('legacy plaintext passes through decrypt unchanged', () => {
    expect(decrypt('PlainTornKey12345')).toBe('PlainTornKey12345');
  });

  test('null/empty handling', () => {
    expect(encrypt(null)).toBeNull();
    expect(decrypt(null)).toBeNull();
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
  });

  test('tampered ciphertext throws (GCM auth tag)', () => {
    const composite = encrypt('sensitive');
    const parts = composite.split('.');
    const data = Buffer.from(parts[3], 'base64url');
    data[0] ^= 0xff;
    const tampered = [parts[0], parts[1], parts[2], Buffer.from(data).toString('base64url')].join('.');
    expect(() => decrypt(tampered)).toThrow(/Decryption failed/);
  });

  test('truncated composite throws malformed error', () => {
    expect(() => decrypt('v1.only.two')).toThrow(/Malformed ciphertext/);
  });

  test('wrong key fails decryption with actionable error', () => {
    const composite = encrypt('secret');
    // Re-require module with a different in-memory key: simulate by monkey
    // patching env and clearing cache via a fresh module instance.
    jest.resetModules();
    process.env.KEY_ENCRYPTION_KEY = 'cd'.repeat(32);
    const fresh = require('../services/keyCipher');
    expect(() => fresh.decrypt(composite)).toThrow(/wrong KEY_ENCRYPTION_KEY/);
    jest.resetModules();
    process.env.KEY_ENCRYPTION_KEY = 'ab'.repeat(32); // restore for remaining tests
  });

  test('missing KEY_ENCRYPTION_KEY fails fast', () => {
    jest.resetModules();
    const saved = process.env.KEY_ENCRYPTION_KEY;
    delete process.env.KEY_ENCRYPTION_KEY;
    const fresh = require('../services/keyCipher');
    expect(() => fresh.encrypt('x')).toThrow(/KEY_ENCRYPTION_KEY is not set/);
    expect(() => fresh.decrypt('v1.a.b.c')).toThrow(/KEY_ENCRYPTION_KEY is not set/);
    if (saved) process.env.KEY_ENCRYPTION_KEY = saved;
    jest.resetModules();
    process.env.KEY_ENCRYPTION_KEY = 'ab'.repeat(32);
  });

  test('invalid KEY_ENCRYPTION_KEY format fails fast', () => {
    jest.resetModules();
    const saved = process.env.KEY_ENCRYPTION_KEY;
    process.env.KEY_ENCRYPTION_KEY = 'not-hex';
    const fresh = require('../services/keyCipher');
    expect(() => fresh.encrypt('x')).toThrow(/must be 64 hex characters/);
    if (saved) process.env.KEY_ENCRYPTION_KEY = saved;
    else delete process.env.KEY_ENCRYPTION_KEY;
    jest.resetModules();
    process.env.KEY_ENCRYPTION_KEY = 'ab'.repeat(32);
  });

  test('real random key round-trip (integration sanity)', () => {
    jest.resetModules();
    process.env.KEY_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    const fresh = require('../services/keyCipher');
    const value = 'Kt0rnKEy-random-' + Date.now();
    expect(fresh.decrypt(fresh.encrypt(value))).toBe(value);
    jest.resetModules();
    process.env.KEY_ENCRYPTION_KEY = 'ab'.repeat(32);
  });
});