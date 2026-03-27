export interface DrawdownState {
  highWaterMark: number;
  currentEquity: number;
  currentDrawdown: number;       // percentage
  maxDrawdown: number;           // percentage (worst ever)
  drawdownStart: number | null;  // timestamp when drawdown began
  recoveryTarget: number;        // equity needed to recover
  dailyStartEquity: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  lastResetDate: string;         // YYYY-MM-DD
}

export function createDrawdownTracker(initialEquity: number): DrawdownState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    highWaterMark: initialEquity,
    currentEquity: initialEquity,
    currentDrawdown: 0,
    maxDrawdown: 0,
    drawdownStart: null,
    recoveryTarget: initialEquity,
    dailyStartEquity: initialEquity,
    dailyPnl: 0,
    dailyPnlPercent: 0,
    lastResetDate: today,
  };
}

export function updateDrawdown(state: DrawdownState, newEquity: number): DrawdownState {
  const today = new Date().toISOString().slice(0, 10);
  const updated = { ...state };

  // Reset daily tracking if new day
  if (today !== updated.lastResetDate) {
    updated.dailyStartEquity = updated.currentEquity;
    updated.dailyPnl = 0;
    updated.dailyPnlPercent = 0;
    updated.lastResetDate = today;
  }

  updated.currentEquity = newEquity;

  // Update high water mark
  if (newEquity > updated.highWaterMark) {
    updated.highWaterMark = newEquity;
    updated.drawdownStart = null;
    updated.recoveryTarget = newEquity;
  }

  // Calculate current drawdown from peak
  if (updated.highWaterMark > 0) {
    updated.currentDrawdown = ((updated.highWaterMark - newEquity) / updated.highWaterMark) * 100;
  }

  // Track when drawdown started
  if (updated.currentDrawdown > 0 && updated.drawdownStart === null) {
    updated.drawdownStart = Date.now();
  }

  // Update max drawdown
  if (updated.currentDrawdown > updated.maxDrawdown) {
    updated.maxDrawdown = updated.currentDrawdown;
  }

  // Update daily P&L
  updated.dailyPnl = newEquity - updated.dailyStartEquity;
  if (updated.dailyStartEquity > 0) {
    updated.dailyPnlPercent = (updated.dailyPnl / updated.dailyStartEquity) * 100;
  }

  // Recovery target is always the high water mark
  updated.recoveryTarget = updated.highWaterMark;

  return updated;
}

// Check if we've exceeded drawdown limits
export function checkDrawdownLimits(
  state: DrawdownState,
  maxDrawdownPercent: number,
  maxDailyLossPercent: number
): { breached: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (state.currentDrawdown >= maxDrawdownPercent) {
    reasons.push(
      `Drawdown ${state.currentDrawdown.toFixed(2)}% exceeds max ${maxDrawdownPercent}%`
    );
  }

  if (state.dailyPnlPercent <= -maxDailyLossPercent) {
    reasons.push(
      `Daily loss ${Math.abs(state.dailyPnlPercent).toFixed(2)}% exceeds max ${maxDailyLossPercent}%`
    );
  }

  return { breached: reasons.length > 0, reasons };
}

// Calculate how much position reduction is needed during drawdown
export function drawdownPositionScale(
  currentDrawdown: number,
  maxDrawdown: number
): number {
  if (currentDrawdown <= 0) return 1.0;
  if (maxDrawdown <= 0) return 0;

  // Linear scale-down: at 50% of max drawdown, reduce to 50% size
  // At 75% of max drawdown, reduce to 25% size
  const ratio = currentDrawdown / maxDrawdown;
  if (ratio >= 1) return 0;        // fully breached, no trading
  if (ratio >= 0.75) return 0.25;  // severe: quarter size only
  if (ratio >= 0.5) return 0.5;    // moderate: half size
  return 1.0 - ratio * 0.5;       // gradual reduction
}

// Estimate time to recovery based on recent performance
export function estimateRecoveryTime(
  state: DrawdownState,
  avgDailyReturn: number
): number | null {
  if (state.currentDrawdown <= 0 || avgDailyReturn <= 0) return null;

  const deficit = state.highWaterMark - state.currentEquity;
  const avgDailyGain = state.currentEquity * (avgDailyReturn / 100);
  if (avgDailyGain <= 0) return null;

  return Math.ceil(deficit / avgDailyGain); // days
}
