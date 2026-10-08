// Unit tests for snapshotService: widened personalstats pull, concurrency cap,
// and daily snapshot upsert. Models and axios are mocked — no MongoDB/network.
process.env.KEY_ENCRYPTION_KEY = process.env.KEY_ENCRYPTION_KEY || 'ab'.repeat(32);

jest.mock('axios');
jest.mock('../models/User', () => ({ find: jest.fn() }));
jest.mock('../models/WeeklySnapshot', () => {
  const Model = jest.fn();
  Model.find = jest.fn();
  Model.findOne = jest.fn();
  return Model;
});
jest.mock('../models/DailySnapshot', () => {
  const Model = jest.fn();
  Model.findOne = jest.fn();
  Model.findOneAndUpdate = jest.fn();
  return Model;
});
jest.mock('../models/FactionConfig', () => ({ findOne: jest.fn() }));
jest.mock('../models/AppNotification', () => ({}));
jest.mock('../services/emailService', () => ({ sendEmail: jest.fn() }));

const axios = require('axios');
const User = require('../models/User');
const DailySnapshot = require('../models/DailySnapshot');
const {
  fetchAllMemberStats,
  mapWithConcurrency,
  takeDailySnapshot,
  getLatestCompetitionSnapshot
} = require('../services/snapshotService');

function tornResponse(overrides = {}) {
  return {
    data: {
      player_id: 111,
      name: 'Alice',
      personalstats: { attackswon: 10, networth: 500, totalstats: 999 },
      ...overrides
    }
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('mapWithConcurrency', () => {
  test('respects the concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 25 }, (_, i) => i);

    const results = await mapWithConcurrency(items, 5, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });

    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(results).toHaveLength(25);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    expect(results.map(r => r.value)).toEqual(items.map(n => n * 2));
  });

  test('captures rejections without failing the batch', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('fulfilled');
  });

  test('handles empty input', async () => {
    const results = await mapWithConcurrency([], 10, async () => 1);
    expect(results).toEqual([]);
  });
});

describe('fetchAllMemberStats', () => {
  test('returns full personalstats alongside totalStats', async () => {
    User.find.mockResolvedValue([
      { tornPlayerId: 111, tornName: 'alice', tornApiKey: 'enc' }
    ]);
    axios.get.mockResolvedValue(tornResponse());

    const { validStats, totalUsers } = await fetchAllMemberStats();

    expect(totalUsers).toBe(1);
    expect(validStats).toHaveLength(1);
    expect(validStats[0].playerId).toBe(111);
    expect(validStats[0].totalStats).toBe(999);
    expect(validStats[0].personalstats).toEqual({ attackswon: 10, networth: 500, totalstats: 999 });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get.mock.calls[0][0]).toContain('selections=basic,personalstats');
  });

  test('skips members whose API returns an error', async () => {
    User.find.mockResolvedValue([
      { tornPlayerId: 1, tornName: 'a', tornApiKey: 'enc' },
      { tornPlayerId: 2, tornName: 'b', tornApiKey: 'enc' }
    ]);
    axios.get
      .mockResolvedValueOnce(tornResponse())
      .mockResolvedValueOnce({ data: { error: { code: 1, error: 'Incorrect key' } } });

    const { validStats } = await fetchAllMemberStats();
    expect(validStats).toHaveLength(1);
    expect(validStats[0].playerId).toBe(111);
  });
});

describe('takeDailySnapshot', () => {
  test('upserts idempotently once per calendar day', async () => {
    User.find.mockResolvedValue([
      { tornPlayerId: 111, tornName: 'alice', tornApiKey: 'enc' }
    ]);
    axios.get.mockResolvedValue(tornResponse());
    DailySnapshot.findOneAndUpdate.mockResolvedValue({});

    const result = await takeDailySnapshot('tester');

    expect(result.success).toBe(true);
    expect(result.membersSnapshotted).toBe(1);
    expect(DailySnapshot.findOneAndUpdate).toHaveBeenCalledTimes(1);

    const [filter, update, options] = DailySnapshot.findOneAndUpdate.mock.calls[0];
    const today = new Date().toISOString().split('T')[0];
    expect(filter).toEqual({ snapshotId: `daily_${today}` });
    expect(update.snapshotId).toBe(`daily_${today}`);
    expect(update.memberStats[0].personalstats.attackswon).toBe(10);
    expect(options).toMatchObject({ upsert: true });
  });

  test('fails gracefully when no stats are returned', async () => {
    User.find.mockResolvedValue([]);
    const result = await takeDailySnapshot('tester');
    expect(result.success).toBe(false);
    expect(DailySnapshot.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('getLatestCompetitionSnapshot', () => {
  test('prefers the daily snapshot', async () => {
    DailySnapshot.findOne.mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => ({ snapshotId: 'daily_2026-01-01' }) }) })
    });
    const result = await getLatestCompetitionSnapshot();
    expect(result.source).toBe('daily');
    expect(result.snapshot.snapshotId).toBe('daily_2026-01-01');
  });

  test('returns null when nothing exists', async () => {
    DailySnapshot.findOne.mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => null }) })
    });
    const WeeklySnapshot = require('../models/WeeklySnapshot');
    WeeklySnapshot.findOne.mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => null }) })
    });
    const result = await getLatestCompetitionSnapshot();
    expect(result).toBeNull();
  });
});
