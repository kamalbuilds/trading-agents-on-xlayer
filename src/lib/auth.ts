// Shared API authentication utility
// All API routes must use this instead of inline checkApiKey functions.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * Validates Bearer token from Authorization header using timing-safe comparison.
 * Returns true if authenticated, false otherwise.
 * In dev mode (no API_SECRET_KEY set), allows all requests.
 */
export function checkApiKey(request: NextRequest | Request): boolean {
  const apiSecret = process.env.API_SECRET_KEY;
  if (!apiSecret) return true; // Dev mode: no key configured

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;

  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(apiSecret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Returns a 401 JSON response. Use when checkApiKey returns false.
 */
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
