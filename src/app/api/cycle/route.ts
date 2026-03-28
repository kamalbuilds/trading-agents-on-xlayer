import { NextRequest, NextResponse } from "next/server";
import { checkApiKey, unauthorized } from "@/lib/auth";
import { runTradingCycle, setRunning, getRunning, resetEngine, getStartTime, getLastCycleResult } from "@/lib/market/engine";

export async function POST(request: NextRequest) {
  if (!checkApiKey(request)) return unauthorized();

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action as string | undefined;

    if (action === "start") {
      if (!getRunning()) {
        setRunning(true); // This starts the engine loop in the background
      }
      // Return immediately. The engine loop runs in the background.
      const last = getLastCycleResult();
      return NextResponse.json({
        isRunning: true,
        mode: "paper",
        message: "Engine started",
        portfolio: last?.portfolio ?? null,
        recentTrades: last?.recentTrades ?? [],
        agentMessages: last?.agentMessages ?? [],
        errors: [],
      });
    }

    if (action === "stop") {
      setRunning(false);
      return NextResponse.json({ isRunning: false, message: "Stopped" });
    }

    if (action === "reset") {
      resetEngine();
      return NextResponse.json({ isRunning: false, message: "Reset" });
    }

    // No action specified: return last cycle result
    const last = getLastCycleResult();
    return NextResponse.json({
      isRunning: getRunning(),
      mode: "paper",
      portfolio: last?.portfolio ?? null,
      recentTrades: last?.recentTrades ?? [],
      agentMessages: last?.agentMessages ?? [],
      errors: last?.errors ?? [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, isRunning: getRunning() }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!checkApiKey(request)) return unauthorized();

  const running = getRunning();
  const last = getLastCycleResult();

  if (!running && !last) {
    return NextResponse.json({ isRunning: false });
  }

  // Return the last cycle result instead of running a new cycle per request
  return NextResponse.json({
    isRunning: running,
    mode: "paper",
    portfolio: last?.portfolio ?? null,
    recentTrades: last?.recentTrades ?? [],
    agentMessages: last?.agentMessages ?? [],
    errors: last?.errors ?? [],
    strategyBreakdown: last?.strategyBreakdown ?? {},
  });
}
