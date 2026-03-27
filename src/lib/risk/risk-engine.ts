import type {
  TradeSignal,
  PortfolioState,
  RiskLimits,
  RiskAssessment,
  OHLC,
} from "@/lib/types";
import { calculatePositionSize } from "./position-sizing";
import {
  createCircuitBreakerSystem,
  recordTradeResult,
  type CircuitBreakerSystem,
} from "./circuit-breakers";
import {
  createDrawdownTracker,
  updateDrawdown,
  checkDrawdownLimits,
  drawdownPositionScale,
  type DrawdownState,
} from "./drawdown";
import {
  checkCorrelationRisk,
  portfolioConcentration,
  portfolioHeat,
  directionalBias,
} from "./correlation";
import { runPolicyChecks } from "./policy-engine";

export interface RiskEngineConfig {
  limits: RiskLimits;
  correlationMatrix?: Map<string, number>;
}

export interface RiskEngine {
  assess(signal: TradeSignal, portfolio: PortfolioState, candles?: OHLC[]): RiskAssessment;
  updateEquity(newEquity: number): void;
  updateCorrelationMatrix(matrix: Map<string, number>): void;
  getDrawdownState(): DrawdownState;
  getCircuitBreakers(): CircuitBreakerSystem;
  recordTrade(strategy: string, isWin: boolean): void;
}

export function createRiskEngine(config: RiskEngineConfig): RiskEngine {
  const { limits } = config;
  let correlationMatrix = config.correlationMatrix ?? new Map<string, number>();
  const circuitBreakers = createCircuitBreakerSystem();
  let drawdownState = createDrawdownTracker(0);
  let initialized = false;

  function assess(
    signal: TradeSignal,
    portfolio: PortfolioState,
    candles?: OHLC[]
  ): RiskAssessment {
    // Initialize drawdown tracker on first call
    if (!initialized) {
      drawdownState = createDrawdownTracker(portfolio.equity);
      initialized = true;
    }

    const reasons: string[] = [];
    let riskScore = 0; // 0 = no risk, 100 = maximum risk (additive, capped at 100)
    let approved = true;

    // === Pre-Check: PolicyEngine (11 binary pass/fail checks) ===
    const policyResult = runPolicyChecks(signal, portfolio, limits);
    if (!policyResult.allowed) {
      for (const v of policyResult.violations) {
        reasons.push(`[POLICY:${v.policy}] ${v.message}`);
      }
      return {
        approved: false,
        reasons,
        riskScore: 100,
        positionSizeRecommended: 0,
        stopLoss: 0,
        takeProfit: 0,
      };
    }
    // Add policy warnings (medium severity) as info
    for (const v of policyResult.violations) {
      reasons.push(`[POLICY:${v.policy}] ${v.message}`);
      riskScore += 5;
    }

    // === Check 1: Circuit breakers ===
    const portfolioBreaker = circuitBreakers.check("portfolio", "global", portfolio, limits);
    if (portfolioBreaker.status === "tripped") {
      reasons.push(`Portfolio circuit breaker tripped: ${portfolioBreaker.reason}`);
      approved = false;
      riskScore += 40;
    }

    const strategyBreaker = circuitBreakers.check(
      "strategy",
      signal.strategy,
      portfolio,
      limits
    );
    if (strategyBreaker.status === "tripped") {
      reasons.push(`Strategy ${signal.strategy} circuit breaker tripped: ${strategyBreaker.reason}`);
      approved = false;
      riskScore += 30;
    }

    const tradeBreaker = circuitBreakers.check(
      "trade",
      signal.strategy,
      portfolio,
      limits
    );
    if (tradeBreaker.status === "tripped") {
      reasons.push(`Trade circuit breaker for ${signal.strategy}: ${tradeBreaker.reason}`);
      approved = false;
      riskScore += 25;
    }

    // === Check 2: Drawdown limits ===
    drawdownState = updateDrawdown(drawdownState, portfolio.equity);
    const drawdownCheck = checkDrawdownLimits(
      drawdownState,
      limits.maxDrawdown,
      limits.maxDailyLoss
    );
    if (drawdownCheck.breached) {
      reasons.push(...drawdownCheck.reasons);
      approved = false;
      riskScore += 35;
    }

    // === Check 3: Max open positions ===
    if (portfolio.positions.length >= limits.maxOpenPositions) {
      reasons.push(
        `Max open positions reached: ${portfolio.positions.length}/${limits.maxOpenPositions}`
      );
      approved = false;
      riskScore += 20;
    }

    // === Check 4: Correlation check ===
    const corrCheck = checkCorrelationRisk(
      signal.pair,
      portfolio.positions,
      correlationMatrix,
      limits.maxCorrelation
    );
    if (!corrCheck.allowed) {
      const pairs = corrCheck.highCorrelations
        .map((c) => `${c.pair} (${c.correlation.toFixed(2)})`)
        .join(", ");
      reasons.push(`High correlation with existing positions: ${pairs}`);
      riskScore += 15;
      approved = false; // Correlation risk now blocks trades
    }

    // === Check 5: Portfolio concentration ===
    const concentration = portfolioConcentration(portfolio.positions);
    if (concentration > 0.5) {
      reasons.push(
        `Portfolio over-concentrated (HHI: ${concentration.toFixed(2)})`
      );
      riskScore += 10;
    }

    // === Check 6: Portfolio heat ===
    const heat = portfolioHeat(portfolio.positions, portfolio.equity);
    if (heat > 100) {
      reasons.push(`Portfolio heat ${heat.toFixed(1)}% exceeds 100%`);
      riskScore += 20;
      if (heat > 150) {
        approved = false;
      }
    }

    // === Check 7: Directional bias ===
    const bias = directionalBias(portfolio.positions);
    if (bias.bias !== "neutral") {
      const sameDirection =
        (bias.bias === "long" && signal.side === "buy") ||
        (bias.bias === "short" && signal.side === "sell");
      if (sameDirection) {
        reasons.push(
          `Adding to ${bias.bias} bias (net exposure: $${bias.netExposure.toFixed(2)})`
        );
        riskScore += 10;
      }
    }

    // === Check 8: Signal confidence threshold ===
    if (signal.confidence < 0.3) {
      reasons.push(`Low confidence signal: ${(signal.confidence * 100).toFixed(0)}%`);
      approved = false;
      riskScore += 15;
    }

    // Cap risk score at 100
    riskScore = Math.min(100, riskScore);

    // === Position sizing ===
    const sizing = calculatePositionSize(signal, portfolio, limits, candles);

    // Apply drawdown scaling
    const ddScale = drawdownPositionScale(
      drawdownState.currentDrawdown,
      limits.maxDrawdown
    );
    const adjustedSize = sizing.size * ddScale;

    if (adjustedSize <= 0 && approved) {
      reasons.push("Position size too small after risk adjustments");
      approved = false;
    }

    if (ddScale < 1) {
      reasons.push(
        `Position reduced ${((1 - ddScale) * 100).toFixed(0)}% due to ${drawdownState.currentDrawdown.toFixed(2)}% drawdown`
      );
    }

    // Build adjusted signal
    const adjustedSignal: TradeSignal = {
      ...signal,
      amount: adjustedSize,
      metadata: {
        ...signal.metadata,
        riskMethod: sizing.method,
        drawdownScale: ddScale,
        originalSize: signal.amount,
        riskScore,
      },
    };

    if (reasons.length === 0) {
      reasons.push("All risk checks passed");
    }

    return {
      approved,
      adjustedSignal: approved ? adjustedSignal : undefined,
      reasons,
      riskScore,
      positionSizeRecommended: adjustedSize,
      stopLoss: sizing.stopLoss,
      takeProfit: sizing.takeProfit,
    };
  }

  function updateEquity(newEquity: number): void {
    drawdownState = updateDrawdown(drawdownState, newEquity);
  }

  function recordTrade(strategy: string, isWin: boolean): void {
    recordTradeResult(circuitBreakers, strategy, isWin);
  }

  function updateCorrelationMatrix(matrix: Map<string, number>): void {
    correlationMatrix = matrix;
  }

  return {
    assess,
    updateEquity,
    updateCorrelationMatrix,
    getDrawdownState: () => ({ ...drawdownState }),
    getCircuitBreakers: () => circuitBreakers,
    recordTrade,
  };
}

import { getRiskLimits as _getConfigLimits } from "@/lib/config";

// Default risk limits from central config (env vars with NaN protection)
export function getDefaultRiskLimits(): RiskLimits {
  return _getConfigLimits();
}
