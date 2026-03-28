import { NextRequest, NextResponse } from "next/server";
import { checkApiKey, unauthorized } from "@/lib/auth";
import { getRBIStatus, loadLeaderboard } from "@/lib/rbi";

export async function GET(request: NextRequest) {
  if (!checkApiKey(request)) return unauthorized();

  const status = getRBIStatus();
  const leaderboard = await loadLeaderboard();

  return NextResponse.json({
    ...status,
    leaderboard: {
      totalStrategies: leaderboard.strategies.length,
      totalBacktested: leaderboard.totalBacktested,
      generationsRun: leaderboard.generationsRun,
      bestFitnessEver: leaderboard.bestFitnessEver,
      topStrategies: leaderboard.strategies.slice(0, 10).map((s) => ({
        name: s.name,
        tier: s.tier,
        fitness: s.fitnessScore,
        sharpe: s.sharpeRatio,
        winRate: s.winRate,
        maxDD: s.maxDrawdown,
        source: s.source,
        generation: s.generation,
      })),
    },
  });
}
