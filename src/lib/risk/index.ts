export {
  calculatePositionSize,
  kellyFraction,
  fixedFractional,
  atrBasedSize,
  calculateATR,
  atrStopLoss,
  takeProfitFromRR,
} from "./position-sizing";

export {
  createCircuitBreakerSystem,
  recordTradeResult,
  type BreakerLevel,
  type BreakerStatus,
  type BreakerState,
  type CircuitBreakerSystem,
} from "./circuit-breakers";

export {
  createDrawdownTracker,
  updateDrawdown,
  checkDrawdownLimits,
  drawdownPositionScale,
  estimateRecoveryTime,
  type DrawdownState,
} from "./drawdown";

export {
  pearsonCorrelation,
  priceToReturns,
  buildCorrelationMatrix,
  checkCorrelationRisk,
  portfolioConcentration,
  portfolioHeat,
  directionalBias,
} from "./correlation";

export {
  createRiskEngine,
  getDefaultRiskLimits,
  type RiskEngine,
  type RiskEngineConfig,
} from "./risk-engine";

export {
  runPolicyChecks,
  type PolicyResult,
  type PolicyViolation,
} from "./policy-engine";

// Convenience function expected by the risk-manager agent
import type { TradeSignal, PortfolioState, RiskLimits } from "@/lib/types";
import { createRiskEngine as _createEngine, type RiskEngine } from "./risk-engine";

// Singleton risk engine so circuit breakers and drawdown state persist across calls
let _singletonEngine: RiskEngine | null = null;
let _singletonLimitsHash: string | null = null;

function getOrCreateEngine(limits: RiskLimits): RiskEngine {
  const hash = JSON.stringify(limits);
  if (!_singletonEngine || _singletonLimitsHash !== hash) {
    _singletonEngine = _createEngine({ limits });
    _singletonLimitsHash = hash;
  }
  return _singletonEngine;
}

export async function validateSignal(
  signal: TradeSignal,
  portfolio: PortfolioState | null,
  limits: RiskLimits
): Promise<{ withinLimits: boolean; violations: string[] }> {
  if (!portfolio) {
    return { withinLimits: true, violations: [] };
  }

  const engine = getOrCreateEngine(limits);
  const assessment = engine.assess(signal, portfolio);

  return {
    withinLimits: assessment.approved,
    violations: assessment.approved
      ? []
      : assessment.reasons.filter((r) => r !== "All risk checks passed"),
  };
}
