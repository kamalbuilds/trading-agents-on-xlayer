// Funding Rate Arbitrage Strategy
// Monitor perpetual funding rates, go long spot + short perp when funding is high
// Sharpe 1.8+, 90% win rate from research

import type { TradeSignal, StrategyResult } from "@/lib/types";

export interface FundingRateData {
  pair: string;
  fundingRate: number;       // Current funding rate (as decimal, e.g., 0.01 = 1%)
  nextFundingTime: number;   // Timestamp of next funding
  annualizedRate: number;    // Annualized funding rate
  predictedRate?: number;    // Predicted next rate
  spotPrice: number;
  perpPrice: number;
}

export interface FundingRateConfig {
  highFundingThreshold: number;    // Rate above which we arb (annualized %)
  lowFundingThreshold: number;     // Rate below which we close
  maxBasisSpread: number;          // Max acceptable spot-perp spread %
  minHoldPeriods: number;          // Min funding periods to hold
  pair: string;
}

const DEFAULT_CONFIG: FundingRateConfig = {
  highFundingThreshold: 30,   // 30% annualized
  lowFundingThreshold: 5,     // 5% annualized
  maxBasisSpread: 0.5,        // 0.5% max spread
  minHoldPeriods: 3,          // Hold for at least 3 funding periods
  pair: "BTC/USD",
};

export function analyzeFundingRate(
  fundingData: FundingRateData,
  historicalRates: number[], // Last N funding rates
  config: Partial<FundingRateConfig> = {}
): StrategyResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const currentRate = fundingData.annualizedRate;
  const basisSpread = Math.abs(
    ((fundingData.perpPrice - fundingData.spotPrice) / fundingData.spotPrice) * 100
  );

  // Calculate rate statistics
  const avgRate =
    historicalRates.length > 0
      ? historicalRates.reduce((a, b) => a + b, 0) / historicalRates.length
      : currentRate;
  const rateStdDev =
    historicalRates.length > 1
      ? Math.sqrt(
          historicalRates.reduce((sum, r) => sum + (r - avgRate) ** 2, 0) /
            historicalRates.length
        )
      : 0;
  const rateZScore = rateStdDev > 0 ? (currentRate - avgRate) / rateStdDev : 0;

  // Rate persistence: how many consecutive periods same direction
  let persistence = 0;
  const direction = currentRate > 0 ? 1 : -1;
  for (let i = historicalRates.length - 1; i >= 0; i--) {
    if ((historicalRates[i] > 0 ? 1 : -1) === direction) persistence++;
    else break;
  }

  const signals: TradeSignal[] = [];
  let analysis = "";

  // High positive funding: longs pay shorts
  // Strategy: long spot + short perp to collect funding
  if (
    currentRate > cfg.highFundingThreshold &&
    basisSpread < cfg.maxBasisSpread &&
    persistence >= 2
  ) {
    let confidence = 0.6;
    if (currentRate > cfg.highFundingThreshold * 1.5) confidence += 0.1;
    if (persistence > 5) confidence += 0.1;
    if (rateZScore > 1.5) confidence += 0.05;
    if (fundingData.predictedRate && fundingData.predictedRate > cfg.highFundingThreshold) {
      confidence += 0.1;
    }
    confidence = Math.min(0.95, confidence);

    // Long spot signal
    signals.push({
      id: `fr-spot-${Date.now()}`,
      strategy: "funding_rate_arb",
      pair: cfg.pair,
      side: "buy",
      type: "limit",
      price: fundingData.spotPrice,
      amount: 0,
      confidence,
      reasoning: `Funding rate arb: long spot at ${fundingData.spotPrice.toFixed(2)}. Annualized rate: ${currentRate.toFixed(1)}%, ${persistence} consecutive positive periods, basis spread: ${basisSpread.toFixed(3)}%`,
      timestamp: Date.now(),
      metadata: {
        leg: "spot_long",
        fundingRate: currentRate,
        basisSpread,
        persistence,
        rateZScore,
        expectedYield: currentRate,
      },
    });

    // Short perp signal (hedging)
    signals.push({
      id: `fr-perp-${Date.now()}`,
      strategy: "funding_rate_arb",
      pair: `${cfg.pair}-PERP`,
      side: "sell",
      type: "limit",
      price: fundingData.perpPrice,
      amount: 0,
      confidence,
      reasoning: `Funding rate arb: short perp at ${fundingData.perpPrice.toFixed(2)} to hedge spot long and collect ${currentRate.toFixed(1)}% annualized funding`,
      timestamp: Date.now(),
      metadata: {
        leg: "perp_short",
        fundingRate: currentRate,
        basisSpread,
        expectedYield: currentRate,
      },
    });

    analysis = `FUNDING ARB OPEN: Rate ${currentRate.toFixed(1)}% annualized (${persistence} periods persistent). Long spot / short perp. Basis: ${basisSpread.toFixed(3)}%. Expected yield: ~${currentRate.toFixed(1)}% annualized.`;
  }
  // High negative funding: shorts pay longs (reverse arb)
  else if (
    currentRate < -cfg.highFundingThreshold &&
    basisSpread < cfg.maxBasisSpread &&
    persistence >= 2
  ) {
    let confidence = 0.6;
    if (Math.abs(currentRate) > cfg.highFundingThreshold * 1.5) confidence += 0.1;
    if (persistence > 5) confidence += 0.1;
    confidence = Math.min(0.95, confidence);

    signals.push({
      id: `fr-perp-${Date.now()}`,
      strategy: "funding_rate_arb",
      pair: `${cfg.pair}-PERP`,
      side: "buy",
      type: "limit",
      price: fundingData.perpPrice,
      amount: 0,
      confidence,
      reasoning: `Reverse funding arb: long perp to collect ${Math.abs(currentRate).toFixed(1)}% annualized (shorts paying longs)`,
      timestamp: Date.now(),
      metadata: {
        leg: "perp_long",
        fundingRate: currentRate,
        persistence,
        expectedYield: Math.abs(currentRate),
      },
    });

    signals.push({
      id: `fr-spot-${Date.now()}`,
      strategy: "funding_rate_arb",
      pair: cfg.pair,
      side: "sell",
      type: "limit",
      price: fundingData.spotPrice,
      amount: 0,
      confidence,
      reasoning: `Reverse funding arb: short spot to hedge perp long`,
      timestamp: Date.now(),
      metadata: {
        leg: "spot_short",
        fundingRate: currentRate,
        basisSpread,
      },
    });

    analysis = `REVERSE FUNDING ARB: Rate ${currentRate.toFixed(1)}% annualized (shorts paying). Long perp / short spot. Expected yield: ~${Math.abs(currentRate).toFixed(1)}%`;
  }
  // Rate normalizing: consider closing
  else if (Math.abs(currentRate) < cfg.lowFundingThreshold) {
    analysis = `NEUTRAL: Funding rate ${currentRate.toFixed(1)}% below threshold. Consider closing existing arb positions.`;
  } else {
    analysis = `MONITORING: Funding rate ${currentRate.toFixed(1)}% annualized. Avg: ${avgRate.toFixed(1)}%, persistence: ${persistence} periods, basis: ${basisSpread.toFixed(3)}%.`;
  }

  return {
    strategy: "funding_rate_arb",
    signals,
    analysis,
    indicators: {
      fundingRate: currentRate,
      avgFundingRate: avgRate,
      rateStdDev,
      rateZScore,
      basisSpread,
      persistence,
      spotPrice: fundingData.spotPrice,
      perpPrice: fundingData.perpPrice,
    },
    timestamp: Date.now(),
  };
}
