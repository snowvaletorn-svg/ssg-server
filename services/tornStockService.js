// Torn_stock service - Fetch stock prices from the Torn API
const axios = require('axios');
const { decryptOrRaw } = require('./keyCipher');
const FactionConfig = require('../models/FactionConfig');

// Simple in-memory cache for stock prices with TTL
let cachedStockPrices = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get the faction Torn API key
 */
async function getTornApiKey() {
  try {
    const config = await FactionConfig.findOne({ key: 'config' });
    if (config?.tornFactionApiKey) return decryptOrRaw(config.tornFactionApiKey);
  } catch (err) {
    console.error('Error fetching faction config:', err.message);
  }
  return process.env.TORN_FACTION_API_KEY?.trim() || null;
}

/**
 * Fetch current stock prices from the Torn API
 * Uses a simple in-memory cache with 1-hour TTL
 * Returns: { 'stockId': { id, name, current_price }, ... }
 */
async function fetchStockPrices() {
  const now = Date.now();

  // Return cached data if fresh
  if (cachedStockPrices && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedStockPrices;
  }

  const apiKey = await getTornApiKey();
  if (!apiKey) {
    console.warn('[TornStock] No Torn API key configured — cannot fetch stock prices.');
    return null;
  }

  try {
    const encodedKey = encodeURIComponent(apiKey);
    const res = await axios.get(
      `https://api.torn.com/torn/?selections=stocks&key=${encodedKey}`,
      { timeout: 15000 }
    );

    if (res.data.error) {
      console.error('[TornStock] Torn API error:', res.data.error.error);
      return null;
    }

    // res.data.stocks is an object keyed by stock ID
    // { '123': { id: 123, name: 'Butter', current_price: 150 }, ... }
    const stocksData = res.data.stocks || {};
    cachedStockPrices = stocksData;
    cacheTimestamp = now;

    return stocksData;
  } catch (err) {
    console.error('[TornStock] Failed to fetch stock prices:', err.message);
    return null;
  }
}

/**
 * Clear the cache (useful for testing or when API key changes)
 */
function clearStockPriceCache() {
  cachedStockPrices = null;
  cacheTimestamp = 0;
}

/**
 * Normalize a stock name for matching
 * Removes non-alphanumeric characters and converts to lowercase
 * Also returns the acronym if available
 */
function normalizeName(name, acronym) {
  const normalized = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  const acronymNormalized = (acronym || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  return { normalized, acronymNormalized };
}

/**
 * Check if two normalized names match (exact or substring)
 */
function namesMatch(obsName, stockName, stockAcronym) {
  const { normalized: obsNorm, acronymNormalized: obsAcronym } = normalizeName(obsName, null);
  const { normalized: stockNorm, acronymNormalized: stockAcronymNorm } = normalizeName(stockName, stockAcronym);

  if (!obsNorm || !stockNorm) return false;

  // Exact match
  if (obsNorm === stockNorm) return true;

  // Acronym match (e.g., "SYS" matches "Syscore MFG")
  if (obsAcronym && stockNorm.includes(obsAcronym) && obsAcronym.length >= 2) return true;
  if (stockAcronymNorm && stockNorm.includes(stockAcronymNorm) && stockAcronymNorm.length >= 2) return true;

  // Partial match (obs name is substring of stock name or vice versa)
  if (stockNorm.includes(obsNorm) || obsNorm.includes(stockNorm)) {
    return stockNorm.length >= 3 && obsNorm.length >= 3;
  }

  return false;
}

/**
 * Build a normalized lookup map of stock names to prices
 * Uses multiple matching strategies to match observation items
 */
function buildStockPriceMap(stocksData) {
  const map = {};
  if (!stocksData) return map;

  for (const stockId in stocksData) {
    const stock = stocksData[stockId];
    const { normalized: stockNorm, acronymNormalized: stockAcronymNorm } = normalizeName(stock.name, stock.acronym);
    const price = stock.current_price || 0;

    if (!stockNorm || !price) continue;

    // Store with multiple keys for flexible matching
    // 1. Full normalized name
    if (stockNorm) map[`full:${stockNorm}`] = price;
    // 2. Acronym
    if (stockAcronymNorm && stockAcronymNorm.length >= 2) map[`acro:${stockAcronymNorm}`] = price;
    // 3. Store original name for substring matching
    map[`substr:${stockId}`] = { price, stockNorm, stockAcronymNorm };
  }

  return map;
}

/**
 * Look up a sell price for an observation item
 * Checks multiple matching strategies
 */
function lookupSellPrice(obsName, priceMap) {
  const { normalized: obsNorm, acronymNormalized: obsAcronym } = normalizeName(obsName, null);
  if (!obsNorm) return null;

  // Strategy 1: Exact match with full normalized name
  const exactKey = `full:${obsNorm}`;
  if (priceMap[exactKey] !== undefined) {
    return priceMap[exactKey];
  }

  // Strategy 2: Check acronym
  if (obsAcronym && obsAcronym.length >= 2) {
    const acroKey = `acro:${obsAcronym}`;
    if (priceMap[acroKey] !== undefined) {
      return priceMap[acroKey];
    }
  }

  // Strategy 3: Substring matching
  // Check if any Torn API stock name contains the observation name (or vice versa)
  for (const key in priceMap) {
    if (key.startsWith('substr:')) {
      const entry = priceMap[key];
      if (typeof entry === 'object' && entry.price && entry.stockNorm) {
        // Check if observation name is substring of stock name or vice versa
        if (entry.stockNorm.includes(obsNorm) || obsNorm.includes(entry.stockNorm)) {
          if (entry.stockNorm.length >= 3 && obsNorm.length >= 3) {
            return entry.price;
          }
        }
      }
    }
  }

  return null;
}

module.exports = {
  fetchStockPrices,
  buildStockPriceMap,
  clearStockPriceCache,
  lookupSellPrice
};


