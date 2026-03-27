import { NextRequest, NextResponse } from "next/server";
import { createRiskEngine, getDefaultRiskLimits } from "@/lib/risk";
import type {
  TradeSignal,
  PortfolioState,
  RiskAssessment,
  TradingEvent,
} from "@/lib/types";

// Singleton risk engine instance
let riskEngine: ReturnType<typeof createRiskEngine> | null = null;

function getRiskEngine() {
  if (!riskEngine) {
    riskEngine = createRiskEngine({ limits: getDefaultRiskLimits() });
  }
  return riskEngine;
}

function checkApiKey(request: NextRequest): boolean {
  const apiSecret = process.env.API_SECRET_KEY;
  if (!apiSecret) return true; // Dev mode: allow all if env var not set

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;

  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) return false;

  return match[1] === apiSecret;
}

// POST /api/trade - Submit a trade signal for risk assessment and execution
export async function POST(request: NextRequest) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { signal, portfolio } = body as {
      signal: TradeSignal;
      portfolio: PortfolioState;
    };

    if (!signal || !portfolio) {
      return NextResponse.json(
        { error: "Missing signal or portfolio data" },
        { status: 400 }
      );
    }

    // Validate signal fields
    if (!signal.pair || !signal.side || signal.amount <= 0) {
      return NextResponse.json(
        { error: "Invalid trade signal: pair, side, and positive amount required" },
        { status: 400 }
      );
    }

    if (signal.confidence < 0 || signal.confidence > 1) {
      return NextResponse.json(
        { error: "Confidence must be between 0 and 1" },
        { status: 400 }
      );
    }

    const engine = getRiskEngine();
    const assessment: RiskAssessment = engine.assess(signal, portfolio);

    // Create trading event
    const event: TradingEvent = {
      type: assessment.approved ? "trade_signal" : "risk_alert",
      data: {
        signal,
        assessment,
        action: assessment.approved ? "approved" : "blocked",
      },
      timestamp: Date.now(),
      source: "risk_engine",
    };

    return NextResponse.json({
      assessment,
      event,
      meta: {
        drawdown: engine.getDrawdownState(),
        activeBreakers: engine.getCircuitBreakers().getActiveBreakers(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Risk assessment failed: ${message}` },
      { status: 500 }
    );
  }
}

// GET /api/trade - Get current risk engine state
export async function GET(request: NextRequest) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const engine = getRiskEngine();

  return NextResponse.json({
    drawdown: engine.getDrawdownState(),
    activeBreakers: engine.getCircuitBreakers().getActiveBreakers(),
    limits: getDefaultRiskLimits(),
  });
}

// PATCH /api/trade - Record trade results for circuit breaker tracking
export async function PATCH(request: NextRequest) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { strategy, isWin, equity } = body as {
      strategy: string;
      isWin: boolean;
      equity?: number;
    };

    if (!strategy || typeof isWin !== "boolean") {
      return NextResponse.json(
        { error: "strategy (string) and isWin (boolean) required" },
        { status: 400 }
      );
    }

    const engine = getRiskEngine();
    engine.recordTrade(strategy, isWin);

    if (typeof equity === "number" && equity > 0) {
      engine.updateEquity(equity);
    }

    return NextResponse.json({
      recorded: true,
      drawdown: engine.getDrawdownState(),
      activeBreakers: engine.getCircuitBreakers().getActiveBreakers(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to record trade: ${message}` },
      { status: 500 }
    );
  }
}
