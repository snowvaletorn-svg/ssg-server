const axios = require('axios');
const StockObservation = require('../models/StockObservation');

/**
 * Stock Data Source Service
 *
 * Provides a unified interface for stock data that:
 * 1. Tries YATA travel export API (primary)
 * 2. Falls back to Prometheus API
 * 3. Falls back to latest userscript observations from MongoDB
 */

// YATA's item ID → item data mapping from the travel export endpoint
// We also use the Torn item catalog for name ↔ ID cross-referencing

const CACHE_TTL = {
  YATA: 30 * 1000,        // 30 seconds
  PROMETHEUS: 30 * 1000,  // 30 seconds
  ITEM_CATALOG: 3600 * 1000, // 1 hour (item catalog rarely changes)
};

const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.value;
  cache.delete(key);
  return null;
}

function setCached(key, value, ttl) {
  cache.set(key, { value, expiry: Date.now() + ttl });
}

/**
 * Fetch stock data from YATA travel export API.
 */
async function fetchFromYATA() {
  const cached = getCached('yata-stock');
  if (cached) return cached;

  const res = await axios.get('https://yata.yt/api/v1/travel/export/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    timeout: 15000,
    maxRedirects: 5,
  });

  setCached('yata-stock', res.data, CACHE_TTL.YATA);
  return res.data;
}

/**
 * Fetch stock data from Prometheus API.
 */
async function fetchFromPrometheus() {
  const cached = getCached('prometheus-stock');
  if (cached) return cached;

  const res = await axios.get('https://api.prombot.co.uk/api/travel', {
    headers: {
      'User-Agent': 'SSG-Dashboard/1.0',
      'Accept': 'application/json',
    },
    timeout: 15000,
  });

  setCached('prometheus-stock', res.data, CACHE_TTL.PROMETHEUS);
  return res.data;
}

/**
 * Fetch latest stock observations from MongoDB (userscript submissions).
 */
async function fetchFromMongo(country) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const observations = await StockObservation.find({
    country: country.toLowerCase(),
    receivedAt: { $gte: sevenDaysAgo }
  })
    .sort({ receivedAt: -1 })
    .limit(50)
    .lean();

  return observations;
}

// Country name mapping (YATA uses full names)
const COUNTRY_NAME_TO_CODE = {
  'mexico': 'mex',
  'cayman islands': 'cay',
  'canada': 'can',
  'hawaii': 'haw',
  'united kingdom': 'uni',
  'uk': 'uni',
  'argentina': 'arg',
  'switzerland': 'swi',
  'japan': 'jap',
  'china': 'chi',
  'united arab emirates': 'uae',
  'uae': 'uae',
  'south africa': 'sou',
};

const COUNTRY_CODE_TO_NAME = {
  'mex': 'Mexico',
  'cay': 'Cayman Islands',
  'can': 'Canada',
  'haw': 'Hawaii',
  'uni': 'United Kingdom',
  'arg': 'Argentina',
  'swi': 'Switzerland',
  'jap': 'Japan',
  'chi': 'China',
  'uae': 'UAE',
  'sou': 'South Africa',
};

/**
 * Normalize YATA response into a unified stock data format.
 * YATA format: { stocks: { countryCode: { name: "...", stocks: [...] } } }
 * Prometheus format: { ...countryCode: { items: [...] } }
 */
function normalizeYATA(data) {
  const stocks = data?.stocks || {};
  const result = {};

  for (const [key, countryData] of Object.entries(stocks)) {
    // YATA uses country codes OR full names as keys
    const code = COUNTRY_NAME_TO_CODE[key.toLowerCase()] || key.toLowerCase().slice(0, 3);
    const normalizedCode = Object.keys(COUNTRY_CODE_TO_NAME).find(
      c => c === code || c === key.toLowerCase().slice(0, 3)
    ) || code;

    const items = (countryData?.stocks || []).map(item => ({
      id: String(item.id || ''),
      name: item.name || '',
      quantity: typeof item.quantity === 'number' ? item.quantity : 0,
      cost: typeof item.cost === 'number' ? item.cost : 0,
      type: item.type || (item.name ? categorizeItem(item.name) : 'Other'),
    }));

    result[normalizedCode] = {
      countryCode: normalizedCode,
      countryName: COUNTRY_CODE_TO_NAME[normalizedCode] || countryData.name || key,
      stocks: items,
    };
  }

  return result;
}

/**
 * Normalize Prometheus response into unified format.
 */
function normalizePrometheus(data) {
  const result = {};

  for (const [key, countryData] of Object.entries(data || {})) {
    // Prometheus uses country codes
    const code = key.toLowerCase();
    const items = (countryData?.items || countryData?.stocks || []).map(item => ({
      id: String(item.id || ''),
      name: (item.name || '').trim(),
      quantity: typeof item.stock === 'number' ? item.stock : (typeof item.quantity === 'number' ? item.quantity : 0),
      cost: typeof item.cost === 'number' ? item.cost : (typeof item.buy_price === 'number' ? item.buy_price : 0),
      type: item.type || (item.name ? categorizeItem(item.name) : 'Other'),
    }));

    result[code] = {
      countryCode: code,
      countryName: COUNTRY_CODE_TO_NAME[code] || countryData.name || code,
      stocks: items,
    };
  }

  return result;
}

/**
 * Simple item type categorization based on name patterns.
 */
function categorizeItem(name) {
  const n = name.toLowerCase();
  const plushies = ['teddy bear', 'buzzlightyear', 'woody', 'bunny', 'chompy', 'cuttlefish',
    'elephant', 'froggie', 'green frog', 'lion', 'penguin', 'red fox', 'sheep', 'teddy',
    'tiger', 'wabbit', 'wolf', 'bald eagle', 'beaver', 'maple leaf', 'polar bear',
    'kiwi', 'koala', 'platypus', 'stingray', 'box turtle', 'red panda', 'snow leopard',
    'chimera', 'diamond hand', 'duck', 'flamingo', 'grizzly bear', 'orca', 'panda',
    'phoenix', 'pink teddy', 'raccoon', 'seal', 'sugar glider', 'unicorn', 'yak'];

  const flowers = ['rose', 'lily', 'orchid', 'tulip', 'daisy', 'sunflower', 'lavender',
    'cherry blossom', 'chrysanthemum', 'daffodil', 'hibiscus', 'jasmine', 'lotus',
    'magnolia', 'marigold', 'poinsettia', 'violet', 'wisteria', 'bluebell', 'carnation',
    'edelweiss', 'foxglove', 'ginseng', 'hemp', 'henbane', 'mandrake', 'nightshade',
    'pansy', 'peony', 'saffron'];

  const drugs = ['vicodin', 'xanax', 'opium', 'cannabis', 'lsd', 'mushroom', 'shroom',
    'ketamine', 'cocaine', 'speed', 'ecstasy', 'mdma', 'amphetamine',
    'adderall', 'morphine', 'heroin', 'valium', 'diazepam', 'codeine'];

  if (plushies.some(p => n.includes(p))) return 'Plushie';
  if (flowers.some(f => n.includes(f))) return 'Flower';
  if (drugs.some(d => n.includes(d))) return 'Drug';
  return 'Other';
}

/**
 * Get the best available stock data for a specific country.
 * Returns: { stocks: [], source: 'yata'|'prometheus'|'userscript', fetchedAt: Date }
 */
async function getCurrentStock(countryCode) {
  const code = countryCode.toLowerCase();

  // Try YATA first
  try {
    const yataData = await fetchFromYATA();
    const normalized = normalizeYATA(yataData);
    if (normalized[code]?.stocks?.length > 0) {
      return {
        stocks: normalized[code].stocks,
        source: 'yata',
        fetchedAt: new Date(),
      };
    }
  } catch (err) {
    // YATA failed, try Prometheus
  }

  // Try Prometheus
  try {
    const promData = await fetchFromPrometheus();
    const normalized = normalizePrometheus(promData);
    if (normalized[code]?.stocks?.length > 0) {
      return {
        stocks: normalized[code].stocks,
        source: 'prometheus',
        fetchedAt: new Date(),
      };
    }
  } catch (err) {
    // Prometheus also failed
  }

  // Fallback to latest userscript observation
  try {
    const observations = await fetchFromMongo(code);
    if (observations.length > 0) {
      // Get the most recent observation for this country
      const latest = observations[0];
      const stocks = (latest.stocks || []).map(s => ({
        id: s.id || '',
        name: s.name || '',
        quantity: typeof s.quantity === 'number' ? s.quantity : 0,
        cost: typeof s.cost === 'number' ? s.cost : 0,
        type: s.name ? categorizeItem(s.name) : 'Other',
      }));

      return {
        stocks,
        source: 'userscript',
        fetchedAt: latest.receivedAt || new Date(),
      };
    }
  } catch (err) {
    // No data at all
  }

  return {
    stocks: [],
    source: 'none',
    fetchedAt: new Date(),
  };
}

/**
 * Get stock data for all countries.
 */
async function getAllCurrentStocks() {
  // Try YATA first
  try {
    const yataData = await fetchFromYATA();
    return {
      countries: normalizeYATA(yataData),
      source: 'yata',
      fetchedAt: new Date(),
    };
  } catch (err) {
    // Try Prometheus
    try {
      const promData = await fetchFromPrometheus();
      return {
        countries: normalizePrometheus(promData),
        source: 'prometheus',
        fetchedAt: new Date(),
      };
    } catch (err2) {
      // Both failed
    }
  }

  return {
    countries: {},
    source: 'none',
    fetchedAt: new Date(),
  };
}

/**
 * Get the deterministic restock countdown.
 * Torn restocks all foreign stock at :00 and :30 every hour.
 */
function getRestockCountdown() {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  // Minutes until next restock (:00 or :30)
  let minutesUntil;
  if (minutes < 30) {
    minutesUntil = 30 - minutes;
  } else {
    minutesUntil = 60 - minutes;
  }

  // Adjust for seconds
  const totalSeconds = minutesUntil * 60 - seconds;

  return {
    nextRestockInMinutes: Math.ceil(totalSeconds / 60),
    nextRestockInSeconds: totalSeconds,
    nextRestockAt: new Date(Date.now() + totalSeconds * 1000).toISOString(),
    cycleMinute: minutes < 30 ? 0 : 30,
  };
}

module.exports = {
  getCurrentStock,
  getAllCurrentStocks,
  getRestockCountdown,
  fetchFromYATA,
  fetchFromPrometheus,
  normalizeYATA,
  normalizePrometheus,
};