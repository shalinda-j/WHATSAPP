/**
 * UsageResetService
 * ─────────────────
 * Resets AI provider token usage (usageUsed → 0) at midnight 00:00:00
 * on the 1st of every calendar month.
 *
 * Also stores:
 *   usagePeriodStart  — start of the current billing period
 *   lastResetAt       — timestamp of the most recent automatic reset
 */

import Config from '../models/Config';

class UsageResetService {
  private schedulerInterval: NodeJS.Timeout | null = null;
  private lastCheckedMonth: number = -1;

  /** Call once on server startup to start the monthly scheduler */
  start(): void {
    console.log('📅 UsageResetService: Monthly token-usage reset scheduler started');

    // Check every hour whether a reset is due
    this.schedulerInterval = setInterval(() => {
      this.checkAndReset().catch((err) =>
        console.error('UsageResetService check error:', err),
      );
    }, 60 * 60 * 1000); // every hour

    // Also run an immediate check on startup
    this.checkAndReset().catch((err) =>
      console.error('UsageResetService initial check error:', err),
    );
  }

  stop(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  /**
   * Check if we have crossed into a new month and the usage
   * has not yet been reset for this month's 1st day.
   */
  private async checkAndReset(): Promise<void> {
    const now = new Date();
    const currentMonth = now.getMonth(); // 0-11
    const currentYear = now.getFullYear();
    const dayOfMonth = now.getDate();

    // Only trigger on day 1 of the month
    if (dayOfMonth !== 1) return;

    // Avoid double-reset in the same month
    if (this.lastCheckedMonth === currentMonth) return;

    // Check if at least one provider has NOT been reset this month
    const periodStart = new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);
    const providers = await Config.find({ isProvider: true });

    const needsReset = providers.some((p) => {
      if (!p.lastResetAt) return true;
      // If lastResetAt is before the start of this period → needs reset
      return p.lastResetAt < periodStart;
    });

    if (!needsReset) {
      this.lastCheckedMonth = currentMonth;
      return;
    }

    await this.performReset('auto');
    this.lastCheckedMonth = currentMonth;
  }

  /**
   * Reset all provider usage counters.
   * @param triggeredBy  'auto' | 'manual' — for logging
   */
  async performReset(triggeredBy: 'auto' | 'manual' = 'manual'): Promise<{ resetCount: number }> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    const result = await Config.updateMany(
      { isProvider: true },
      {
        $set: {
          usageUsed: 0,
          lastResetAt: now,
          usagePeriodStart: periodStart,
        },
      },
    );

    const resetCount = result.modifiedCount ?? 0;
    console.log(
      `🔄 UsageResetService: ${triggeredBy === 'auto' ? 'Auto' : 'Manual'} reset — cleared usage for ${resetCount} provider(s). Period: ${periodStart.toISOString()}`,
    );

    return { resetCount };
  }

  /**
   * Reset a single provider's usage counter.
   */
  async resetProvider(providerId: string): Promise<boolean> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    const result = await Config.findByIdAndUpdate(providerId, {
      $set: {
        usageUsed: 0,
        lastResetAt: now,
        usagePeriodStart: periodStart,
      },
    });

    if (result) {
      console.log(`🔄 UsageResetService: Manual reset for provider ${providerId}`);
      return true;
    }
    return false;
  }

  /**
   * Get the current billing cycle info (useful for the frontend).
   */
  getCycleInfo(): {
    periodStart: Date;
    periodEnd: Date;
    nextReset: Date;
    daysRemaining: number;
    daysElapsed: number;
    totalDays: number;
    progressPct: number;
  } {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const periodStart = new Date(year, month, 1, 0, 0, 0, 0);
    // Last moment of the current month
    const periodEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
    // First moment of next month (the reset fires)
    const nextReset = new Date(year, month + 1, 1, 0, 0, 0, 0);

    const totalMs = periodEnd.getTime() - periodStart.getTime();
    const elapsedMs = now.getTime() - periodStart.getTime();
    const remainingMs = periodEnd.getTime() - now.getTime();

    const totalDays = Math.ceil(totalMs / 86_400_000);
    const daysElapsed = Math.floor(elapsedMs / 86_400_000);
    const daysRemaining = Math.ceil(remainingMs / 86_400_000);
    const progressPct = Math.min(100, Math.round((elapsedMs / totalMs) * 100));

    return { periodStart, periodEnd, nextReset, daysRemaining, daysElapsed, totalDays, progressPct };
  }
}

export const usageResetService = new UsageResetService();
