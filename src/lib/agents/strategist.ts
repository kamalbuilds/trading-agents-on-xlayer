import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { STRATEGIST_PROMPT } from "./prompts";
import type { TradeSignal, PortfolioState, StrategyConfig } from "@/lib/types";
import type { MarketAnalysis } from "./market-analyst";

export interface StrategyProposal {
  signals: TradeSignal[];
  bullCase: string;
  bearCase: string;
  consensus: string;
  overallConfidence: number;
}

export async function runStrategist(
  analysis: MarketAnalysis,
  portfolio: PortfolioState | null,
  activeStrategies: StrategyConfig[]
): Promise<StrategyProposal> {
  const { text } = await generateText({
    model: "anthropic/claude-sonnet-4.6",
    system: STRATEGIST_PROMPT,
    tools: {
      proposeTrade: tool({
        description: "Propose a trade signal based on analysis",
        inputSchema: z.object({
          pair: z.string(),
          side: z.enum(["buy", "sell"]),
          type: z.enum(["market", "limit", "stop-loss", "take-profit"]),
          price: z.number().optional().describe("Limit price if applicable"),
          amount: z.number().describe("Position size as fraction of portfolio (0-1)"),
          confidence: z.number().min(0).max(1).describe("Signal confidence"),
          strategy: z.string().describe("Strategy name that generated this signal"),
          reasoning: z.string().describe("Detailed reasoning for this trade"),
        }),
        execute: async (params) => ({
          id: `sig_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
          ...params,
          timestamp: Date.now(),
        }),
      }),
      evaluateStrategy: tool({
        description: "Evaluate how well a strategy fits current conditions",
        inputSchema: z.object({
          strategyType: z.string(),
          marketSentiment: z.string(),
          reasoning: z.string(),
        }),
        execute: async ({ strategyType, marketSentiment, reasoning }) => ({
          strategyType,
          marketSentiment,
          fit: reasoning,
          evaluated: true,
        }),
      }),
    },
    stopWhen: stepCountIs(8),
    prompt: `You have received market analysis for ${analysis.pair}.

## Market Analysis
- Sentiment: ${analysis.sentiment}
- Summary: ${analysis.summary}
- Trend: ${analysis.technicals.trend}
- Support levels: ${JSON.stringify(analysis.technicals.support)}
- Resistance levels: ${JSON.stringify(analysis.technicals.resistance)}
- Indicators: ${JSON.stringify(analysis.technicals.indicators)}
- Alerts: ${JSON.stringify(analysis.alerts)}

## Portfolio State
${portfolio ? `Balance: $${portfolio.balance}, Equity: $${portfolio.equity}, Open positions: ${portfolio.positions.length}, Win rate: ${portfolio.winRate}` : "No portfolio data available"}

## Active Strategies
${activeStrategies.length ? activeStrategies.map(s => `- ${s.name} (${s.type}): ${s.enabled ? "enabled" : "disabled"}, allocation: ${s.allocation}%`).join("\n") : "No active strategies configured"}

## Instructions
1. First, present the BULL CASE for trading ${analysis.pair} right now
2. Then present the BEAR CASE against trading
3. Conduct an internal debate weighing both sides
4. If the debate concludes with a tradeable signal (confidence >= 0.3), use the proposeTrade tool
5. You may propose multiple signals if different strategies align

Return your final assessment as JSON:
{
  "signals": [/* array of proposed signals */],
  "bullCase": "summary of bull argument",
  "bearCase": "summary of bear argument",
  "consensus": "final consensus after debate",
  "overallConfidence": 0.0-1.0
}`,
  });

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        signals: (parsed.signals ?? []).map((s: Partial<TradeSignal>) => ({
          id: s.id ?? `sig_${Date.now()}`,
          strategy: s.strategy ?? "unknown",
          pair: s.pair ?? analysis.pair,
          side: s.side ?? "buy",
          type: s.type ?? "limit",
          price: s.price,
          amount: s.amount ?? 0,
          confidence: s.confidence ?? 0,
          reasoning: s.reasoning ?? "",
          timestamp: s.timestamp ?? Date.now(),
        })),
        bullCase: parsed.bullCase ?? "",
        bearCase: parsed.bearCase ?? "",
        consensus: parsed.consensus ?? text,
        overallConfidence: parsed.overallConfidence ?? 0,
      };
    }
  } catch {
    // Fall through
  }

  return {
    signals: [],
    bullCase: "",
    bearCase: "",
    consensus: text,
    overallConfidence: 0,
  };
}
