const StockObservation = require('../models/StockObservation');

/**
 * Stock Analysis Service
 * * Analyzes historical stock observations to detect restock events,
 * calculate burn rates, and predict future stock levels and restocks.
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

// Torn Flight Times Lookup (Base times in minutes)
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
 */
function detectRestocks(snapshots) {
  if (!snapshots || snapshots.length < 2) return { restocks: [], intervals: [] };

  const sorted = [...snapshots].sort((a, b) => a.time - b.time);
  const restocks = [];
  const intervals = [];

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

      if (restocks.length >= 2) {
        const prevRestock = restocks[restocks.length - 2];
        intervals.push(curr.time - prevRestock.detectedAt);
      }
    }
  }

  return { restocks, intervals };
}

/**
 * Calculate burn rate using multiple methods for better accuracy.
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
    const first = recentWindow; // FIXED: Access element index 0 instead of assigning the entire array
    const last = recentWindow[recentWindow.length - 1];
    const timeDiffMin = (last.time - first.time) / (60 * 1000);
    const qtyDiff = first.quantity - last.quantity;
    if (timeDiffMin > 0 && qtyDiff > 0) {
      recentBurnRate = qtyDiff / timeDiffMin;
    }
  }

  // Method 2: Overall trend (all historical data across the 7-day segment)
  const { restocks } = detectRestocks(sorted);
  const restockTimes = new Set(restocks.map(r => r.detectedAt));

  const segments = [];
  let segmentStart = sorted; // FIXED: Access element index 0 instead of assigning the entire array

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
    timeSpanMinutes: Math.round((sorted[sorted.length - 1].time - sorted.time) / (60 * 1000)) // FIXED: Check property on index 0
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
 * Predict when the next restock will happen based on observed intervals.
 */
function predictNextRestock(intervals, lastRestockTime) {
  if (!intervals || intervals.length === 0 || !lastRestockTime) {
    return null;
  }

  const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
  const stdDev = Math.sqrt(
    intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length
  );

  const cv = avgInterval > 0 ? stdDev / avgInterval : 1;

  let confidence = CONFIDENCE.HIGH;
  if (intervals.length < 2) confidence = CONFIDENCE.LOW;
  else if (intervals.length < 4) confidence = CONFIDENCE.MEDIUM;
  else if (cv > 0.5) confidence = CONFIDENCE.LOW;

  return {
    avgInterval: Math.round(avgInterval / (60 * 1000)),
    avgIntervalMs: Math.round(avgInterval),
    stdDevMs: Math.round(stdDev),
    nextRestockTime: new Date(lastRestockTime + avgInterval).toISOString(),
    nextRestockInMinutes: Math.round(avgInterval / (60 * 1000)),
    intervalsObserved: intervals.length,
    confidence,
    variability: Math.round(cv * 100) / 100
  };
}

/**
 * Get stockout time estimate considering upcoming restocks.
 */
function getEffectiveStockout(currentQty, burnRate, nextRestockPrediction) {
  const stockoutMin = predictStockout(currentQty, burnRate);

  if (!stockoutMin) {
    return { willStockOut: false, stockoutInMinutes: null };
  }

  if (nextRestockPrediction && nextRestockPrediction.nextRestockInMinutes) {
    if (nextRestockPrediction.nextRestockInMinutes < stockoutMin) {
      return {
        willStockOut: false,
        stockoutInMinutes: stockoutMin,
        minimumBeforeMinutes: Math.round(currentQty / burnRate - stockoutMin * 0.1),
        note: 'Restock expected before stockout'
      };
    }
  }

  return {
    willStockOut: true,
    stockoutInMinutes: stockoutMin,
    predictedAt: new Date(Date.now() + stockoutMin * 60 * 1000).toISOString()
  };
}

/**
 * Calculate the optimal arrival window for an item.
 */
function calculateOptimalArrival(currentQty, burnRate, nextRestockPrediction, flightTimeMinutes) {
  if (currentQty <= 0) {
    if (nextRestockPrediction && nextRestockPrediction.nextRestockInMinutes) {
      const restockIn = nextRestockPrediction.nextRestockInMinutes;
      if (restockIn <= flightTimeMinutes) {
        return {
          departureRecommendation: { action: 'Depart now', reason: `Restock expected in ${restockIn} min (before you land)` }
        };
      }
      return {
        departureRecommendation: { action: `Wait ${Math.max(0, restockIn - flightTimeMinutes)} min`, reason: `Item is out of stock. Next restock in ${restockIn} min.` }
      };
    }
    return {
      departureRecommendation: { action: 'Do not travel', reason: 'Item is out of stock with no restock data.' }
    };
  }

  if (!burnRate || burnRate <= 0) {
    return { available: true, departureRecommendation: { action: 'Depart now', reason: 'Stock exists but depletion rate is unknown' } };
  }

  const stockoutMin = predictStockout(currentQty, burnRate);
  if (!stockoutMin) {
    return { available: true, departureRecommendation: { action: 'Depart now', reason: 'Sufficient stock' } };
  }

  if (nextRestockPrediction && nextRestockPrediction.nextRestockInMinutes) {
    const restockIn = nextRestockPrediction.nextRestockInMinutes;
    const windowAfterRestock = Math.round(currentQty / burnRate);

    return {
      currentStockWillLast: stockoutMin,
      nextRestockIn: restockIn,
      windowAfterRestock,
      optimalArrivalWindows: [
        { start: stockoutMin, end: restockIn + windowAfterRestock, label: 'After restock' }
      ],
      departureRecommendation: stockoutMin > flightTimeMinutes
        ? { action: 'Depart now', reason: `Stock will last ${stockoutMin} min; you arrive in ${flightTimeMinutes} min` }
        : { action: `Wait or arrive after restock`, reason: `Current stock sells out in ${stockoutMin} min; flight is ${flightTimeMinutes} min` }
    };
  }

  const neededFlightBuffer = stockoutMin - flightTimeMinutes;

  return {
    currentStockWillLast: stockoutMin,
    expiring: stockoutMin < 30,
    departureRecommendation: neededFlightBuffer > 0
      ? { action: 'Depart now', reason: `${neededFlightBuffer} min of stock remaining after arrival` }
      : { action: 'Wait - stock critically low', reason: `Stock lasts ${stockoutMin} min, but flight takes ${flightTimeMinutes} min` }
  };
}

/**
 * Full analysis for a single country (Evaluating a 7-day rolling window)
 */
async function analyzeCountry(country) {
  const countryCode = country.toLowerCase();
  const flightTime = FLIGHT_TIMES[countryCode] || 120; 

  // 1. Compute timestamp threshold for 7 days ago
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Fetch all metrics inside our rolling window boundary
  const observations = await StockObservation.find({ 
      country: countryCode,
      receivedAt: { $gte: sevenDaysAgo } 
    })
    .sort({ receivedAt: -1 })
    .lean();

  if (!observations || observations.length === 0) {
    return { country: countryCode, status: 'no_data', items: [] };
  }

  const itemData = {};

  observations.forEach(obs => {
    // FORCE-CAST: Standardize rawTime to a pure millisecond numeric timestamp
    let rawTime = 0;
    if (obs.receivedAt instanceof Date) {
      rawTime = obs.receivedAt.getTime();
    } else if (typeof obs.receivedAt === 'number') {
      rawTime = obs.receivedAt < 9999999999 ? obs.receivedAt * 1000 : obs.receivedAt;
    } else if (obs.receivedAt) {
      rawTime = new Date(obs.receivedAt).getTime();
    }

    if (!rawTime || isNaN(rawTime)) {
      rawTime = Date.now();
    }

    (obs.stocks || []).forEach(s => {
      // Guard clause to avoid recording empty or bad items
      if (!s || typeof s.name === 'undefined') return;

      if (!itemData[s.id]) {
        itemData[s.id] = {
          id: s.id,
          name: s.name,
          snapshots: []
        };
      }
      
      itemData[s.id].snapshots.push({
        quantity: typeof s.quantity === 'number' ? s.quantity : 0,
        cost: typeof s.cost === 'number' ? s.cost : 0,
        time: rawTime,
        observedAt: obs.observedAt || Math.floor(rawTime / 1000)
      });
    });
  });

  const items = [];

  Object.values(itemData).forEach(item => {
    if (!item.snapshots || item.snapshots.length === 0) return;

    // Isolate a clean sorting sequence
    const sortedAsc = [...item.snapshots].sort((a, b) => a.time - b.time);
    const sortedDesc = [...item.snapshots].sort((a, b) => b.time - a.time);
    
    // Pick out the newest snapshot record safely
    const currentSnapshot = sortedDesc;
    if (!currentSnapshot) return;

    const currentQty = typeof currentSnapshot.quantity === 'number' ? currentSnapshot.quantity : 0;
    const currentCost = typeof currentSnapshot.cost === 'number' ? currentSnapshot.cost : 0;

    const { restocks, intervals } = detectRestocks(sortedAsc);
    const burnData = calculateBurnRate(sortedAsc);
    const lastRestock = restocks.length > 0 ? restocks[restocks.length - 1] : null;
    const nextRestock = predictNextRestock(
      intervals,
      lastRestock ? lastRestock.detectedAt : null
    );

    const effectiveBurnRate = burnData ? (burnData.overall || burnData.recent) : 0;
    const stockout = getEffectiveStockout(currentQty, effectiveBurnRate, nextRestock);
    
    // Evaluate data freshness safely using clean numeric types
    const lastSeen = currentSnapshot.time || Date.now();
    const minutesSinceLastUpdate = (Date.now() - lastSeen) / (60 * 1000);
    const cleanFreshness = isNaN(minutesSinceLastUpdate) ? 0 : Math.round(minutesSinceLastUpdate);

    // Run our optimization tracker
    let optimalArrival = calculateOptimalArrival(currentQty, effectiveBurnRate, nextRestock, flightTime);

    // CRITICAL LIVE MONITORING OVERRIDES
    if (currentQty <= 0) {
      optimalArrival.departureRecommendation = {
        action: 'Do not travel',
        reason: 'Item is entirely out of stock.'
      };
    } 
    // STALE OVERRIDE: Using your customized 24-hour limit safety fallback
    else if (cleanFreshness > 1440 || cleanFreshness < 0) {
      optimalArrival.departureRecommendation = {
        action: 'Wait - Data Stale',
        reason: `Last update was ${cleanFreshness} min ago.`
      };
    }

    console.log(`[ADVISOR] Item: ${item.name.padEnd(20)} | Qty: ${String(currentQty).padEnd(6)} | Freshness: ${cleanFreshness}m | Rec: ${optimalArrival.departureRecommendation.action}`);

    items.push({
      id: item.id,
      name: item.name,
      currentQty,
      currentCost,
      burnRate: {
        perMin: effectiveBurnRate,
        perHour: Math.round(effectiveBurnRate * 60 * 100) / 100,
        recentPerMin: burnData ? burnData.recent : 0,
        overallPerMin: burnData ? burnData.overall : 0
      },
      restocks: {
        detected: restocks.length,
        intervals: intervals.length > 0 ? {
          averageMinutes: Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length / (60 * 1000)),
          count: intervals.length
        } : null
      },
      stockout,
      nextRestock: nextRestock ? {
        inMinutes: nextRestock.nextRestockInMinutes,
        confidence: nextRestock.confidence,
        intervalsObserved: nextRestock.intervalsObserved,
        variability: nextRestock.variability
      } : null,
      optimalArrival,
      dataFreshness: {
        minutesSinceUpdate: cleanFreshness,
        observationsUsed: item.snapshots.length,
        timeSpanMinutes: burnData ? burnData.timeSpanMinutes : 0
      },
      confidence: burnData && burnData.timeSpanMinutes >= 1440 && item.snapshots.length >= 15
        ? CONFIDENCE.HIGH
        : (item.snapshots.length >= 5 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW)
    });
  });

  items.sort((a, b) => {
    if (a.stockout.willStockOut !== b.stockout.willStockOut) {
      return a.stockout.willStockOut ? -1 : 1;
    }
    if (a.stockout.stockoutInMinutes && b.stockout.stockoutInMinutes) {
      return a.stockout.stockoutInMinutes - b.stockout.stockoutInMinutes;
    }
    const confOrder = { high: 0, medium: 1, low: 2, insufficient_data: 3 };
    return (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2);
  });

  return {
    country: countryCode,
    status: 'analyzed',
    observationCount: observations.length,
    itemCount: items.length,
    lastObservation: observations?.receivedAt,
    items
  };
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

    if (a.nextRestock && b.nextRestock) {
      return a.nextRestock.inMinutes - b.nextRestock.inMinutes;
    }
    if (a.nextRestock) return -1;
    if (b.nextRestock) return 1;

    return 0;
  });

  return results.slice(0, maxItems);
}

module.exports = {
  analyzeCountry,
  getTravelRecommendations,
  detectRestocks,
  calculateBurnRate,
  predictStockout,
  predictNextRestock
};