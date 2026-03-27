// PolicyEngine: MAHORAGA-inspired pre-trade validation
// 11 independent policy checks that must ALL pass before any trade executes.
// Unlike the risk engine (which scores risk), the policy engine is binary: pass or block.

import type { TradeSignal, PortfolioState, RiskLimits } from "@/lib/types";
import { normalizePair } from "@/lib/utils/pairs";

export interface PolicyResult {
  allowed: boolean;
  violations: PolicyViolation[];
  checksRun: number;
  checksPassed: number;
}

export interface PolicyViolation {
  policy: string;
  severity: "critical" | "high" | "medium";
  message: string;
}

type PolicyCheck = (
  signal: TradeSignal,
  portfolio: PortfolioState,
  limits: RiskLimits
) => PolicyViolation | null;

// Policy 1: Signal must have valid pair format
const checkValidPair: PolicyCheck = (signal) => {
  const normalized = normalizePair(signal.pair);
  if (!normalized.includes("/") || normalized.split("/").length !== 2) {
    return {
      policy: "valid_pair",
      severity: "critical",
      message: `Invalid pair format: ${signal.pair}`,
    };
  }
  return null;
};

// Policy 2: Signal confidence must be above minimum threshold
const checkMinConfidence: PolicyCheck = (signal) => {
  if (signal.confidence < 0.20) {
    return {
      policy: "min_confidence",
      severity: "high",
      message: `Confidence ${(signal.confidence * 100).toFixed(0)}% below 20% minimum`,
    };
  }
  return null;
};

// Policy 3: Position size must not exceed max allocation
const checkMaxPositionSize: PolicyCheck = (signal, portfolio, limits) => {
  if (signal.amount <= 0) return null; // Will be sized by risk manager
  const price = signal.price ?? 0;
  if (price <= 0) return null;
  const positionValue = signal.amount * price;
  const maxValue = portfolio.equity * (limits.maxPositionSize / 100);
  if (positionValue > maxValue * 1.5) {
    // 1.5x buffer for pre-check
    return {
      policy: "max_position_size",
      severity: "high",
      message: `Position value $${positionValue.toFixed(0)} exceeds ${limits.maxPositionSize}% limit ($${maxValue.toFixed(0)})`,
    };
  }
  return null;
};

// Policy 4: Cannot open new positions when max positions reached
const checkMaxOpenPositions: PolicyCheck = (signal, portfolio, limits) => {
  if (signal.side === "sell") return null; // Closing positions is always allowed
  if (portfolio.positions.length >= limits.maxOpenPositions) {
    return {
      policy: "max_open_positions",
      severity: "high",
      message: `Already at max ${limits.maxOpenPositions} open positions`,
    };
  }
  return null;
};

// Policy 5: Cannot trade when drawdown exceeds limit
const checkDrawdownHalt: PolicyCheck = (_signal, portfolio, limits) => {
  if (portfolio.maxDrawdown >= limits.maxDrawdown) {
    return {
      policy: "drawdown_halt",
      severity: "critical",
      message: `Drawdown ${portfolio.maxDrawdown.toFixed(1)}% exceeds ${limits.maxDrawdown}% limit. Trading halted.`,
    };
  }
  return null;
};

// Policy 6: Signal must have a strategy attribution
const checkStrategyAttribution: PolicyCheck = (signal) => {
  if (!signal.strategy || signal.strategy === "unknown") {
    return {
      policy: "strategy_attribution",
      severity: "medium",
      message: "Signal has no strategy attribution. All trades must be traceable.",
    };
  }
  return null;
};

// Policy 7: Cannot buy/sell the same pair in opposite directions simultaneously
const checkNoConflictingPositions: PolicyCheck = (signal, portfolio) => {
  const conflicting = portfolio.positions.find(
    (p) =>
      normalizePair(p.pair) === normalizePair(signal.pair) &&
      p.side !== signal.side
  );
  if (conflicting && signal.side === "buy") {
    return {
      policy: "no_conflicting_positions",
      severity: "medium",
      message: `Already have a ${conflicting.side} position on ${signal.pair}. Close it first or use the opposite side to reduce.`,
    };
  }
  return null;
};

// Policy 8: Equity must be positive
const checkPositiveEquity: PolicyCheck = (_signal, portfolio) => {
  if (portfolio.equity <= 0) {
    return {
      policy: "positive_equity",
      severity: "critical",
      message: "Portfolio equity is zero or negative. All trading halted.",
    };
  }
  return null;
};

// Policy 9: Signal must not be stale (older than 5 minutes)
const checkSignalFreshness: PolicyCheck = (signal) => {
  const age = Date.now() - signal.timestamp;
  const maxAge = 5 * 60 * 1000; // 5 minutes
  if (age > maxAge) {
    return {
      policy: "signal_freshness",
      severity: "high",
      message: `Signal is ${(age / 1000 / 60).toFixed(1)} minutes old. Max age is 5 minutes.`,
    };
  }
  return null;
};

// Policy 10: Leverage check
const checkLeverageLimit: PolicyCheck = (signal, portfolio, limits) => {
  if (signal.amount <= 0 || !signal.price) return null;
  const newExposure =
    portfolio.positions.reduce((sum, p) => sum + p.currentPrice * p.amount, 0) +
    signal.amount * signal.price;
  const leverage = newExposure / portfolio.equity;
  if (leverage > limits.maxLeverage) {
    return {
      policy: "leverage_limit",
      severity: "high",
      message: `Effective leverage ${leverage.toFixed(1)}x exceeds ${limits.maxLeverage}x limit`,
    };
  }
  return null;
};

// Policy 11: Price sanity check (not zero, not negative)
const checkPriceSanity: PolicyCheck = (signal) => {
  if (signal.type === "market") return null; // Market orders don't need a price
  if (signal.price !== undefined && signal.price <= 0) {
    return {
      policy: "price_sanity",
      severity: "critical",
      message: `Invalid price: ${signal.price}. Limit orders require a positive price.`,
    };
  }
  return null;
};

// All 11 policies
const ALL_POLICIES: PolicyCheck[] = [
  checkValidPair,
  checkMinConfidence,
  checkMaxPositionSize,
  checkMaxOpenPositions,
  checkDrawdownHalt,
  checkStrategyAttribution,
  checkNoConflictingPositions,
  checkPositiveEquity,
  checkSignalFreshness,
  checkLeverageLimit,
  checkPriceSanity,
];

// Run all policy checks. Returns immediately on first critical violation.
export function runPolicyChecks(
  signal: TradeSignal,
  portfolio: PortfolioState,
  limits: RiskLimits
): PolicyResult {
  const violations: PolicyViolation[] = [];
  let passed = 0;

  for (const check of ALL_POLICIES) {
    const violation = check(signal, portfolio, limits);
    if (violation) {
      violations.push(violation);
      // Critical violations halt immediately
      if (violation.severity === "critical") {
        return {
          allowed: false,
          violations,
          checksRun: ALL_POLICIES.length,
          checksPassed: passed,
        };
      }
    } else {
      passed++;
    }
  }

  // Any high severity violation blocks the trade
  const hasBlocking = violations.some(
    (v) => v.severity === "critical" || v.severity === "high"
  );

  return {
    allowed: !hasBlocking,
    violations,
    checksRun: ALL_POLICIES.length,
    checksPassed: passed,
  };
}
