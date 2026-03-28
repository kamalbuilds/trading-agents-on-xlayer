// Regime Detection - Tier 1 (Technical)
// Classifies market into regimes using ADX, BB bandwidth, ATR from strategy results
// Hysteresis: 3-candle confirmation, 6-candle cooldown, 50/50 blend during transition

import type { StrategyResult } from "@/lib/types";
import { REGIME_THRESHOLDS } from "@/lib/config";

export type MarketRegime = "strong_trend" | "ranging" | "breakout" | "high_volatility" | "neutral";

export interface RegimeResult {
  regime: MarketRegime;
  confidence: number;
  weights: Record<string, number>;
  confidenceMultipliers: Record<string, number>;
  transitionBlend: boolean;
}

// Default weights per regime (which strategies perform best in each)
const REGIME_WEIGHTS: Record<MarketRegime, Record<string, number>> = {
  strong_trend: {
    evolved_trend: 0.26, trend_following: 0.22, momentum: 0.13,
    smart_money: 0.10, supertrend: 0.09, ichimoku_cloud: 0.07,
    funding_rate_arb: 0.05, mean_reversion: 0.04, breakout: 0.04,
  },
  ranging: {
    mean_reversion: 0.26, funding_rate_arb: 0.22, smart_money: 0.12,
    ichimoku_cloud: 0.10, evolved_trend: 0.07, trend_following: 0.05,
    momentum: 0.05, supertrend: 0.06, breakout: 0.07,
  },
  breakout: {
    breakout: 0.26, momentum: 0.22, evolved_trend: 0.13,
    smart_money: 0.10, trend_following: 0.09, supertrend: 0.07,
    ichimoku_cloud: 0.05, mean_reversion: 0.04, funding_rate_arb: 0.04,
  },
  high_volatility: {
    funding_rate_arb: 0.22, mean_reversion: 0.18, evolved_trend: 0.13,
    smart_money: 0.12, trend_following: 0.09, supertrend: 0.09,
    breakout: 0.07, momentum: 0.05, ichimoku_cloud: 0.05,
  },
  neutral: {
    evolved_trend: 0.17, smart_money: 0.13, funding_rate_arb: 0.13,
    trend_following: 0.13, mean_reversion: 0.10, momentum: 0.09,
    breakout: 0.09, ichimoku_cloud: 0.08, supertrend: 0.08,
  },
};

// Confidence multipliers: how much to trust a strategy's signal in each regime
// 1.0 = matching, 0.7 = neutral, 0.3 = conflicting
const REGIME_CONFIDENCE_MULTIPLIERS: Record<MarketRegime, Record<string, number>> = {
  strong_trend: {
    evolved_trend: 1.0, trend_following: 1.0, momentum: 0.9, supertrend: 0.9,
    smart_money: 0.85, ichimoku_cloud: 0.8, breakout: 0.7, funding_rate_arb: 0.7, mean_reversion: 0.5,
  },
  ranging: {
    mean_reversion: 1.0, funding_rate_arb: 1.0, smart_money: 0.8, breakout: 0.7, ichimoku_cloud: 0.7,
    evolved_trend: 0.6, trend_following: 0.5, momentum: 0.5, supertrend: 0.6,
  },
  breakout: {
    breakout: 1.0, momentum: 1.0, smart_money: 0.75, evolved_trend: 0.8, trend_following: 0.7,
    supertrend: 0.7, ichimoku_cloud: 0.6, mean_reversion: 0.5, funding_rate_arb: 0.6,
  },
  high_volatility: {
    funding_rate_arb: 0.9, smart_money: 0.85, mean_reversion: 0.8, evolved_trend: 0.7,
    supertrend: 0.7, trend_following: 0.6, breakout: 0.6, momentum: 0.5, ichimoku_cloud: 0.6,
  },
  neutral: {
    evolved_trend: 0.8, smart_money: 0.8, funding_rate_arb: 0.8, trend_following: 0.8,
    mean_reversion: 0.8, momentum: 0.8, breakout: 0.8, ichimoku_cloud: 0.8, supertrend: 0.8,
  },
};

// Hysteresis state (module-level, persists across calls within the same process)
let currentRegime: MarketRegime = "neutral";
let confirmationCount = 0;
let cooldownRemaining = 0;
let previousRegime: MarketRegime = "neutral";

export function detectTechnicalRegime(
  strategyResults: Record<string, StrategyResult>,
  atrHistory?: number[],
): RegimeResult {
  const t = REGIME_THRESHOLDS;

  // Extract indicators from strategy results
  const adxVal = strategyResults.trend_following?.indicators?.adx ?? NaN;
  const bbBandwidth = strategyResults.mean_reversion?.indicators?.bandwidth ?? NaN;
  const currentAtr = strategyResults.trend_following?.indicators?.atr ?? NaN;

  // ATR percentile: compare current ATR to historical distribution
  let atrPercentile = 0.5;
  if (atrHistory && atrHistory.length > 20 && !isNaN(currentAtr)) {
    const sorted = [...atrHistory].sort((a, b) => a - b);
    const rank = sorted.filter(v => v <= currentAtr).length;
    atrPercentile = rank / sorted.length;
  }

  // Score each regime
  const scores: Record<MarketRegime, number> = {
    strong_trend: 0,
    ranging: 0,
    breakout: 0,
    high_volatility: 0,
    neutral: 0,
  };

  // Strong Trend: high ADX, low-to-moderate BB bandwidth
  if (!isNaN(adxVal)) {
    if (adxVal >= t.adxTrend) scores.strong_trend += 0.5;
    if (adxVal >= t.adxTrend + 10) scores.strong_trend += 0.2; // Very strong
    if (adxVal < t.adxRange) scores.ranging += 0.4;
  }

  // Ranging: low ADX, narrow BB bandwidth
  if (!isNaN(bbBandwidth)) {
    if (bbBandwidth <= t.bbBandwidthRange) scores.ranging += 0.4;
    if (bbBandwidth > t.bbBandwidthRange * 2) scores.breakout += 0.2;
  }

  // High Volatility: ATR percentile above threshold
  if (atrPercentile >= 0.8) {
    scores.high_volatility += 0.4;
    if (atrPercentile >= 0.9) scores.high_volatility += 0.2;
  }

  // Breakout: moderate ADX rising + expanding bandwidth
  if (!isNaN(adxVal) && !isNaN(bbBandwidth)) {
    if (adxVal >= t.adxRange && adxVal < t.adxTrend && bbBandwidth > t.bbBandwidthRange) {
      scores.breakout += 0.4;
    }
  }

  // Find the highest-scoring regime
  let candidateRegime: MarketRegime = "neutral";
  let maxScore = 0;
  for (const [regime, score] of Object.entries(scores) as [MarketRegime, number][]) {
    if (regime === "neutral") continue;
    if (score > maxScore) {
      maxScore = score;
      candidateRegime = regime;
    }
  }

  // If no regime scores above 60% confidence, return neutral
  if (maxScore < 0.6) {
    candidateRegime = "neutral";
    maxScore = 0.5;
  }

  // Hysteresis logic
  if (cooldownRemaining > 0) {
    cooldownRemaining--;
  }

  let transitionBlend = false;

  if (candidateRegime !== currentRegime && cooldownRemaining <= 0) {
    confirmationCount++;
    if (confirmationCount >= 3) {
      // Confirmed regime change
      previousRegime = currentRegime;
      currentRegime = candidateRegime;
      confirmationCount = 0;
      cooldownRemaining = 6;
      transitionBlend = true; // First candle after change, blend 50/50
    } else {
      transitionBlend = true; // During confirmation, blend
    }
  } else if (candidateRegime === currentRegime) {
    confirmationCount = 0;
  }

  // Build output weights and multipliers
  let weights: Record<string, number>;
  let confidenceMultipliers: Record<string, number>;

  if (transitionBlend && previousRegime !== currentRegime) {
    // 50/50 blend between previous and current regime weights
    const prevW = REGIME_WEIGHTS[previousRegime];
    const currW = REGIME_WEIGHTS[currentRegime];
    const prevM = REGIME_CONFIDENCE_MULTIPLIERS[previousRegime];
    const currM = REGIME_CONFIDENCE_MULTIPLIERS[currentRegime];
    weights = {};
    confidenceMultipliers = {};
    const allKeys = new Set([...Object.keys(prevW), ...Object.keys(currW)]);
    for (const key of allKeys) {
      weights[key] = ((prevW[key] ?? 0) + (currW[key] ?? 0)) / 2;
      confidenceMultipliers[key] = ((prevM[key] ?? 0.7) + (currM[key] ?? 0.7)) / 2;
    }
  } else {
    weights = { ...REGIME_WEIGHTS[currentRegime] };
    confidenceMultipliers = { ...REGIME_CONFIDENCE_MULTIPLIERS[currentRegime] };
  }

  return {
    regime: currentRegime,
    confidence: maxScore,
    weights,
    confidenceMultipliers,
    transitionBlend,
  };
}

// Reset hysteresis state (useful for testing)
export function resetRegimeState(): void {
  currentRegime = "neutral";
  confirmationCount = 0;
  cooldownRemaining = 0;
  previousRegime = "neutral";
}
