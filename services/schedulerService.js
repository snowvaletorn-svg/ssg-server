// Scheduler Service - runs automated weekly snapshot every Sunday at 12:00 UTC
// and daily stock price snapshot at 00:00 TCT (Torn City Time = UTC-0, so 00:00 UTC)
const cron = require('node-cron');
const axios = require('axios');
const { takeSnapshot, sendWeeklyReport } = require('./snapshotService');
const StockPriceSnapshot = require('../models/StockPriceSnapshot');

let schedulerStarted = false;

/**
 * Take a daily snapshot of all stock prices from the Torn API.
 * Uses the faction API key for broader access.
 */
async function takeDailyStockSnapshot() {
  try {
    const FactionConfig = require('../models/FactionConfig');
    const config = await FactionConfig.findOne({ key: 'config' });
    const factionKey = config?.tornFactionApiKey?.trim() || process.env.TORN_FACTION_API_KEY?.trim();

    if (!factionKey) {
      console.warn('[StockScheduler] No faction API key configured — skipping stock snapshot.');
      return { success: false, message: 'No faction API key' };
    }

    const encodedKey = encodeURIComponent(factionKey);
    const tornRes = await axios.get(
      `https://api.torn.com/torn/?selections=stocks&key=${encodedKey}`,
      { timeout: 15000 }
    );

    if (tornRes.data.error) {
      console.error('[StockScheduler] Torn API error:', tornRes.data.error.error);
      return { success: false, message: tornRes.data.error.error };
    }

    const stocksData = tornRes.data.stocks || {};
    const today = new Date().toISOString().split('T')[0];

    const snapshotStocks = Object.entries(stocksData).map(([stockId, stock]) => {
      const stockName = stock.name || '';
      const price = stock.current_price || 0;
      const totalShares = stock.total_shares || 1;
      const dividend = stock.dividend || 0;
      const dividendPerShare = totalShares > 0 ? dividend / totalShares : 0;
      const dividendYield = price > 0 ? (dividendPerShare / price) * 100 : 0;

      // Check if tiered (most stocks are, except the exchange indices)
      const NON_TIERED = ['None', 'TCSE', 'SSE', 'ENX', 'HKSE', 'LSE', 'ASX', 'TSX', 'FSE', 'SGX', 'BSE', 'JSE'];
      const isTiered = !NON_TIERED.includes(stockName);

      const STOCK_TIERS = {
        'SysFlare': [100, 500, 1000, 5000, 10000],
        'TornCity': [100, 500, 1000, 5000, 10000],
        'Torn': [100, 500, 1000, 5000, 10000],
        'Age of Science': [100, 500, 1000, 5000, 10000],
        'Law Firm': [100, 500, 1000, 5000, 10000],
        'Fitness Club': [100, 500, 1000, 5000, 10000],
        'Meat Factory': [100, 500, 1000, 5000, 10000],
        'Private Security': [100, 500, 1000, 5000, 10000],
        'Television Network': [100, 500, 1000, 5000, 10000],
        'Software House': [100, 500, 1000, 5000, 10000],
        'Music Store': [100, 500, 1000, 5000, 10000],
        'Clothing Store': [100, 500, 1000, 5000, 10000],
        'Property Broker': [100, 500, 1000, 5000, 10000],
        'Grocery Store': [100, 500, 1000, 5000, 10000],
        'Game Shop': [100, 500, 1000, 5000, 10000],
        'Flower Shop': [100, 500, 1000, 5000, 10000],
        'Car Dealership': [100, 500, 1000, 5000, 10000],
        'Candle Shop': [100, 500, 1000, 5000, 10000],
        'Butcher': [100, 500, 1000, 5000, 10000],
        'Bicycle Shop': [100, 500, 1000, 5000, 10000],
        'Adult Bookstore': [100, 500, 1000, 5000, 10000],
        '24/7 Supermarket': [100, 500, 1000, 5000, 10000],
        'Shoe Store': [100, 500, 1000, 5000, 10000],
        'Restaurant': [100, 500, 1000, 5000, 10000],
        'Pharmacy': [100, 500, 1000, 5000, 10000],
        'Pet Shop': [100, 500, 1000, 5000, 10000],
        'Nightclub': [100, 500, 1000, 5000, 10000],
        'Museum': [100, 500, 1000, 5000, 10000],
        'Lingerie Store': [100, 500, 1000, 5000, 10000],
        'Jewelry Store': [100, 500, 1000, 5000, 10000],
        'Hair Salon': [100, 500, 1000, 5000, 10000],
        'Gas Station': [100, 500, 1000, 5000, 10000],
        'Furniture Store': [100, 500, 1000, 5000, 10000],
        'Firework Shop': [100, 500, 1000, 5000, 10000],
        'Factory': [100, 500, 1000, 5000, 10000],
        'Electric Car Co': [100, 500, 1000, 5000, 10000],
        'Education Center': [100, 500, 1000, 5000, 10000],
        'Dollar Store': [100, 500, 1000, 5000, 10000],
        'Department Store': [100, 500, 1000, 5000, 10000],
        'Computer Store': [100, 500, 1000, 5000, 10000],
        'Cigar Shop': [100, 500, 1000, 5000, 10000],
        'Book Shop': [100, 500, 1000, 5000, 10000],
        'Bakery': [100, 500, 1000, 5000, 10000],
        'Auto Parts Store': [100, 500, 1000, 5000, 10000],
        'Arms Dealer': [100, 500, 1000, 5000, 10000],
        'Amusement Park': [100, 500, 1000, 5000, 10000],
        'Airstrip': [100, 500, 1000, 5000, 10000],
      };

      const tiers = (STOCK_TIERS[stockName] || []).map((shares, idx) => ({
        tier: idx + 1,
        sharesRequired: shares,
        cost: shares * price,
        benefit: `Tier ${idx + 1}`
      }));

      return {
        stockId: parseInt(stockId),
        name: stockName,
        acronym: stock.acronym || '',
        price,
        marketCap: stock.market_cap || 0,
        totalShares,
        investors: stock.investors || 0,
        availableShares: stock.available_shares || 0,
        dividend: stock.dividend || 0,
        benefit: stock.benefit || '',
        benefitValue: dividendYield,
        isTiered,
        tiers
      };
    });

    await StockPriceSnapshot.findOneAndUpdate(
      { snapshotDate: today },
      {
        snapshotDate: today,
        recordedAt: new Date(),
        stocks: snapshotStocks
      },
      { upsert: true }
    );

    console.log(`[StockScheduler] ✅ Daily stock snapshot saved for ${today} (${snapshotStocks.length} stocks)`);
    return { success: true, date: today, count: snapshotStocks.length };
  } catch (err) {
    console.error('[StockScheduler] Error:', err.message);
    return { success: false, message: err.message };
  }
}

function startScheduler() {
  if (schedulerStarted) {
    console.log('[Scheduler] Already running — skipping duplicate start.');
    return;
  }

  // Weekly snapshot: Every Sunday at 12:00 UTC
  const weeklyTask = cron.schedule('0 12 * * 0', async () => {
    console.log('[Scheduler] ⏰ Weekly snapshot triggered — Sunday 12:00 UTC');
    try {
      const result = await takeSnapshot('scheduler');

      if (!result.success) {
        console.error('[Scheduler] Snapshot failed:', result.message);
        return;
      }

      console.log(`[Scheduler] Snapshot saved: ${result.snapshotId} (${result.membersSnapshotted} members)`);

      if (result.diffCsv) {
        const sendResults = await sendWeeklyReport(
          result.diffCsv,
          'Weekly Stat Progress Report',
          false,
          null,
          'snowvaletorn@gmail.com'
        );
        console.log('[Scheduler] Send results:', JSON.stringify(sendResults));
      } else {
        console.warn('[Scheduler] No diff CSV generated — skipping send.');
      }
    } catch (err) {
      console.error('[Scheduler] Uncaught error during weekly snapshot:', err.message);
    }
  }, {
    timezone: 'UTC'
  });

  // Daily stock snapshot: Every day at 00:00 UTC (TCT)
  const stockTask = cron.schedule('0 0 * * *', async () => {
    console.log('[StockScheduler] ⏰ Daily stock snapshot triggered — 00:00 UTC');
    await takeDailyStockSnapshot();
  }, {
    timezone: 'UTC'
  });

  schedulerStarted = true;
  console.log('[Scheduler] ✅ Weekly snapshot scheduled — every Sunday at 12:00 UTC');
  console.log('[StockScheduler] ✅ Daily stock snapshot scheduled — every day at 00:00 UTC');
  return { weeklyTask, stockTask };
}

module.exports = { startScheduler };
