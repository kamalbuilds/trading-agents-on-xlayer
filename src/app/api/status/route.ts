import { NextRequest, NextResponse } from "next/server";
import { checkApiKey, unauthorized } from "@/lib/auth";
import { getCompletedTrades } from "@/lib/trading";
import { getRunning, getStartTime, getLastCycleResult } from "@/lib/market/engine";

export async function GET(request: NextRequest) {
  if (!checkApiKey(request)) return unauthorized();

  try {
    const running = getRunning();
    const lastCycle = getLastCycleResult();
    const portfolio = lastCycle?.portfolio ?? null;
    const recentTrades = lastCycle?.recentTrades ?? getCompletedTrades().slice(-50);

    return NextResponse.json({
      status: "ok",
      isRunning: running,
      mode: "paper",
      portfolio,
      recentTrades,
      uptime: running ? Math.floor((Date.now() - getStartTime()) / 1000) : 0,
      timestamp: Date.now(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get system status";
    return NextResponse.json({
      status: "error",
      isRunning: false,
      mode: "paper",
      error: msg,
      uptime: process.uptime(),
      timestamp: Date.now(),
    }, { status: 500 });
  }
}
