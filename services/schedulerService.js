// Scheduler Service - runs automated weekly snapshot every Sunday at 12:00 UTC
const cron = require('node-cron');
const { takeSnapshot, sendWeeklyReport } = require('./snapshotService');

let schedulerStarted = false;

function startScheduler() {
  if (schedulerStarted) {
    console.log('[Scheduler] Already running — skipping duplicate start.');
    return;
  }

  // Every Sunday at 12:00 UTC  →  cron: '0 12 * * 0'
  //   ┌──── minute (0)
  //   │  ┌─ hour (12 = noon UTC)
  //   │  │  ┌ day-of-month (*)
  //   │  │  │ ┌ month (*)
  //   │  │  │ │ ┌ day-of-week (0 = Sunday)
  //   0  12 * * 0
  const task = cron.schedule('0 12 * * 0', async () => {
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
          false
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

  schedulerStarted = true;
  console.log('[Scheduler] ✅ Weekly snapshot scheduled — every Sunday at 12:00 UTC');
  return task;
}

module.exports = { startScheduler };
