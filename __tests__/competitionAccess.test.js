// The page/tab is now open to all faction members; only battle stats remain
// gated to admins (ownership/leadership). Those gates are covered in
// competitionService.test.js — this file checks the access-level split directly.
const {
  BATTLE_STAT_KEYS,
  buildStatCatalog
} = require('../services/competitionService');

describe('competition page access (open to faction members)', () => {
  test('non-battle stats are available to non-admin faction members', () => {
    const catalog = buildStatCatalog({ isAdmin: false });
    ['attackswon', 'networth', 'useractivity'].forEach(k => {
      expect(catalog[k]).toBeDefined();
    });
  });

  test('battle stats remain excluded from non-admin catalogs', () => {
    const catalog = buildStatCatalog({ isAdmin: false });
    BATTLE_STAT_KEYS.forEach(k => expect(catalog[k]).toBeUndefined());
  });
});