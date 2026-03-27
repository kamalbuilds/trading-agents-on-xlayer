import { NextRequest, NextResponse } from "next/server";
import { getPortfolioState, getCompletedTrades } from "@/lib/trading";

function checkApiKey(request: NextRequest): boolean {
  const apiSecret = process.env.API_SECRET_KEY;
  if (!apiSecret) return true; // Dev mode: allow all if env var not set

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;

  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) return false;

  return match[1] === apiSecret;
}

export async function GET(request: NextRequest) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const portfolio = await getPortfolioState();
    const recentTrades = getCompletedTrades().slice(-50);

    return NextResponse.json({
      status: "ok",
      isRunning: true,
      mode: "paper",
      portfolio,
      recentTrades,
      uptime: process.uptime(),
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
