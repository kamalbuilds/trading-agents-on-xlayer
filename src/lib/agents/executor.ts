import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { EXECUTOR_PROMPT } from "./prompts";
import type { TradeSignal, RiskAssessment, Order } from "@/lib/types";

export interface ExecutionResult {
  signalId: string;
  order: Order | null;
  status: "executed" | "failed" | "skipped";
  message: string;
  slippage?: number;
}

// Direct import for trading engine
import { placeOrder as tradingPlaceOrder, placeStopLoss as tradingPlaceStopLoss } from "@/lib/trading";

async function placeOrder(
  pair: string,
  side: "buy" | "sell",
  type: string,
  amount: number,
  price?: number
): Promise<Order | null> {
  const order = await tradingPlaceOrder(pair, side, type, amount, price);
  if (!order) {
    throw new Error(`Order placement failed for ${side} ${amount} ${pair}. Trading engine returned null.`);
  }
  return order;
}

async function placeStopLoss(pair: string, side: "buy" | "sell", amount: number, stopPrice: number): Promise<Order | null> {
  return tradingPlaceStopLoss(pair, side, amount, stopPrice);
}

export async function runExecutor(
  signals: TradeSignal[],
  assessments: RiskAssessment[]
): Promise<ExecutionResult[]> {
  const approvedPairs = signals
    .map((signal, i) => ({ signal, assessment: assessments[i] }))
    .filter((p) => p.assessment?.approved);

  if (!approvedPairs.length) {
    return signals.map((s) => ({
      signalId: s.id,
      order: null,
      status: "skipped" as const,
      message: "Signal was not approved by Risk Manager",
    }));
  }

  const { text } = await generateText({
    model: "anthropic/claude-sonnet-4.6",
    system: EXECUTOR_PROMPT,
    tools: {
      executeOrder: tool({
        description: "Place an order on the exchange",
        inputSchema: z.object({
          pair: z.string(),
          side: z.enum(["buy", "sell"]),
          orderType: z.enum(["market", "limit", "stop-loss", "take-profit"]),
          amount: z.number(),
          price: z.number().optional(),
        }),
        execute: async ({ pair, side, orderType, amount, price }) => {
          const order = await placeOrder(pair, side, orderType, amount, price);
          return order ?? { error: "Order placement failed" };
        },
      }),
      setProtection: tool({
        description: "Set stop-loss protection order for an open position",
        inputSchema: z.object({
          pair: z.string(),
          side: z.enum(["buy", "sell"]),
          amount: z.number(),
          stopPrice: z.number(),
        }),
        execute: async ({ pair, side, amount, stopPrice }) => {
          const closeSide = side === "buy" ? "sell" : "buy";
          const order = await placeStopLoss(pair, closeSide as "buy" | "sell", amount, stopPrice);
          return order ?? { error: "Stop-loss placement failed at " + stopPrice };
        },
      }),
    },
    stopWhen: stepCountIs(6),
    prompt: `Execute the following approved trade signals.

## Approved Signals
${approvedPairs.map(({ signal, assessment }, i) => `
Trade ${i + 1}: ${signal.side.toUpperCase()} ${signal.pair}
  Type: ${signal.type}
  Amount: ${assessment.positionSizeRecommended || signal.amount}
  Price: ${signal.price ?? "market"}
  Stop Loss: ${assessment.stopLoss}
  Take Profit: ${assessment.takeProfit}
  Confidence: ${signal.confidence}
  Strategy: ${signal.strategy}
`).join("\n")}

For each approved signal:
1. Use executeOrder to place the main order
2. Use setProtection to set stop-loss immediately after
3. Report execution results

Return results as JSON:
[
  {
    "signalId": "...",
    "order": { order details } | null,
    "status": "executed|failed|skipped",
    "message": "execution summary",
    "slippage": number or undefined
  }
]`,
  });

  const orderSchema = z.object({
    id: z.string(),
    pair: z.string(),
    side: z.enum(["buy", "sell"]),
    type: z.string(),
    amount: z.number(),
    price: z.number().optional(),
    status: z.string(),
    timestamp: z.number(),
  }).nullable();

  const executionResultSchema = z.object({
    signalId: z.string(),
    order: orderSchema.optional().default(null),
    status: z.enum(["executed", "failed", "skipped"]),
    message: z.string(),
    slippage: z.number().optional(),
  });

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const raw = JSON.parse(jsonMatch[0]) as unknown[];
      return raw.map((item, i) => {
        const parsed = executionResultSchema.safeParse(item);
        if (parsed.success) return parsed.data as ExecutionResult;
        console.warn(`[executor] LLM output validation failed for result ${i}: ${parsed.error.message}`, { raw: JSON.stringify(item).slice(0, 300) });
        const fallbackSignal = approvedPairs[i]?.signal;
        return {
          signalId: fallbackSignal?.id ?? `unknown_${i}`,
          order: null,
          status: "failed" as const,
          message: `Execution result validation failed: ${parsed.error.message}`,
        };
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown parsing error";
    console.warn(`[executor] Failed to parse LLM output: ${msg}`, { raw: text.slice(0, 500) });
  }

  return approvedPairs.map(({ signal }) => ({
    signalId: signal.id,
    order: null,
    status: "failed" as const,
    message: "Execution result could not be parsed",
  }));
}
