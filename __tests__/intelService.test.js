const axios = require('axios');

const {
  FLIGHT_TIMES,
  parseTravelStatus,
  estimateLandingWindow,
  statSplitFromPercentages,
  computeStatPercentages,
  fetchSpyUser
} = require('../services/intelService');

const axiosGet = jest.spyOn(axios, 'get');

const NOW = 1_800_000_000; // fixed "now" (unix seconds)

describe('FLIGHT_TIMES (public game data)', () => {
  test('covers all ten Torn countries with sane durations', () => {
    const expected = {
      mex: 26, cay: 35, can: 41, haw: 134, uni: 159,
      swi: 175, jap: 225, chi: 242, uae: 271, sou: 297
    };
    expect(Object.keys(FLIGHT_TIMES).sort()).toEqual(Object.keys(expected).sort());
    Object.entries(expected).forEach(([k, mins]) => {
      expect(FLIGHT_TIMES[k].minutes).toBe(mins);
      expect(FLIGHT_TIMES[k].name).toBeTruthy();
    });
  });
});
describe('parseTravelStatus', () => {
  test('outbound flight from Torn', () => {
    expect(parseTravelStatus('Traveling from Torn to China')).toEqual({
      type: 'outbound', countryKey: 'chi', countryName: 'China', destination: 'China'
    });
  });

  test('returning home leg uses origin country', () => {
    expect(parseTravelStatus('Traveling from UAE to Torn')).toEqual({
      type: 'returning', countryKey: 'uae', countryName: 'UAE', destination: 'Torn'
    });
  });

  test('simple outbound without origin', () => {
    expect(parseTravelStatus('Traveling to Mexico').countryKey).toBe('mex');
  });

  test('abroad status', () => {
    expect(parseTravelStatus('In South Africa')).toMatchObject({ type: 'abroad', countryKey: 'sou' });
    expect(parseTravelStatus('In UAE')).toMatchObject({ type: 'abroad', countryKey: 'uae' });
    expect(parseTravelStatus('In United Kingdom')).toMatchObject({ type: 'abroad', countryKey: 'uni' });
  });

  test('hospital, jail and okay statuses are ignored', () => {
    expect(parseTravelStatus('In an Emirati hospital for 2 hrs 3 mins')).toBeNull();
    expect(parseTravelStatus('In hospital for 22 mins')).toBeNull();
    expect(parseTravelStatus('In jail for 5 mins')).toBeNull();
    expect(parseTravelStatus('Okay')).toBeNull();
    expect(parseTravelStatus('')).toBeNull();
    expect(parseTravelStatus(null)).toBeNull();
  });

  test('unknown country still yields a display name', () => {
    expect(parseTravelStatus('Traveling from Brazil to Torn')).toMatchObject({
      type: 'returning', countryKey: null, countryName: 'Brazil', destination: 'Torn'
    });
  });
});
describe('estimateLandingWindow', () => {
  const china = FLIGHT_TIMES.chi.minutes * 60; // 14520s

  test('no last action: window is [now, now + base]', () => {
    const w = estimateLandingWindow({ description: 'Traveling from Torn to China', now: NOW });
    expect(w).toEqual({
      destination: 'China', country: 'China',
      earliestArrival: NOW, latestArrival: NOW + china, baseFlightMinutes: 242
    });
  });

  test('recent last action narrows the window (book-perk best case)', () => {
    const lastAction = NOW - 600;
    const w = estimateLandingWindow({ description: 'Traveling from Torn to China', lastAction, now: NOW });
    expect(w.earliestArrival).toBe(lastAction + Math.floor(0.5 * china));
    expect(w.latestArrival).toBe(NOW + china);
    expect(w.earliestArrival).toBeLessThanOrEqual(w.latestArrival);
  });

  test('old last action never puts earliest in the past', () => {
    const lastAction = NOW - 10000;
    const w = estimateLandingWindow({ description: 'Traveling from Torn to China', lastAction, now: NOW });
    expect(w.earliestArrival).toBe(NOW);
  });

  test('clock skew: lastAction in the future clamps to latest', () => {
    const w = estimateLandingWindow({ description: 'Traveling from Torn to China', lastAction: NOW + 99999, now: NOW });
    expect(w.earliestArrival).toBe(w.latestArrival);
  });

  test('returning leg uses the origin country duration (UAE = 271 min)', () => {
    const w = estimateLandingWindow({ description: 'Traveling from UAE to Torn', now: NOW });
    expect(w.destination).toBe('Torn');
    expect(w.latestArrival).toBe(NOW + FLIGHT_TIMES.uae.minutes * 60);
    expect(w.baseFlightMinutes).toBe(271);
  });

  test('abroad members get no window', () => {
    expect(estimateLandingWindow({ description: 'In Hawaii', now: NOW })).toBeNull();
  });

  test('non-travel statuses get no window', () => {
    expect(estimateLandingWindow({ description: 'Okay', now: NOW })).toBeNull();
    expect(estimateLandingWindow({ now: NOW })).toBeNull();
  });

  test('unknown destination returns the name without a timer', () => {
    const w = estimateLandingWindow({ description: 'Traveling to Brazil', now: NOW });
    expect(w.destination).toBe('Brazil');
    expect(w.latestArrival).toBeNull();
    expect(w.baseFlightMinutes).toBeNull();
  });
});
describe('statSplitFromPercentages (FFScouter premium distribution)', () => {
  test('top two are selected and ordered', () => {
    expect(statSplitFromPercentages({ strength: 35, dexterity: 30 })).toEqual({
      top1: { stat: 'Strength', pct: 35 },
      top2: { stat: 'Dexterity', pct: 30 },
      source: 'ffscouter-premium'
    });
  });

  test('handles a single stat and rejects empty input', () => {
    expect(statSplitFromPercentages({ speed: 40 }).top2).toBeNull();
    expect(statSplitFromPercentages({})).toBeNull();
    expect(statSplitFromPercentages(null)).toBeNull();
  });
});

describe('computeStatPercentages (TornStats spy record)', () => {
  test('computes percentages against the provided total', () => {
    const spy = { strength: 350, defense: 200, speed: 250, dexterity: 200, total: 1000 };
    expect(computeStatPercentages(spy)).toEqual({
      top1: { stat: 'Strength', pct: 35 },
      top2: { stat: 'Speed', pct: 25 },
      source: 'tornstats-spy',
      spyTimestamp: null
    });
  });

  test('falls back to summing stats when total is missing', () => {
    const spy = { strength: 300, dexterity: 700 };
    const split = computeStatPercentages(spy);
    expect(split.top1).toEqual({ stat: 'Dexterity', pct: 70 });
    expect(split.top2).toEqual({ stat: 'Strength', pct: 30 });
  });

  test('rejects empty/invalid spy records', () => {
    expect(computeStatPercentages(null)).toBeNull();
    expect(computeStatPercentages({})).toBeNull();
    expect(computeStatPercentages({ strength: 0, defense: 0, speed: 0, dexterity: 0, total: 0 })).toBeNull();
  });
});
describe('fetchSpyUser (TornStats API client)', () => {
  beforeEach(() => axiosGet.mockClear());

  test('resolves the spy record on success and hits the documented URL', async () => {
    axiosGet.mockResolvedValueOnce({
      data: { status: true, message: 'Spy data found.', spy: { strength: 10, defense: 20, speed: 30, dexterity: 40, total: 100 } }
    });
    const spy = await fetchSpyUser('KEY123', 111);
    expect(spy).toBeTruthy();
    expect(axiosGet.mock.calls[0][0]).toBe('https://www.tornstats.com/api/v2/KEY123/spy/user/111');
  });

  test('resolves null on a spy miss (status false)', async () => {
    axiosGet.mockResolvedValueOnce({ data: { status: false, message: 'ERROR: User not found.' } });
    await expect(fetchSpyUser('KEY123', 222)).resolves.toBeNull();
  });

  test('resolves null on HTTP/network errors', async () => {
    axiosGet.mockRejectedValueOnce(new Error('boom'));
    await expect(fetchSpyUser('KEY123', 333)).resolves.toBeNull();
  });

  test('caches successful lookups (second call makes no HTTP request)', async () => {
    axiosGet.mockResolvedValue({
      data: { status: true, spy: { strength: 10, defense: 10, speed: 10, dexterity: 10, total: 40 } }
    });
    await fetchSpyUser('KEY123', 444);
    await fetchSpyUser('KEY123', 444);
    expect(axiosGet).toHaveBeenCalledTimes(1);
  });

  test('requires both key and player id', async () => {
    await expect(fetchSpyUser(null, 555)).resolves.toBeNull();
    await expect(fetchSpyUser('KEY123', null)).resolves.toBeNull();
    expect(axiosGet).not.toHaveBeenCalled();
  });
});