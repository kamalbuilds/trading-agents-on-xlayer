import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import {
  analyzeTrendFollowing,
  analyzeMeanReversion,
  analyzeMomentum,
  analyzeBreakout,
  analyzeEnsemble,
} from "@/lib/strategies";
import { getOHLC } from "@/lib/kraken/market-data";
import { standardToKraken } from "@/lib/utils/pairs";
import type { OHLC } from "@/lib/types";

function checkApiKey(request: NextRequest): boolean {
  const apiSecret = process.env.API_SECRET_KEY;
  if (!apiSecret) return true; // Dev mode: allow all if env var not set

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;

  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(apiSecret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function GET(request: NextRequest) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch real OHLC data from Kraken (1h candles, ~100 candles)
    const candles = await getOHLC("XBTUSD", 60);

    if (!candles.length) {
      return NextResponse.json(
        { error: "No market data available from Kraken" },
        { status: 503 }
      );
    }

    const ensemble = analyzeEnsemble({ candles });

    return NextResponse.json({
      status: "active",
      mode: "live_data",
      dataSource: "kraken",
      candleCount: candles.length,
      ensemble: {
        consensus: ensemble.consensus,
        consensusStrength: ensemble.consensusStrength,
        signals: ensemble.aggregatedSignals,
        analysis: ensemble.analysis,
      },
      strategies: Object.fromEntries(
        Object.entries(ensemble.strategyResults).map(([name, result]) => [
          name,
          {
            analysis: result.analysis,
            signalCount: result.signals.length,
            indicators: result.indicators,
          },
        ])
      ),
      timestamp: Date.now(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Strategy analysis failed";
    return NextResponse.json(
      { error: msg, detail: "Kraken MCP connection may not be available" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { strategy, candles: rawCandles, pair, interval } = body as {
    strategy?: string;
    candles?: OHLC[];
    pair?: string;
    interval?: number;
  };

  try {
    // Use provided candles or fetch real ones from Kraken
    let candles: OHLC[];
    if (rawCandles && rawCandles.length > 0) {
      candles = rawCandles;
    } else {
      const krakenPair = standardToKraken(pair ?? "BTC/USD");
      candles = await getOHLC(krakenPair, interval ?? 60);

      if (!candles.length) {
        return NextResponse.json(
          { error: `No OHLC data from Kraken for ${krakenPair}` },
          { status: 503 }
        );
      }
    }

    const cfg = { pair: pair ?? "BTC/USD" };

    let result;
    switch (strategy) {
      case "trend_following":
        result = analyzeTrendFollowing(candles, cfg);
        break;
      case "mean_reversion":
        result = analyzeMeanReversion(candles, cfg);
        break;
      case "momentum":
        result = analyzeMomentum(candles, cfg);
        break;
      case "breakout":
        result = analyzeBreakout(candles, cfg);
        break;
      case "ensemble":
      default:
        result = analyzeEnsemble({ candles }, cfg);
        break;
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Strategy analysis failed";
    return NextResponse.json(
      { error: msg, detail: "Check Kraken MCP connection" },
      { status: 500 }
    );
  }
}
