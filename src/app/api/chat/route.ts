import { UIMessage } from "ai";
import { timingSafeEqual } from "crypto";
import { runOrchestrator } from "@/lib/agents/orchestrator";

export const maxDuration = 60;

function checkApiKey(req: Request): boolean {
  const apiSecret = process.env.API_SECRET_KEY;
  if (!apiSecret) return true; // Dev mode: allow all if env var not set

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;

  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(apiSecret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function POST(req: Request) {
  if (!checkApiKey(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = await runOrchestrator(messages);

  return result.toUIMessageStreamResponse();
}
