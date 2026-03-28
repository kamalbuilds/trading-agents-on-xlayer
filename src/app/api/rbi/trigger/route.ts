import { NextRequest, NextResponse } from "next/server";
import { checkApiKey, unauthorized } from "@/lib/auth";
import { runRBICycle } from "@/lib/rbi";
import { fetchHistoricalOHLC } from "@/lib/market/historical-ohlc";
import { fetchOHLCHistory } from "@/lib/market/prices";

export async function POST(request: NextRequest) {
  if (!checkApiKey(request)) return unauthorized();

  try {
    let candles;
    try {
      candles = await fetchHistoricalOHLC("BTC/USD", 6, 240);
    } catch (err) {
      console.warn("[rbi/trigger] Kraken OHLC failed, falling back to CoinGecko:", err);
      candles = await fetchOHLCHistory("bitcoin", 90);
    }

    if (candles.length < 50) {
      return NextResponse.json(
        { error: "Insufficient historical data", candles: candles.length },
        { status: 400 }
      );
    }

    const result = await runRBICycle(candles, {
      populationSize: 6,
      generationsPerCycle: 5,
    });

    return NextResponse.json({
      success: true,
      cycle: result.cycleNumber,
      duration: `${((result.completedAt - result.startedAt) / 1000).toFixed(1)}s`,
      backtested: result.backtested,
      evolved: result.evolved,
      bestFitness: result.bestFitness,
      bestStrategy: result.bestStrategy,
      generations: result.generationResults.map((g) => ({
        generation: g.generation,
        bestFitness: g.bestFitness,
        avgFitness: g.avgFitness,
        improvements: g.improvements,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
