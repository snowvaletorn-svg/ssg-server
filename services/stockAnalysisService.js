const StockObservation = require('../models/StockObservation');

/**
 * Stock Analysis Service
 * 
 * Analyzes historical stock observations to detect restock events,
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

/**
 * Detect restock events from a time-series of stock observations for a single item.
 * A restock is detected when quantity increases significantly between observations.
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

    // A restock event: quantity increased by >20% of previous quantity
    // This catches both full restocks and partial restocks
    if (qtyDiff > 0 && (prev.quantity === 0 || qtyDiff > prev.quantity * 0.1)) {
      restocks.push({
        detectedAt: curr.time,
        previousQty: prev.quantity,
        newQty: curr.quantity,
        increase: qtyDiff,
        timeSinceLastObservation: timeDiff
      });

      // Calculate interval from previous restock
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

  // Method 1: Recent trend (last 3 observations or 30 min, whichever is less)
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

  // Method 2: Overall trend (all observations, excluding restocks)
  // Detect and exclude restocks from the main trend
  const { restocks } = detectRestocks(sorted);
  const restockTimes = new Set(restocks.map(r => r.detectedAt));

  // Get segments between restocks
  const segments = [];
  let segmentStart = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (restockTimes.has(sorted[i].time)) {
      // End of a segment (this observation is a restock)
      if (segmentStart.time < sorted[i].time) {
        const timeDiffMin = (sorted[i].time - segmentStart.time) / (60 * 1000);
        const qtyDiff = segmentStart.quantity - sorted[i - 1].quantity;
        if (timeDiffMin > 0 && qtyDiff > 0) {
          segments.push({ burnRate: qtyDiff / timeDiffMin, duration: timeDiffMin, qtySold: qtyDiff });
        }
      }
      segmentStart = sorted[i];
    } else if (i === sorted.length - 1) {
      // Last observation, not a restock
      const timeDiffMin = (sorted[i].time - segmentStart.time) / (60 * 1000);
      const qtyDiff = segmentStart.quantity - sorted[i].quantity;
      if (timeDiffMin > 0 && qtyDiff > 0) {
        segments.push({ burnRate: qtyDiff / timeDiffMin, duration: timeDiffMin, qtySold: qtyDiff });
      }
    }
  }

  // Weighted average burn rate (weight by duration)
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

  // Coefficient of variation: how consistent the intervals are
  const cv = avgInterval > 0 ? stdDev / avgInterval : 1;

  let confidence = CONFIDENCE.HIGH;
  if (intervals.length < 2) confidence = CONFIDENCE.LOW;
  else if (intervals.length < 4) confidence = CONFIDENCE.MEDIUM;
  else if (cv > 0.5) confidence = CONFIDENCE.LOW; // High variance = low confidence

  return {
    avgInterval: Math.round(avgInterval / (60 * 1000)), // minutes
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
 * If a restock is expected before stockout, the item doesn't truly stock out.
 */
function getEffectiveStockout(currentQty, burnRate, nextRestockPrediction) {
  const stockoutMin = predictStockout(currentQty, burnRate);

  if (!stockoutMin) {
    return { willStockOut: false, stockoutInMinutes: null };
  }

  if (nextRestockPrediction && nextRestockPrediction.nextRestockInMinutes) {
    if (nextRestockPrediction.nextRestockInMinutes < stockoutMin) {
      // Item will restock before it runs out
      return {
        willStockOut: false,
        stockoutInMinutes: stockoutMin,
        minimumBeforeMinutes: Math.round(currentQty / burnRate - stockoutMin * 0.1), // min stock level
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
 * Returns when you should be in-country to catch an item before it stocks out.
 */
function calculateOptimalArrival(currentQty, burnRate, nextRestockPrediction, flightTimeMinutes) {
  // FIX: If quantity is 0, we can't assume it's available unless a restock is happening right now
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
 * Full analysis for a single country: all items with burn rates, restock predictions, and recommendations.
 */
async function analyzeCountry(country) {
  const countryCode = country.toLowerCase();

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

  // Inside analyzeCountry(country) around line 186:
  // Replace the hardcoded 5 with the actual dynamic lookup:
  const flightTime = FLIGHT_TIMES[countryCode] || 120; // fallback to 2 hours if unknown
  const optimalArrival = calculateOptimalArrival(currentQty, effectiveBurnRate, nextRestock, flightTime);
  // Fetch all observations for this country
  const observations = await StockObservation.find({ country: countryCode })
    .sort({ receivedAt: -1 })
    .limit(100)
    .lean();

  if (!observations || observations.length === 0) {
    return { country: countryCode, status: 'no_data', items: [] };
  }

  // Build per-item timelines
  const itemData = {};

  observations.forEach(obs => {
    (obs.stocks || []).forEach(s => {
      if (!itemData[s.id]) {
        itemData[s.id] = {
          id: s.id,
          name: s.name,
          snapshots: []
        };
      }
      itemData[s.id].snapshots.push({
        quantity: s.quantity,
        cost: s.cost,
        time: new Date(obs.receivedAt).getTime(),
        observedAt: obs.observedAt
      });
    });
  });

  // Analyze each item
  const items = [];

  Object.values(itemData).forEach(item => {
    const { restocks, intervals } = detectRestocks(item.snapshots);
    const burnData = calculateBurnRate(item.snapshots);
    const lastRestock = restocks.length > 0 ? restocks[restocks.length - 1] : null;
    const nextRestock = predictNextRestock(
      intervals,
      lastRestock ? lastRestock.detectedAt : null
    );

    const currentSnapshot = item.snapshots.sort((a, b) => b.time - a.time)[0];
    const currentQty = currentSnapshot ? currentSnapshot.quantity : 0;
    const currentCost = currentSnapshot ? currentSnapshot.cost : 0;

    // Use overall burn rate for predictions (more stable)
    const effectiveBurnRate = burnData ? (burnData.overall || burnData.recent) : 0;
    const stockout = getEffectiveStockout(currentQty, effectiveBurnRate, nextRestock);
    const optimalArrival = calculateOptimalArrival(currentQty, effectiveBurnRate, nextRestock, 5);

    // Determine data freshness
    const lastSeen = currentSnapshot ? currentSnapshot.time : 0;
    const minutesSinceUpdate = (Date.now() - lastSeen) / (60 * 1000);

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
        minutesSinceUpdate: Math.round(minutesSinceUpdate),
        observationsUsed: item.snapshots.length,
        timeSpanMinutes: burnData ? burnData.timeSpanMinutes : 0
      },
      confidence: burnData && burnData.timeSpanMinutes >= 60 && item.snapshots.length >= 5
        ? CONFIDENCE.HIGH
        : (item.snapshots.length >= 3 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW)
    });
  });

  // Sort: items with stockout risk first, then by confidence
  items.sort((a, b) => {
    // Items that will stock out first
    if (a.stockout.willStockOut !== b.stockout.willStockOut) {
      return a.stockout.willStockOut ? -1 : 1;
    }
    // Then by stockout time (soonest first)
    if (a.stockout.stockoutInMinutes && b.stockout.stockoutInMinutes) {
      return a.stockout.stockoutInMinutes - b.stockout.stockoutInMinutes;
    }
    // Then by confidence
    const confOrder = { high: 0, medium: 1, low: 2, insufficient_data: 3 };
    return (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2);
  });

  return {
    country: countryCode,
    status: 'analyzed',
    observationCount: observations.length,
    itemCount: items.length,
    lastObservation: observations[0]?.receivedAt,
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

  // Sort by profitability signals and confidence
  results.sort((a, b) => {
    // Prefer items with good data (medium+ confidence)
    const confOrder = { high: 0, medium: 1, low: 2, insufficient_data: 3 };
    const confDiff = (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2);
    if (confDiff !== 0) return confDiff;

    // Items that will restock soon (opportunity to buy)
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