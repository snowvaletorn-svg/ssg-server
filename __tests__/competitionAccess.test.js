const {
  BATTLE_STAT_KEYS,
  isBattleStat,
  humaniseKey,
  categoriseStatKey,
  buildStatCatalog,
  filterRequestedStats,
  memberValuesFor
} = require('../services/competitionService');

// Rollout gate — must mirror COMPETITION_ACCESS_IDS / isCompetitionUser in server.js.
const COMPETITION_ACCESS_IDS = [3808908];
function hasCompetitionAccess(sessionUserId) {
  return COMPETITION_ACCESS_IDS.includes(parseInt(sessionUserId, 10));
}

describe('competition page access (Snowvale only)', () => {
  test('Snowvale (Torn ID 3808908) has access', () => {
    expect(hasCompetitionAccess(3808908)).toBe(true);
    expect(hasCompetitionAccess('3808908')).toBe(true);
  });

  test('every other id is denied', () => {
    [1234567, '2345678', 3808909, null, undefined, ''].forEach(id => {
      expect(hasCompetitionAccess(id)).toBe(false);
    });
  });
});