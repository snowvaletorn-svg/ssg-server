// Unit tests for the Torn key/info validator. axios is mocked — no network.
process.env.KEY_ENCRYPTION_KEY = process.env.KEY_ENCRYPTION_KEY || 'ab'.repeat(32);

jest.mock('axios');

const axios = require('axios');
const {
  fetchKeyInfo,
  checkKeySufficient,
  clearKeyInfoCache,
  REQUIRED_SELECTIONS
} = require('../services/tornKeyInfo');

// Shape mirrors the live v2 endpoint: { access: { level, player_id, selections } }
function v2Response(level, selections, playerId = 1234567) {
  return {
    data: {
      access: {
        level,
        player_id: playerId,
        selections
      }
    }
  };
}

beforeEach(() => {
  clearKeyInfoCache();
  jest.clearAllMocks();
});

describe('tornKeyInfo.fetchKeyInfo', () => {
  test('maps Full access level to tier 3 with owner id', async () => {
    axios.get.mockResolvedValueOnce(v2Response('Full', ['basic', 'bars'], 111));
    const res = await fetchKeyInfo('FULLKEY1234567890');
    expect(res.ok).toBe(true);
    expect(res.data.accessLevel).toBe('Full');
    expect(res.data.accessTier).toBe(3);
    expect(res.data.ownerId).toBe(111);
    expect(res.data.selections).toEqual(['basic', 'bars']);
    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, config] = axios.get.mock.calls[0];
    expect(url).toBe('https://api.torn.com/v2/key/info');
    expect(config.params.key).toBe('FULLKEY1234567890');
    expect(config.timeout).toBeGreaterThan(0);
  });

  test('caches identical keys (no repeat network call)', async () => {
    axios.get.mockResolvedValue(v2Response('Full', []));
    await fetchKeyInfo('SAMEKEY123456789');
    await fetchKeyInfo('SAMEKEY123456789');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('different keys are cached independently', async () => {
    axios.get.mockResolvedValue(v2Response('Full', []));
    await fetchKeyInfo('KEYONE12345678900');
    await fetchKeyInfo('KEYTWO12345678900');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('surfaces Torn error code and message', async () => {
    axios.get.mockResolvedValueOnce({ data: { error: { code: 2, error: 'Incorrect key' } } });
    const res = await fetchKeyInfo('badkey');
    expect(res.ok).toBe(false);
    expect(res.code).toBe(2);
    expect(res.error).toBe('Incorrect key');
  });

  test('network failures return ok:false', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNABORTED'));
    const res = await fetchKeyInfo('anykey');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ECONNABORTED');
  });

  test('never sends or stores the raw key as a cache identifier', async () => {
    axios.get.mockResolvedValueOnce(v2Response('Full', []));
    await fetchKeyInfo('SENSITIVEKEY12345');
    // The request itself must use the params object, not an interpolated URL
    expect(axios.get.mock.calls[0][0]).not.toContain('SENSITIVEKEY12345');
  });
});

describe('tornKeyInfo.checkKeySufficient', () => {
  test('Full access is sufficient', async () => {
    axios.get.mockResolvedValueOnce(v2Response('Full', ['basic', 'profile', 'bars']));
    const res = await checkKeySufficient('FULLKEY');
    expect(res.sufficient).toBe(true);
    expect(res.reason).toBeNull();
    expect(res.info.accessLevel).toBe('Full');
  });

  test('Limited access is insufficient with helpful reason', async () => {
    axios.get.mockResolvedValueOnce(v2Response('Limited', []));
    const res = await checkKeySufficient('LIMITEDKEY');
    expect(res.sufficient).toBe(false);
    expect(res.reason).toContain('Limited, not Full');
    expect(res.info.accessLevel).toBe('Limited');
  });

  test('Public access is insufficient', async () => {
    axios.get.mockResolvedValueOnce(v2Response('Public', []));
    const res = await checkKeySufficient('PUBLICKEY');
    expect(res.sufficient).toBe(false);
    expect(res.reason).toContain('Public, not Full');
  });

  test('Minimal access is insufficient', async () => {
    axios.get.mockResolvedValueOnce(v2Response('Minimal', []));
    const res = await checkKeySufficient('MINIMALKEY');
    expect(res.sufficient).toBe(false);
  });

  test('custom key covering all required selections is accepted', async () => {
    axios.get.mockResolvedValueOnce(
      v2Response('Limited', REQUIRED_SELECTIONS)
    );
    const res = await checkKeySufficient('CUSTOMKEY');
    expect(res.sufficient).toBe(true);
    expect(res.reason).toBeNull();
  });

  test('custom key missing required selections is rejected with the missing list', async () => {
    axios.get.mockResolvedValueOnce(
      v2Response('Limited', ['basic', 'profile']) // missing bars, personalstats
    );
    const res = await checkKeySufficient('PARTIALCUSTOMKEY');
    expect(res.sufficient).toBe(false);
    expect(res.reason).toContain('Missing: bars, personalstats');
  });

  test('key with unrecognized access level is rejected and names the level', async () => {
    axios.get.mockResolvedValueOnce(v2Response('WeirdLevel', []));
    const res = await checkKeySufficient('UNKNOWNKEY');
    expect(res.sufficient).toBe(false);
    expect(res.reason).toContain('Key is WeirdLevel, not Full');
  });

  test('key with literal Unknown access level gets the generic fallback message', async () => {
    axios.get.mockResolvedValueOnce(v2Response('Unknown', []));
    const res = await checkKeySufficient('UNKNOWNKEY2');
    expect(res.sufficient).toBe(false);
    expect(res.reason).toContain('Could not determine key access level');
  });

  test('Torn API failure is reported as insufficient with the error', async () => {
    axios.get.mockResolvedValueOnce({ data: { error: { code: 2, error: 'Incorrect key' } } });
    const res = await checkKeySufficient('badkey');
    expect(res.sufficient).toBe(false);
    expect(res.reason).toBe('Incorrect key');
    expect(res.info).toBeNull();
  });
});