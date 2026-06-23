const StockObservation = require('../models/StockObservation');
const stockDataSource = require('./stockDataSourceService');

/**
 * Stock Analysis Service (Hybrid)
 * 
 * Uses YATA/Prometheus for real-time stock quantities + deterministic restock timing,
 * and userscript observations for burn rate (depletion) calculations.
 */

// Items that are commonly sought for profit (plushies, flowers, drugs)
const HIGH_VALUE_TYPES = ['Plushie', 'Flower', 'Drug'];

// Restock confidence thresholds
const CONFIDENCE = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INSUFFICIENT: 'insufficient_data'
};

// Torn Flight Times Lookup (Base times in minutes - airstrip)
const FLIGHT_TIMES = {
  mex: 18,  // Mexico
  cay: 25,  // Cayman Islands
  can: 29,  // Canada
  haw: 94,  // Hawaii
  uni: 167, // United Kingdom
  arg: 177, // Argentina
  swi: 184, // Switzerland
  jap: 211, // Japan
  chi: 242, // China
  uae: 268, // UAE
  sou: 298  // South Africa
};

/**
 * Detect restock events from a time-series of stock observations for a single item.
 * Used for burn rate calculation (identifying segments between restocks).
 */
function detectRestocks(snapshots) {
  if (!snapshots || snapshots.length < 2) return { restocks: [], intervals: [] };

  const sorted = [...snapshots].sort((a, b) => a.time - b.time);
  const restocks = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const qtyDiff = curr.quantity - prev.quantity;
    const timeDiff = curr.time - prev.time; // ms

    if (qtyDiff > 0 && (prev.quantity === 0 || qtyDiff > prev.quantity * 0.1)) {
      restocks.push({
        detectedAt: curr.time,
        previousQty: prev.quantity,
        newQty: curr.quantity,
        increase: qtyDiff,
        timeSinceLastObservation: timeDiff
      });
    }
  }

  return { restocks, intervals: [] }; // Intervals aren't needed - restocks are deterministic
}

/**
 * Calculate burn rate using multiple methods for better accuracy.
 * Keeps the existing algorithms - this is purely userscript-derived data.
 */
function calculateBurnRate(snapshots) {
  if (!snapshots || snapshots.length < 2) return null;

  const sorted = [...snapshots].sort((a, b) => a.time - b.time);

  // Method 1: Recent trend (last 30 mins)
  const now = Date.now();
  const thirtyMinAgo = now - 30 * 60 * 1000;
  const recentSnapshots = sorted.filter(s => s.time >= thirtyMinAgo);
  const recentWindow = recentSnapshots.length >= 2 ? recentSnapshots : sorted.slice(-3);

  let recentBurnRate = 0;
  if (recentWindow.length >= 2) {
    const first = recentWindow[0];
    const last = recentWindow[recentWindow.length - 1];
    const timeDiffMin = (last.time - first.time) / (60 * 1000);
    const qtyDiff = first.quantity - last.quantity;
    if (timeDiffMin > 0 && qtyDiff > 0) {
      recentBurnRate = qtyDiff / timeDiffMin;
    }
  }

  // Method 2: Overall trend (all historical data)
  const { restocks } = detectRestocks(sorted);
  const restockTimes = new Set(restocks.map(r => r.detectedAt));

  const segments = [];
  let segmentStart = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (restockTimes.has(sorted[i].time)) {
      if (segmentStart.time < sorted[i].time) {
        const timeDiffMin = (sorted[i].time - segmentStart.time) / (60 * 1000);
        const qtyDiff = segmentStart.quantity - sorted[i - 1].quantity;
        if (timeDiffMin > 0 && qtyDiff > 0) {
          segments.push({ burnRate: qtyDiff / timeDiffMin, duration: timeDiffMin, qtySold: qtyDiff });
        }
      }
      segmentStart = sorted[i];
    } else if (i === sorted.length - 1) {
      const timeDiffMin = (sorted[i].time - segmentStart.time) / (60 * 1000);
      const qtyDiff = segmentStart.quantity - sorted[i].quantity;
      if (timeDiffMin > 0 && qtyDiff > 0) {
        segments.push({ burnRate: qtyDiff / timeDiffMin, duration: timeDiffMin, qtySold: qtyDiff });
      }
    }
  }

  let overallBurnRate = 0;
  if (segments.length > 0) {
    const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
    overallBurnRate = segments.reduce((sum, s) => sum + (s.burnRate * (s.duration / totalDuration)), 0);
  }

  return {
    recent: Math.round(recentBurnRate * 100) / 100,
    overall: Math.round(overallBurnRate * 100) / 100,
    segments,
    observationsUsed: sorted.length,
    timeSpanMinutes: Math.round((sorted[sorted.length - 1].time - sorted[0].time) / (60 * 1000))
  };
}

/**
 * Predict when an item will stock out.
 */
function predictStockout(currentQty, burnRate) {
  if (!burnRate || burnRate <= 0 || !currentQty || currentQty <= 0) return null;
  const minutes = currentQty / burnRate;
  return Math.round(minutes);
}

/**
 * Get the deterministic restock timing.
 * Torn restocks ALL foreign stock at :00 and :30 every hour.
 */
function getDeterministicRestockInfo(now = Date.now()) {
  const date = new Date(now);
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();

  // Current cycle start (previous restock)
  let currentCycleStart;
  if (minutes < 30) {
    currentCycleStart = new Date(date);
    currentCycleStart.setMinutes(0, 0, 0);
  } else {
    currentCycleStart = new Date(date);
    currentCycleStart.setMinutes(30, 0, 0);
  }

  // Next restock
  let nextRestock;
  if (minutes < 30) {
    nextRestock = new Date(date);
    nextRestock.setMinutes(30, 0, 0);
  } else {
    nextRestock = new Date(date);
    nextRestock.setMinutes(0, 0, 0);
    nextRestock.setHours(nextRestock.getHours() + 1);
  }

  const totalSeconds = (nextRestock.getTime() - now) / 1000;

  return {
    cycleStart: currentCycleStart.toISOString(),
    cycleStartMs: currentCycleStart.getTime(),
    nextRestock: nextRestock.toISOString(),
    nextRestockMs: nextRestock.getTime(),
    nextRestockInMinutes: Math.ceil(totalSeconds / 60),
    nextRestockInSeconds: Math.round(totalSeconds),
    minutesSinceLastRestock: Math.round((now - currentCycleStart.getTime()) / 60000),
  };
}

/**
 * Calculate the optimal arrival window for an item.
 * Uses deterministic restock timing + burn rate.
 */
function calculateOptimalArrival(currentQty, burnRate, restockInfo, flightTimeMinutes) {
  if (currentQty <= 0) {
    // Item is out of stock - wait for next restock
    const restockIn = restockInfo.nextRestockInMinutes;
    if (restockIn <= flightTimeMinutes) {
      return {
        departureRecommendation: { action: 'Depart now', reason: `Restocks in ~${restockIn} min (before you land)` }
      };
    }
    return {
      departureRecommendation: {
        action: `Wait ${Math.max(0, restockIn - flightTimeMinutes)} min`,
        reason: `Item is out of stock. Next restock in ~${restockIn} min.`
      }
    };
  }

  if (!burnRate || burnRate <= 0) {
    return {
      available: true,
      departureRecommendation: { action: 'Depart now', reason: 'Stock exists but depletion rate is unknown' }
    };
  }

  const stockoutMin = predictStockout(currentQty, burnRate);
  if (!stockoutMin) {
    return { available: true, departureRecommendation: { action: 'Depart now', reason: 'Sufficient stock' } };
  }

  const restockIn = restockInfo.nextRestockInMinutes;
  const windowAfterRestock = burnRate > 0 ? Math.round(currentQty / burnRate) : 999;

  return {
    currentStockWillLast: stockoutMin,
    nextRestockIn: restockIn,
    windowAfterRestock,
    optimalArrivalWindows: [
      { start: stockoutMin, end: restockIn + windowAfterRestock, label: 'After restock' }
    ],
    departureRecommendation: stockoutMin > flightTimeMinutes
      ? { action: 'Depart now', reason: `Stock will last ~${stockoutMin} min; you arrive in ${flightTimeMinutes} min` }
      : {
          action: `Wait or arrive after restock`,
          reason: `Current stock sells out in ~${stockoutMin} min; next restock in ~${restockIn} min`
        }
  };
}

/**
 * Full analysis for a single country using the hybrid approach:
 * - Stock data from YATA/Prometheus (live)
 * - Burn rates from userscript observations
 * - Restock timing from deterministic schedule
 */
async function analyzeCountry(country) {
  const countryCode = country.toLowerCase();
  const flightTime = FLIGHT_TIMES[countryCode] || 120;

  // Get current stock data from YATA/Prometheus/userscript
  const stockResult = await stockDataSource.getCurrentStock(countryCode);
  const currentStocks = stockResult.stocks || [];
  const dataSource = stockResult.source;

  // Get deterministic restock timing
  const restockInfo = getDeterministicRestockInfo();

  // Get userscript observations for burn rate calculations (7-day window)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const observations = await StockObservation.find({
    country: countryCode,
    receivedAt: { $gte: sevenDaysAgo }
  })
    .sort({ receivedAt: -1 })
    .lean();

  if (currentStocks.length === 0 && (!observations || observations.length === 0)) {
    return { country: countryCode, status: 'no_data', items: [] };
  }

  // Build item data from YATA/Prometheus stocks
  const itemData = {};

  // First, index by item ID from YATA/Prometheus
  currentStocks.forEach(item => {
    const stableId = item.id || item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_');
    if (!itemData[stableId]) {
      itemData[stableId] = {
        id: stableId,
        name: item.name,
        type: item.type || 'Other',
        currentQty: item.quantity,
        currentCost: item.cost,
        yataId: item.id,
        snapshots: [],
      };
    } else {
      // Update with latest YATA data
      itemData[stableId].currentQty = item.quantity;
      itemData[stableId].currentCost = item.cost;
      itemData[stableId].type = item.type || itemData[stableId].type;
    }
  });

  // Now enrich with userscript observations for burn rate data
  (observations || []).forEach(obs => {
    let rawTime = 0;
    if (obs.receivedAt instanceof Date) {
      rawTime = obs.receivedAt.getTime();
    } else if (typeof obs.receivedAt === 'number') {
      rawTime = obs.receivedAt < 9999999999 ? obs.receivedAt * 1000 : obs.receivedAt;
    } else if (obs.receivedAt) {
      rawTime = new Date(obs.receivedAt).getTime();
    }
    if (!rawTime || isNaN(rawTime)) rawTime = Date.now();

    (obs.stocks || []).forEach(s => {
      if (!s || typeof s.name === 'undefined') return;

      const itemName = (s.name || '').trim();
      // Filter out false positives
      if (!isValidItemName(itemName)) return;

      // Try to match with YATA item by name
      const stableId = findMatchingItemId(itemData, s.name);

      if (!itemData[stableId]) {
        // New item not in YATA data (unlikely but possible)
        const newId = s.id && s.id !== '0' && s.id !== 0
          ? String(s.id)
          : itemName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_');
        
        if (!itemData[newId]) {
          itemData[newId] = {
            id: newId,
            name: s.name,
            type: stockDataSource.categorizeItem ? stockDataSource.categorizeItem(s.name) : 'Other',
            currentQty: typeof s.quantity === 'number' ? s.quantity : 0,
            currentCost: typeof s.cost === 'number' ? s.cost : 0,
            snapshots: [],
          };
        }
      }

      // Add snapshot for burn rate calculation
      const targetId = stableId || (itemName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_'));
      if (itemData[targetId]) {
        itemData[targetId].snapshots.push({
          quantity: typeof s.quantity === 'number' ? s.quantity : 0,
          cost: typeof s.cost === 'number' ? s.cost : 0,
          time: rawTime,
        });
      }
    });
  });

  const items = [];

  Object.values(itemData).forEach(item => {
    if (!item.name) return;

    const sortedAsc = [...item.snapshots].sort((a, b) => a.time - b.time);
    const sortedDesc = [...item.snapshots].sort((a, b) => b.time - a.time);

    const burnData = calculateBurnRate(sortedAsc);
    const effectiveBurnRate = burnData ? (burnData.overall || burnData.recent) : 0;

    const stockout = predictStockout(item.currentQty, effectiveBurnRate);

    // Calculate arrival recommendation
    let optimalArrival = calculateOptimalArrival(
      item.currentQty,
      effectiveBurnRate,
      restockInfo,
      flightTime
    );

    // Handle out-of-stock items
    if (item.currentQty <= 0) {
      const restockIn = restockInfo.nextRestockInMinutes;
      const departInMin = Math.max(0, restockIn - flightTime);
      const departUTC = new Date(Date.now() + departInMin * 60 * 1000);
      const arriveUTC = new Date(Date.now() + (departInMin + flightTime) * 60 * 1000);

      optimalArrival.departureRecommendation = {
        action: departInMin <= 0 ? 'Depart now' : `Depart at ${departUTC.toISOString().slice(11, 16)} UTC`,
        reason: restockIn <= flightTime
          ? `Restocks in ~${restockIn} min (before you land)`
          : `Restocks in ~${restockIn} min; arrive in ${flightTime} min`,
        departAt: departUTC.toISOString(),
        arriveAt: arriveUTC.toISOString()
      };
    }

    // Data freshness
    const lastSeen = sortedDesc.length > 0 ? sortedDesc[0].time : Date.now();
    const minutesSinceLastUpdate = (Date.now() - lastSeen) / (60 * 1000);

    // Confidence reflects overall stock data reliability:
    // - YATA/Prometheus gives authoritative real-time stock counts → HIGH
    // - Userscript-only with good observation history → MEDIUM
    // - Userscript-only with minimal data → LOW
    const hasYataData = dataSource === 'yata' || dataSource === 'prometheus';
    const hasRecentBurnRate = burnData && burnData.timeSpanMinutes >= 60 && burnData.observationsUsed >= 5;

    let confidence = CONFIDENCE.LOW;
    if (hasYataData) confidence = CONFIDENCE.HIGH;
    else if (hasRecentBurnRate) confidence = CONFIDENCE.MEDIUM;

    items.push({
      id: item.id,
      name: item.name,
      type: item.type,
      currentQty: item.currentQty,
      currentCost: item.currentCost,
      dataSource,
      burnRate: {
        perMin: effectiveBurnRate,
        perHour: Math.round(effectiveBurnRate * 60 * 100) / 100,
        recentPerMin: burnData ? burnData.recent : 0,
        overallPerMin: burnData ? burnData.overall : 0,
        observationsUsed: burnData ? burnData.observationsUsed : 0,
        timeSpanMinutes: burnData ? burnData.timeSpanMinutes : 0,
      },
      stockout: {
        willStockOut: stockout !== null,
        stockoutInMinutes: stockout,
        predictedAt: stockout ? new Date(Date.now() + stockout * 60 * 1000).toISOString() : null,
      },
      restock: {
        nextInMinutes: restockInfo.nextRestockInMinutes,
        nextRestockAt: restockInfo.nextRestock,
        minutesSinceLastRestock: restockInfo.minutesSinceLastRestock,
        cycleStart: restockInfo.cycleStart,
      },
      optimalArrival,
      confidence,
    });
  });

  // Sort: items that will stock out soon first, then by profit potential
  items.sort((a, b) => {
    // Out of stock items go last
    if (a.currentQty <= 0 && b.currentQty > 0) return 1;
    if (a.currentQty > 0 && b.currentQty <= 0) return -1;

    // Items that will stock out soon go first
    if (a.stockout.willStockOut && b.stockout.willStockOut) {
      return (a.stockout.stockoutInMinutes || 999) - (b.stockout.stockoutInMinutes || 999);
    }
    if (a.stockout.willStockOut) return -1;
    if (b.stockout.willStockOut) return 1;

    // Highest confidence first
    const confOrder = { high: 0, medium: 1, low: 2, insufficient_data: 3 };
    return (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2);
  });

  return {
    country: countryCode,
    countryName: stockResult.countryName || countryCode,
    status: items.length > 0 ? 'analyzed' : 'no_items',
    dataSource,
    observationCount: observations.length,
    itemCount: items.length,
    restockCountdown: {
      nextRestockInMinutes: restockInfo.nextRestockInMinutes,
      nextRestockAt: restockInfo.nextRestock,
      cycleMinute: restockInfo.minutesSinceLastRestock,
    },
    items,
  };
}

/**
 * Helper: find matching item ID in existing data by name similarity.
 */
function findMatchingItemId(itemData, name) {
  if (!name) return null;
  const normalized = name.toLowerCase().trim();

  for (const [id, item] of Object.entries(itemData)) {
    if (item.name?.toLowerCase() === normalized) return id;
    // Partial match
    if (normalized.includes(item.name?.toLowerCase()) || item.name?.toLowerCase().includes(normalized)) return id;
  }

  return null;
}

/**
 * Helper: validate item name (filter out false positives).
 */
function isValidItemName(itemName) {
  const COUNTRY_NAMES = ['mexico', 'cayman islands', 'canada', 'hawaii', 'uk', 'united kingdom',
    'argentina', 'switzerland', 'japan', 'china', 'uae', 'south africa',
    'mex', 'cay', 'can', 'haw', 'uni', 'arg', 'swi', 'jap', 'chi', 'sou'];
  const COUNTRY_CODES = ['mex', 'cay', 'can', 'haw', 'uni', 'arg', 'swi', 'jap', 'chi', 'uae', 'sou'];

  if (COUNTRY_NAMES.includes(itemName.toLowerCase())) return false;
  if (/^\d{1,2}:\d{2}:\d{2}/.test(itemName)) return false;
  if (/\d{2}:\d{2}:\d{2}.*\d{2}\/\d{2}\/\d{2}/.test(itemName)) return false;
  if (/^[\d.]+%$/.test(itemName)) return false;
  if (/^\d{2,}$/.test(itemName.replace(/\s/g, ''))) return false;
  if (COUNTRY_CODES.includes(itemName.toLowerCase())) return false;
  if (itemName.length < 2 || itemName.length > 60) return false;

  return true;
}

/**
 * Get recommendations across all countries for the best items to travel for.
 */
async function getTravelRecommendations(maxItems = 20) {
  const countries = ['mex', 'cay', 'can', 'haw', 'uni', 'arg', 'swi', 'jap', 'chi', 'uae', 'sou'];
  const results = [];

  for (const country of countries) {
    try {
      const analysis = await analyzeCountry(country);
      if (analysis.status === 'analyzed') {
        analysis.items.forEach(item => {
          results.push({
            country,
            ...item
          });
        });
      }
    } catch (err) {
      console.error(`Error analyzing ${country}:`, err.message);
    }
  }

  results.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2, insufficient_data: 3 };
    const confDiff = (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2);
    if (confDiff !== 0) return confDiff;

    if (a.restock && b.restock) {
      return a.restock.nextInMinutes - b.restock.nextInMinutes;
    }
    if (a.restock) return -1;
    if (b.restock) return 1;

    return 0;
  });

  return results.slice(0, maxItems);
}

module.exports = {
  analyzeCountry,
  getTravelRecommendations,
  getDeterministicRestockInfo,
  calculateBurnRate,
  predictStockout,
  calculateOptimalArrival,
};