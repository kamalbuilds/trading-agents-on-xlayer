import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { RISK_MANAGER_PROMPT } from "./prompts";
import type {
  TradeSignal,
  RiskAssessment,
  RiskLimits,
  PortfolioState,
} from "@/lib/types";
import { getRiskLimits } from "@/lib/config";

// Dynamic import for risk engine (written by another agent)
async function checkRiskLimits(
  signal: TradeSignal,
  portfolio: PortfolioState | null,
  limits: RiskLimits
): Promise<{ withinLimits: boolean; violations: string[] }> {
  try {
    const mod = await import("@/lib/risk");
    if (mod.validateSignal) return await mod.validateSignal(signal, portfolio, limits);
  } catch {
    // Fallback basic checks
  }

  const violations: string[] = [];
  if (portfolio) {
    const positionValue = signal.amount * (signal.price ?? 0);
    const positionPercent = (positionValue / portfolio.equity) * 100;
    if (positionPercent > limits.maxPositionSize) {
      violations.push(`Position size ${positionPercent.toFixed(1)}% exceeds limit ${limits.maxPositionSize}%`);
    }
    if (portfolio.positions.length >= limits.maxOpenPositions) {
      violations.push(`Max open positions (${limits.maxOpenPositions}) reached`);
    }
    if (Math.abs(portfolio.maxDrawdown) >= limits.maxDrawdown) {
      violations.push(`Portfolio drawdown ${portfolio.maxDrawdown.toFixed(1)}% exceeds limit ${limits.maxDrawdown}%`);
    }
  }
  return { withinLimits: violations.length === 0, violations };
}

export async function runRiskManager(
  signals: TradeSignal[],
  portfolio: PortfolioState | null,
  limits: RiskLimits = getRiskLimits()
): Promise<RiskAssessment[]> {
  if (!signals.length) return [];

  const { text } = await generateText({
    model: "anthropic/claude-sonnet-4.6",
    system: RISK_MANAGER_PROMPT,
    tools: {
      checkRisk: tool({
        description: "Check a trade signal against portfolio risk limits",
        inputSchema: z.object({
          signalId: z.string(),
          pair: z.string(),
          side: z.enum(["buy", "sell"]),
          amount: z.number(),
          price: z.number().optional(),
          confidence: z.number(),
        }),
        execute: async ({ signalId, pair, side, amount, price, confidence }) => {
          const signal: TradeSignal = {
            id: signalId,
            strategy: "risk_check",
            pair,
            side,
            type: "limit",
            price,
            amount,
            confidence,
            reasoning: "",
            timestamp: Date.now(),
          };
          const result = await checkRiskLimits(signal, portfolio, limits);
          return {
            ...result,
            currentPositions: portfolio?.positions.length ?? 0,
            currentDrawdown: portfolio?.maxDrawdown ?? 0,
            equity: portfolio?.equity ?? 0,
          };
        },
      }),
      calculatePositionSize: tool({
        description: "Calculate recommended position size based on risk parameters",
        inputSchema: z.object({
          pair: z.string(),
          entryPrice: z.number(),
          stopLossPrice: z.number(),
          riskPercent: z.number().describe("Percent of portfolio to risk on this trade"),
        }),
        execute: async ({ entryPrice, stopLossPrice, riskPercent }) => {
          const equity = portfolio?.equity ?? 10000;
          const riskAmount = equity * (riskPercent / 100);
          const priceRisk = Math.abs(entryPrice - stopLossPrice);
          const positionSize = priceRisk > 0 ? riskAmount / priceRisk : 0;
          return {
            recommendedSize: positionSize,
            riskAmount,
            riskRewardNeeded: 1.5,
            equity,
          };
        },
      }),
      setStopLoss: tool({
        description: "Calculate stop-loss level for a trade",
        inputSchema: z.object({
          entryPrice: z.number(),
          side: z.enum(["buy", "sell"]),
          atrOrVolatility: z.number().optional().describe("ATR or volatility measure for dynamic stops"),
        }),
        execute: async ({ entryPrice, side, atrOrVolatility }) => {
          const stopPercent = limits.stopLossPercent / 100;
          const atrMultiplier = atrOrVolatility ? atrOrVolatility * 2 : entryPrice * stopPercent;
          const stopLoss = side === "buy"
            ? entryPrice - atrMultiplier
            : entryPrice + atrMultiplier;
          const takeProfit = side === "buy"
            ? entryPrice + atrMultiplier * (limits.takeProfitPercent / limits.stopLossPercent)
            : entryPrice - atrMultiplier * (limits.takeProfitPercent / limits.stopLossPercent);
          return { stopLoss, takeProfit, riskRewardRatio: limits.takeProfitPercent / limits.stopLossPercent };
        },
      }),
    },
    stopWhen: stepCountIs(8),
    prompt: `Evaluate the following trade signals for risk compliance.

## Risk Limits
${JSON.stringify(limits, null, 2)}

## Portfolio State
${portfolio ? `Equity: $${portfolio.equity}, Positions: ${portfolio.positions.length}, Drawdown: ${portfolio.maxDrawdown}%, Win Rate: ${portfolio.winRate}` : "No portfolio data"}

## Signals to Evaluate
${signals.map((s, i) => `
Signal ${i + 1}: ${s.side.toUpperCase()} ${s.pair}
  Strategy: ${s.strategy}
  Amount: ${s.amount}
  Price: ${s.price ?? "market"}
  Confidence: ${s.confidence}
  Reasoning: ${s.reasoning}
`).join("\n")}

For each signal:
1. Use checkRisk to verify it against limits
2. Use calculatePositionSize to determine the right size
3. Use setStopLoss to set stop-loss and take-profit levels
4. Approve or reject with clear reasoning

Return your assessments as JSON:
[
  {
    "approved": boolean,
    "adjustedSignal": { signal with adjusted size if needed } | null,
    "reasons": ["reason1", "reason2"],
    "riskScore": 0-100,
    "positionSizeRecommended": number,
    "stopLoss": number,
    "takeProfit": number
  }
]`,
  });

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const raw = JSON.parse(jsonMatch[0]) as unknown[];
      // Validate each assessment with Zod to prevent LLM hallucination
      const assessmentSchema = z.object({
        approved: z.boolean(),
        adjustedSignal: z.any().optional().nullable(),
        reasons: z.array(z.string()),
        riskScore: z.number().min(0).max(100),
        positionSizeRecommended: z.number().min(0),
        stopLoss: z.number().min(0),
        takeProfit: z.number().min(0),
      });
      return raw.map((item) => {
        const parsed = assessmentSchema.safeParse(item);
        if (parsed.success) return parsed.data as RiskAssessment;
        // If validation fails, reject the signal safely
        return {
          approved: false,
          reasons: [`LLM output validation failed: ${parsed.error.message}`],
          riskScore: 100,
          positionSizeRecommended: 0,
          stopLoss: 0,
          takeProfit: 0,
        } as RiskAssessment;
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown parsing error";
    console.warn(`[risk-manager] Failed to parse LLM output: ${msg}`);
  }

  // Default: reject all signals if parsing fails
  return signals.map(() => ({
    approved: false,
    reasons: ["Risk assessment could not be completed"],
    riskScore: 100,
    positionSizeRecommended: 0,
    stopLoss: 0,
    takeProfit: 0,
  }));
}
