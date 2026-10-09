// Unit tests for the competition lottery roll scope logic.
// Pure logic — no MongoDB, no network.
const {
  ROLL_SCOPES,
  roleGroupForPosition,
  selectRollCandidates
} = require('../services/competitionService');

describe('ROLL_SCOPES', () => {
  test('exposes exactly the four UI scopes', () => {
    expect(ROLL_SCOPES).toEqual(['all', 'growth', 'strength', 'strategy']);
  });
});

describe('roleGroupForPosition', () => {
  test('maps Team Strategy (both variants) to strategy', () => {
    expect(roleGroupForPosition('Team Strategy')).toBe('strategy');
    expect(roleGroupForPosition('Team_Strategy')).toBe('strategy');
  });

  test('maps Team Strength and Murder Child to strength', () => {
    expect(roleGroupForPosition('Team Strength')).toBe('strength');
    expect(roleGroupForPosition('Murder Child')).toBe('strength');
  });

  test('maps Team Growth and Recruit to growth', () => {
    expect(roleGroupForPosition('Team Growth')).toBe('growth');
    expect(roleGroupForPosition('Recruit')).toBe('growth');
  });

  test('non-rollable roles return null (still roll under all)', () => {
    ['Leader', 'Co-leader', 'Matriarch', 'Leadership', 'Warlord', 'Member', ''].forEach(p => {
      expect(roleGroupForPosition(p)).toBeNull();
    });
  });

  test('null/undefined positions return null', () => {
    expect(roleGroupForPosition(null)).toBeNull();
    expect(roleGroupForPosition(undefined)).toBeNull();
  });
});

describe('selectRollCandidates', () => {
  const members = [
    { playerId: 1, playerName: 'Alice', position: 'Leader' },
    { playerId: 2, playerName: 'Bob', position: 'Team_Strategy' },
    { playerId: 3, playerName: 'Carol', position: 'Murder Child' },
    { playerId: 4, playerName: 'Dave', position: 'Team Growth' },
    { playerId: 5, playerName: 'Eve', position: 'Recruit' },
    { playerId: 6, playerName: 'Frank', position: 'Warlord' },
    { playerId: 7, playerName: 'Grace', position: 'Team Strength' },
    { playerId: 8, playerName: 'Heidi', position: 'Team Strategy' }
  ];

  test('all scope returns every member including ownership and warlord', () => {
    const picked = selectRollCandidates(members, 'all');
    expect(picked).toHaveLength(members.length);
    expect(picked.map(m => m.playerId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('growth scope returns Team Growth and Recruit only', () => {
    const picked = selectRollCandidates(members, 'growth');
    expect(picked.map(m => m.playerName)).toEqual(['Dave', 'Eve']);
  });

  test('strength scope returns Team Strength and Murder Child only', () => {
    const picked = selectRollCandidates(members, 'strength');
    expect(picked.map(m => m.playerName)).toEqual(['Carol', 'Grace']);
  });

  test('strategy scope returns both strategy variants only', () => {
    const picked = selectRollCandidates(members, 'strategy');
    expect(picked.map(m => m.playerName)).toEqual(['Bob', 'Heidi']);
  });

  test('warlord and ownership are excluded from every role scope', () => {
    ['growth', 'strength', 'strategy'].forEach(scope => {
      const ids = selectRollCandidates(members, scope).map(m => m.playerId);
      expect(ids).not.toContain(1); // Leader
      expect(ids).not.toContain(6); // Warlord
    });
  });

  test('unknown scope returns an empty array', () => {
    expect(selectRollCandidates(members, 'warlord')).toEqual([]);
    expect(selectRollCandidates(members, '')).toEqual([]);
    expect(selectRollCandidates(members, undefined)).toEqual([]);
  });

  test('non-array input returns an empty array', () => {
    expect(selectRollCandidates(null, 'all')).toEqual([]);
    expect(selectRollCandidates(undefined, 'all')).toEqual([]);
  });
});