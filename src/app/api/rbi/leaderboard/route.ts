import { NextRequest, NextResponse } from "next/server";
import { checkApiKey, unauthorized } from "@/lib/auth";
import { loadLeaderboard } from "@/lib/rbi";

export async function GET(request: NextRequest) {
  if (!checkApiKey(request)) return unauthorized();

  const leaderboard = await loadLeaderboard();
  return NextResponse.json(leaderboard);
}
