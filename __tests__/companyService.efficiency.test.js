const axios = require('axios');

// Mock the mongoose models used by companyService without needing a DB.
jest.mock('../models/Company', () => {
  const save = jest.fn().mockImplementation(function () { return Promise.resolve(this); });
  const findOne = jest.fn().mockResolvedValue({
    companyId: 5500,
    companyName: 'SSG Grocery',
    companyType: '',
    companyTypeId: null,
    directorPlayerId: 99,
    directorName: 'Director',
    stars: 0,
    dailyIncome: 0,
    lastFetchedAt: null,
    save
  });
  findOne.findOne = findOne;
  const Company = function Company(doc) { Object.assign(this, doc); this.save = save; };
  Company.findOne = findOne;
  return Company;
});
jest.mock('../models/User', () => {
  return { find: jest.fn(), findOne: jest.fn() };
});
jest.mock('../models/AppNotification', () => ({ create: jest.fn(), findOne: jest.fn() }));

const {
  computeEfficiencyForPosition,
  statEffectiveness,
  buildEfficiencyMatrix,
  getPositionsForCompanyType,
  getCompanyData
} = require('../services/companyService');

const axiosGet = jest.spyOn(axios, 'get');

const sampleCompanyTypes = {
  companies: {
    '12': {
      name: 'Grocery Store',
      default_employees: 10,
      positions: {
        'Cleaner': { man_required: 2000, int_required: 0, end_required: 0, man_gain: 20, int_gain: 0, end_gain: 0, special_ability: 'Clean floors', description: '' },
        'Manager': { man_required: 0, int_required: 1500, end_required: 500, man_gain: 0, int_gain: 30, end_gain: 10, special_ability: 'None', description: '' }
      }
    }
  }
};

describe('statEffectiveness', () => {
  test('single stat meeting the requirement exactly = 45 (base cap)', () => {
    expect(statEffectiveness(4000, 4000)).toBe(45);
  });

  test('under-qualified scales linearly up to the cap', () => {
    expect(statEffectiveness(4000, 8000)).toBe(22); // floor(4000/8000*45) = floor(22.5)
    expect(statEffectiveness(1000, 4000)).toBe(11); // floor(0.25*45) = floor(11.25)
  });

  test('over-qualified earns a log2 bonus on top of the 45 cap', () => {
    expect(statEffectiveness(16000, 8000)).toBe(50); // 45 + floor(5*log2(2)) = 45+5
    expect(statEffectiveness(9101, 4000)).toBe(50);  // 45 + floor(5*log2(2.275)) = 45+5
  });

  test('zero stat or zero requirement contributes 0', () => {
    expect(statEffectiveness(0, 8000)).toBe(0);
    expect(statEffectiveness(8000, 0)).toBe(0);
  });
});

describe('computeEfficiencyForPosition', () => {
  // Role requirements from https://wiki.torn.com/wiki/Adult_Novelties#Job_Positions,
  // cross-checked against github.com/th3g3ntI3man/TheEffectivenessMechanism.
  const salesAssistant = { id: '3', name: 'Sales Assistant', intelligence: 0, manuallabor: 2000, endurance: 4000 };
  const sexpert = { id: '2', name: 'Sexpert', intelligence: 10000, manuallabor: 0, endurance: 5000 };
  const storeManager = { id: '1', name: 'Store Manager', intelligence: 4000, manuallabor: 0, endurance: 8000 };

  test('cross-check with the repo formula: Player1 (MAN 1234 / INT 5678 / END 9101)', () => {
    const emp = { intelligence: 5678, manualLabor: 1234, endurance: 9101 };
    // Sales Assistant (primary END 4000, secondary MAN 2000):
    //   primary 45 + floor(5*log2(9101/4000)) = 50; secondary floor(1234/2000*45) = 27.
    expect(computeEfficiencyForPosition(emp, salesAssistant)).toBe(77);
    // Sexpert (primary INT 10000, secondary END 5000):
    //   primary floor(5678/10000*45) = 25; secondary 45 + floor(5*log2(9101/5000)) = 49.
    expect(computeEfficiencyForPosition(emp, sexpert)).toBe(74);
    // Store Manager (primary END 8000, secondary INT 4000):
    //   primary 45 + floor(5*log2(9101/8000)) = 45; secondary 45 + floor(5*log2(5678/4000)) = 47.
    expect(computeEfficiencyForPosition(emp, storeManager)).toBe(92);
  });

  test('cross-check with the repo formula: Player2 (MAN 2345 / INT 6789 / END 1011)', () => {
    const emp = { intelligence: 6789, manualLabor: 2345, endurance: 1011 };
    expect(computeEfficiencyForPosition(emp, salesAssistant)).toBe(57); // 11 + 46
    expect(computeEfficiencyForPosition(emp, sexpert)).toBe(39);        // 30 + 9
    expect(computeEfficiencyForPosition(emp, storeManager)).toBe(53);   // 5 + 48
  });

  test('meeting every requirement exactly = 90 (45 + 45)', () => {
    expect(computeEfficiencyForPosition(
      { intelligence: 10000, manualLabor: 0, endurance: 5000 },
      sexpert
    )).toBe(90);
  });

  test('only the two required stats matter', () => {
    // Sexpert ignores MAN; a huge MAN adds no points.
    expect(computeEfficiencyForPosition(
      { intelligence: 10000, manualLabor: 999999, endurance: 5000 },
      sexpert
    )).toBe(90);
  });

  test('zero of the primary stat only forfeits that stat share', () => {
    // Sexpert with INT 0 but perfect secondary: 0 + 45 = 45.
    expect(computeEfficiencyForPosition(
      { intelligence: 0, manualLabor: 0, endurance: 5000 },
      sexpert
    )).toBe(45);
  });

  test('positions with no stat requirements default to 90', () => {
    expect(computeEfficiencyForPosition(
      { intelligence: 0, manualLabor: 0, endurance: 0 },
      { intelligence: 0, manuallabor: 0, endurance: 0 }
    )).toBe(90);
  });
});

describe('buildEfficiencyMatrix', () => {
  // Employees and positions from the repo's worked example (Adult Novelties).
  const employees = [
    { playerId: 1, name: 'Player1', intelligence: 5678, manualLabor: 1234, endurance: 9101, position: 'Store Manager' },
    { playerId: 2, name: 'Player2', intelligence: 6789, manualLabor: 2345, endurance: 1011, position: 'Sexpert' },
    { playerId: 3, name: 'Player3', intelligence: 7890, manualLabor: 3456, endurance: 1213, position: '' }
  ];
  const positions = [
    { id: '1', name: 'Store Manager', intelligence: 4000, manuallabor: 0, endurance: 8000 },
    { id: '2', name: 'Sexpert', intelligence: 10000, manuallabor: 0, endurance: 5000 },
    { id: '3', name: 'Sales Assistant', intelligence: 0, manuallabor: 2000, endurance: 4000 }
  ];

  test('computes effectiveness for every employee per position and picks the best', () => {
    const matrix = buildEfficiencyMatrix(employees, positions);
    expect(matrix).toHaveLength(3);

    // Store Manager (END 8000 primary, INT 4000 secondary):
    //   Player1 = 45+47 = 92, Player2 = 5+48 = 53, Player3 = 6+49 = 55.
    expect(matrix[0].employees).toEqual([
      { playerId: 1, pct: 92 }, { playerId: 2, pct: 53 }, { playerId: 3, pct: 55 }
    ]);
    expect(matrix[0].bestPlayerId).toBe(1);
    expect(matrix[0].bestEfficiency).toBe(92);

    // Sexpert (INT 10000 primary, END 5000 secondary):
    //   Player1 = 25+49 = 74, Player2 = 30+9 = 39, Player3 = 35+10 = 45.
    expect(matrix[1].employees).toEqual([
      { playerId: 1, pct: 74 }, { playerId: 2, pct: 39 }, { playerId: 3, pct: 45 }
    ]);
    expect(matrix[1].bestPlayerId).toBe(1);
    expect(matrix[1].bestEfficiency).toBe(74);

    // Sales Assistant (END 4000 primary, MAN 2000 secondary):
    //   Player1 = 50+27 = 77, Player2 = 11+46 = 57, Player3 = 13+48 = 61.
    expect(matrix[2].employees).toEqual([
      { playerId: 1, pct: 77 }, { playerId: 2, pct: 57 }, { playerId: 3, pct: 61 }
    ]);
    expect(matrix[2].bestPlayerId).toBe(1);
    expect(matrix[2].bestEfficiency).toBe(77);
  });

  test('skips employees without any work stats', () => {
    const matrix = buildEfficiencyMatrix(
      [{ playerId: 9, name: 'NoStats', intelligence: 0, manualLabor: 0, endurance: 0 }],
      positions
    );
    expect(matrix[0].employees).toHaveLength(0);
    expect(matrix[0].bestPlayerId).toBeNull();
    expect(matrix[0].bestEfficiency).toBe(0);
  });
});
describe('getPositionsForCompanyType', () => {
  beforeEach(() => axiosGet.mockReset());

  test('parses and normalizes position requirements, and caches the payload', async () => {
    axiosGet.mockResolvedValueOnce({ data: sampleCompanyTypes });

    const first = await getPositionsForCompanyType(12, 'key-abc');
    expect(first).toEqual([
      { id: 'Cleaner', name: 'Cleaner', specialAbility: 'Clean floors', intelligence: 0, manuallabor: 2000, endurance: 0, primaryStat: 'MAN', secondaryStat: null },
      { id: 'Manager', name: 'Manager', specialAbility: '', intelligence: 1500, manuallabor: 0, endurance: 500, primaryStat: 'INT', secondaryStat: 'END' }
    ]);
    // Second call with the same key is served from cache (no extra HTTP call).
    await getPositionsForCompanyType(12, 'key-abc');
    expect(axiosGet).toHaveBeenCalledTimes(1);
    // Regression: must use the `companies` selection — `companytypes` is not a
    // valid v1 selection and the API rejects it with "Wrong fields".
    expect(axiosGet.mock.calls[0][0]).toContain('selections=companies');
    expect(axiosGet.mock.calls[0][0]).not.toContain('companytypes');
  });

  test('maps Adult Novelties primary/secondary stats per the wiki + repo', async () => {
    // Requirements from https://wiki.torn.com/wiki/Adult_Novelties#Job_Positions,
    // cross-checked with github.com/th3g3ntI3man/TheEffectivenessMechanism:
    //   Store Manager: END 8000 primary, INT 4000 secondary.
    //   Sexpert: INT 10000 primary, END 5000 secondary.
    //   Sales Assistant: END 4000 primary, MAN 2000 secondary.
    const adultNovelties = {
      companies: {
        // Adult Novelties is company type id 10 (verified live via the API).
        '10': {
          name: 'Adult Novelties',
          default_employees: 10,
          positions: {
            'Store Manager': { man_required: 0, int_required: 4000, end_required: 8000, special_ability: 'None', description: '' },
            'Sexpert': { man_required: 0, int_required: 10000, end_required: 5000, special_ability: 'None', description: '' },
            'Sales Assistant': { man_required: 2000, int_required: 0, end_required: 4000, special_ability: 'None', description: '' }
          }
        }
      }
    };
    axiosGet.mockResolvedValueOnce({ data: adultNovelties });

    const positions = await getPositionsForCompanyType(10, 'key-an');
    const byName = {};
    positions.forEach(p => { byName[p.name] = p; });

    expect(byName['Store Manager'].primaryStat).toBe('END');
    expect(byName['Store Manager'].secondaryStat).toBe('INT');
    expect(byName['Sexpert'].primaryStat).toBe('INT');
    expect(byName['Sexpert'].secondaryStat).toBe('END');
    expect(byName['Sales Assistant'].primaryStat).toBe('END');
    expect(byName['Sales Assistant'].secondaryStat).toBe('MAN');
  });

  test('returns [] when the API call fails', async () => {
    axiosGet.mockRejectedValueOnce(new Error('boom'));
    const result = await getPositionsForCompanyType(12, 'bad-key');
    expect(result).toEqual([]);
  });
});

describe('getCompanyData', () => {
  beforeEach(() => {
    axiosGet.mockReset();
    const User = require('../models/User');
    const AppNotification = require('../models/AppNotification');
    User.findOne.mockReset();
    User.find.mockReset();
    AppNotification.findOne.mockReset();
    AppNotification.create.mockReset();
    // detectDepartedEmployees() calls User.find a second time; make it persistent.
    User.findOne.mockResolvedValue({ tornApiKey: 'director-key', tornName: 'Director' });
    User.find.mockResolvedValue([]); // no employees have stored API keys
    AppNotification.findOne.mockResolvedValue(null);
    AppNotification.create.mockResolvedValue({});
  });

  test('returns company, employees with efficiency, and the positions matrix', async () => {
    // First HTTP call = company data (employees keyed by player id).
    axiosGet.mockImplementationOnce(() => Promise.resolve({
      data: {
        company: { name: 'SSG Grocery', company_type: 12, rating: 4, daily_income: 100000,
          employees: {
            '101': { name: 'Alice', position: 'Cleaner' },
            '102': { name: 'Bob', position: 'Manager' }
          } }
      }
    }));
    // Second HTTP call = companies (company types).
    axiosGet.mockImplementationOnce(() => Promise.resolve({ data: sampleCompanyTypes }));

    const result = await getCompanyData(5500, 1);

    expect(result.company.typeId).toBe(12);
    expect(result.company.type).toBe('Grocery Store');
    expect(result.employees).toHaveLength(2);
    expect(result.positions).toHaveLength(2);

    // No work stats loaded (no stored employee keys) -> every employee has
    // a byPosition list, and the position metadata is present/normalized.
    for (const emp of result.employees) {
      expect(Array.isArray(emp.efficiency.byPosition)).toBe(true);
    }
    expect(result.positions[0].name).toBe('Cleaner');
    expect(result.positions[0].manuallabor).toBe(2000);
    expect(result.positions[0].primaryStat).toBe('MAN');
    expect(result.positions[1].name).toBe('Manager');
    expect(result.positions[1].intelligence).toBe(1500);
  });
test('computes per-position efficiency using employees work stats', async () => {
    const User = require('../models/User');
    User.findOne.mockReset();
    User.find.mockReset();
    User.findOne.mockResolvedValueOnce({ tornApiKey: 'director-key', tornName: 'Director' });
    // Employee 101 has a stored key (so work stats get fetched); 102 has none.
    // Use a persistent mock: detectDepartedEmployees() calls User.find() again.
    User.find.mockResolvedValue([
      { tornPlayerId: 101, tornApiKey: 'emp-key-101', tornName: 'Alice' }
    ]);

    // HTTP call 1 = company data.
    axiosGet.mockImplementationOnce(() => Promise.resolve({
      data: {
        company: { name: 'SSG Grocery', company_type: 12, rating: 4, daily_income: 100000,
          employees: {
            '101': { name: 'Alice', position: 'Cleaner' },
            '102': { name: 'Bob', position: 'Manager' }
          } }
      }
    }));
    // HTTP call 2 = employee 101 work stats.
    axiosGet.mockImplementationOnce(() => Promise.resolve({
      data: { personalstats: { manuallabor: 2000, intelligence: 1000, endurance: 0 } }
    }));
    // HTTP call 3 = companies (company types).
    axiosGet.mockImplementationOnce(() => Promise.resolve({ data: sampleCompanyTypes }));

    const result = await getCompanyData(5500, 1);

    const alice = result.employees.find(e => e.playerId === 101);
    const bob = result.employees.find(e => e.playerId === 102);

    // Alice has stats: Cleaner (needs MAN 2000, met exactly) -> 45⚡;
    // Manager (INT 1500 primary, END 500 secondary): floor(1000/1500*45)=30 + 0 -> 30⚡.
    const aliceByPos = {};
    alice.efficiency.byPosition.forEach(p => { aliceByPos[p.name] = p.pct; });
    expect(aliceByPos['Cleaner']).toBe(45);
    expect(aliceByPos['Manager']).toBe(30);

    // Bob has no stored key -> all stats 0 -> 0⚡ everywhere, but structure intact.
    expect(bob.intelligence).toBe(0);
    expect(Array.isArray(bob.efficiency.byPosition)).toBe(true);

    // Matrix agrees: Cleaner's best employee is Alice at 45⚡.
    const cleaner = result.positions.find(p => p.name === 'Cleaner');
    expect(cleaner.bestPlayerId).toBe(101);
    expect(cleaner.bestEfficiency).toBe(45);
  });
});