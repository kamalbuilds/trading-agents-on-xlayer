import { UIMessage } from "ai";
import { checkApiKey } from "@/lib/auth";
import { runOrchestrator } from "@/lib/agents/orchestrator";

export const maxDuration = 60;

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
