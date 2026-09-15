// Focused unit tests for key-grace logic.
// No MongoDB or real network required.
// Uses fake timers so keyGraceActive() reflects the deadline boundary.

process.env.KEY_ENCRYPTION_KEY = "ff".repeat(32);
process.env.NODE_ENV = "test";

// Must enable fake timers BEFORE any setSystemTime calls.
jest.useFakeTimers();

const { encrypt, decryptOrRaw } = require("../services/keyCipher");

const KEY_GRACE_DEADLINE = new Date("2026-09-28T00:00:00Z");

function keyGraceActive() { return Date.now() < KEY_GRACE_DEADLINE.getTime(); }

function keyHealthForUser(dbUser, check) {
  const none = {
    needsUpdate: false,
    accessLevel: null,
    graceActive: false,
    invalid: false,
    detail: null,
    graceDeadline: null,
  };
  if (!dbUser?.tornApiKey) return {
    needsUpdate: false,
    accessLevel: null,
    graceActive: keyGraceActive(),
    invalid: false,
    detail: null,
    graceDeadline: keyGraceActive() ? KEY_GRACE_DEADLINE.toISOString() : null,
  };
  if (!check) return none;
  const graceActive = keyGraceActive();
  const invalid = check.info === null && !check.sufficient;
  const belowFull = check.info !== null && !check.sufficient;
  const shouldWarn = (belowFull || invalid) && graceActive;
  return {
    needsUpdate: shouldWarn,
    accessLevel: check.info?.accessLevel || null,
    graceActive,
    invalid,
    detail: check.reason || (invalid ? "Key is no longer valid with Torn." : null),
    graceDeadline: graceActive ? KEY_GRACE_DEADLINE.toISOString() : null,
  };
}

describe("keyHealthForUser logic", () => {
  const mkUser = (apiKey) => ({ tornApiKey: apiKey });

  beforeEach(() => {
    jest.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    process.env.KEY_ENCRYPTION_KEY = "ff".repeat(32);
  });

  afterEach(() => {
    jest.setSystemTime(new Date("2026-06-01T00:00:00Z"));
  });

  afterAll(() => {
    jest.useRealTimers();
    delete process.env.NODE_ENV;
  });

  test("no key => needsUpdate false, grace active during grace window", () => {
    const result = keyHealthForUser(mkUser(null), null);
    expect(result.needsUpdate).toBe(false);
    expect(result.invalid).toBe(false);
    expect(result.accessLevel).toBeNull();
    expect(result.detail).toBeNull();
    expect(result.graceDeadline).toBe(KEY_GRACE_DEADLINE.toISOString());
    expect(result.graceActive).toBe(true);
  });

  test("below-full key during grace => needsUpdate true", () => {
    const check = {
      sufficient: false,
      reason: "Insufficient permissions",
      info: { accessLevel: "Limited", access: { level: 2, type: "Limited" } },
    };
    const dbUser = mkUser(encrypt("limited-key-" + Date.now()));
    const result = keyHealthForUser(dbUser, check);
    expect(result.needsUpdate).toBe(true);
    expect(result.invalid).toBe(false);
    expect(result.accessLevel).toBe("Limited");
    expect(result.detail).toContain("Insufficient permissions");
    expect(result.graceDeadline).toBe(KEY_GRACE_DEADLINE.toISOString());
    expect(result.graceActive).toBe(true);
  });

  test("below-full key after deadline => needsUpdate false, graceDeadline null", () => {
    jest.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    const check = {
      sufficient: false,
      reason: "Insufficient permissions",
      info: { accessLevel: "Limited", access: { level: 2, type: "Limited" } },
    };
    const dbUser = mkUser(encrypt("limited-key-late-" + Date.now()));
    const result = keyHealthForUser(dbUser, check);
    expect(result.needsUpdate).toBe(false);
    expect(result.invalid).toBe(false);
    expect(result.accessLevel).toBe("Limited");
    expect(result.graceDeadline).toBeNull();
    expect(result.graceActive).toBe(false);
  });

  test("invalid/dead key during grace => needsUpdate true", () => {
    const check = { sufficient: false, reason: "Incorrect key", info: null };
    const dbUser = mkUser(encrypt("dead-key-" + Date.now()));
    const result = keyHealthForUser(dbUser, check);
    expect(result.needsUpdate).toBe(true);
    expect(result.invalid).toBe(true);
    expect(result.accessLevel).toBeNull();
    expect(result.detail).toBe("Incorrect key");
    expect(result.graceDeadline).toBe(KEY_GRACE_DEADLINE.toISOString());
    expect(result.graceActive).toBe(true);
  });

  test("valid Full key during grace => needsUpdate false", () => {
    const check = {
      sufficient: true,
      reason: null,
      info: { accessLevel: "Full", access: { level: 4, type: "Full Access" } },
    };
    const dbUser = mkUser(encrypt("full-key-" + Date.now()));
    const result = keyHealthForUser(dbUser, check);
    expect(result.needsUpdate).toBe(false);
    expect(result.invalid).toBe(false);
    expect(result.accessLevel).toBe("Full");
    expect(result.graceDeadline).toBe(KEY_GRACE_DEADLINE.toISOString());
    expect(result.graceActive).toBe(true);
  });

  test("graceActive reflects deadline boundary", () => {
    expect(keyGraceActive()).toBe(true);
    jest.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    expect(keyGraceActive()).toBe(false);
    jest.setSystemTime(new Date("2026-06-01T00:00:00Z"));
  });

  test("graceDeadline null when grace inactive", () => {
    jest.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    const check = {
      sufficient: false,
      reason: "Insufficient permissions",
      info: { accessLevel: "Limited", access: { level: 2, type: "Limited" } },
    };
    const result = keyHealthForUser(mkUser(encrypt("x-" + Date.now())), check);
    expect(result.graceDeadline).toBeNull();
    expect(result.graceActive).toBe(false);
  });
});

