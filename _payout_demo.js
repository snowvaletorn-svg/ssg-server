// Demo: run a sample roster through the war payout calculator.
// Usage: node _payout_demo.js  (edit TOTAL / options below, or pass total as arg[2])
const { computeWarPayout } = require('./services/warPayoutService');

const TOTAL = Number(process.argv[2]) || 246000000;   // distribution, e.g. node _payout_demo.js 500000
const STRUCTURE = 'straight';                        // 'straight' | 'tiered' (or pass as arg[3])
const INCLUDE_ASSISTS = false;                       // set true to count assists at full value

// Sample data from leadership (hits + received hits; R3VERSE/GameMaker01 are
// Team Growth first-war members — their pay comes from the 10-hit baseline).
const members = [
  { id: 3811076, name: 'The_Rev_Skippy',  hits: 40 },
  { id: 3808908, name: 'Snowvale',        hits: 35  },
  { id: 3810820, name: 'Gryffie',         hits: 30 },
  { id: 3787148, name: 'Oruscar',         hits: 29  },
  { id: 3943975, name: 'BowserMurphy',    hits: 13  },
  { id: 2695422, name: 'DarklordGod',     hits: 2  },
  { id: 4012438, name: 'tarun_007',       hits: 23 },
  { id: 3670842, name: 'OpusBloom',       hits: 18  },
  { id: 4090606, name: 'Zaphod420420',    hits: 10  },
  { id: 4153986, name: 'Han4U',           hits: 19  },
  { id: 4200310, name: 'Vilka',           hits: 15 },
  { id: 4333076, name: 'MBGWarrior',      hits: 20 },
  { id: 4321525, name: 'Arc_Padilla',     hits: 0  },
  { id: 4333257, name: 'Anjethewierd',    hits: 24 },
  { id: 4472618, name: 'GrimTheKnight',   hits: 6  },
  { id: 4442506, name: 'da1tap',          hits: 0  },
  { id: 4476456, name: 'Jmanley94',       hits: 6  },
  { id: 4148611, name: 'Daobalu',         hits: 0  },
  { id: 4557508, name: 'R3VERSE',         hits: 0, losses: 10, position: 'Team Growth', positionAtWarStart: 'Team Growth', daysInFaction: 10 },
  { id: 4534074, name: 'GameMaker01',     hits: 0, losses: 15, position: 'Team Growth', positionAtWarStart: 'Team Growth', daysInFaction: 4 }
].map(m => ({ assists: 0, losses: 0, position: null, positionAtWarStart: null, daysInFaction: null, ...m }));

const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const moneyExact = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const r = computeWarPayout({
  total: TOTAL,
  members,
  includeAssists: INCLUDE_ASSISTS,
  payoutStructure: process.argv[3] || STRUCTURE
});

if (r.error) {
  console.error('ERROR:', r.error);
  process.exit(1);
}

console.log(`\n💰 WAR PAYOUT [${r.payoutStructure.toUpperCase()}] — total ${money(r.total)} (assists ${r.includeAssists ? 'ON' : 'OFF'})`);
console.log(`   Faction 20%: ${money(r.factionCut)}  |  Pool 80%: ${money(r.pool)}  |  Value per hit: ${moneyExact(r.perHitValue)}  |  Basis: ${r.totalBasis}`);
if (r.payoutStructure === 'tiered') {
  console.log('   Bands: ' + r.tierBands.map(b => `${b.label} ${Math.round(b.multiplier * 100)}%`).join(' · '));
}
if (r.growthEligibleCount > 0) {
  console.log(`   🌱 Growth: ${r.growthPaidCount}/${r.growthEligibleCount} paid ${money(r.growthTotal)} (baseline ${r.growthBaselineHits} hits @ ${moneyExact(r.growthBaselineValue)} pre-growth) — bands: ` + r.growthBands.map(b => `${b.label} ${Math.round(b.multiplier * 100)}%`).join(' · '));
}
console.log('');

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('#', 3) + pad('Member', 18) + pad('Hits', 6) + pad('Recv', 6) + pad('Paid For', 10) + (r.payoutStructure === 'tiered' ? pad('Rate', 6) : '') + 'Payout');
r.rows.forEach((m, i) => {
  const growthBit = m.growthPay > 0 ? ` + ${money(m.growthPay)} 🌱` : '';
  const roleBit = m.isGrowthRole ? (m.growthReason === 'used' ? ' [🌸]' : m.growthReason === 'aged' ? ' [⏳]' : ' [🌱]') : '';
  console.log(pad(i + 1, 3) + pad(m.name + roleBit, 18) + pad(m.hits, 6) + pad(m.losses, 6) + pad(m.qualifying, 10) + (r.payoutStructure === 'tiered' ? pad(Math.round(m.multiplier * 100) + '%', 6) : '') + money(m.payout) + growthBit);
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Hit payouts:      ${money(r.hitPayoutTotal)}`);
if (r.growthEligibleCount > 0) console.log(`Growth payouts:   ${money(r.growthTotal)} (${r.growthPaidCount}/${r.growthEligibleCount} members)`);
if (r.payoutStructure === 'tiered') console.log(`Tier discount retained by faction: ${money(r.tierDiscount)}`);
console.log(`Rounding remainder (to faction): ${money(r.roundingDelta)}`);
console.log(`Faction cut:      ${money(r.factionCut)}`);
console.log(`GRAND TOTAL:      ${money(r.total)}`);
console.log(`Check: ${money(r.factionCut)} + ${money(r.distributed)} + ${money(r.tierDiscount)} + ${money(r.roundingDelta)} = ${money(r.factionCut + r.distributed + r.tierDiscount + r.roundingDelta)}`);