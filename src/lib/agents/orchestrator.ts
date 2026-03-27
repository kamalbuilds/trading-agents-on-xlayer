import { streamText, convertToModelMessages, UIMessage, stepCountIs, tool } from "ai";
import { z } from "zod";
import { ORCHESTRATOR_PROMPT } from "./prompts";
import { runMarketAnalyst, type MarketAnalysis } from "./market-analyst";
import { runStrategist, type StrategyProposal } from "./strategist";
import { runRiskManager } from "./risk-manager";
import { runExecutor, type ExecutionResult } from "./executor";
import { formatMemoriesForPrompt } from "./reflection";
import {
  getRiskLimits,
  INITIAL_BALANCE,
  DEFAULT_STRATEGIES as CONFIG_STRATEGIES,
} from "@/lib/config";
import { standardToKraken } from "@/lib/utils/pairs";
import type {
  AgentMessage,
  AgentDecision,
  PortfolioState,
  StrategyConfig,
  RiskLimits,
  RiskAssessment,
  TradeSignal,
} from "@/lib/types";

export interface OrchestratorConfig {
  portfolio: PortfolioState | null;
  activeStrategies: StrategyConfig[];
  riskLimits: RiskLimits;
  mode: "paper" | "live";
}

const DEFAULT_PORTFOLIO: PortfolioState = {
  balance: INITIAL_BALANCE,
  equity: INITIAL_BALANCE,
  positions: [],
  openOrders: [],
  totalPnl: 0,
  totalTrades: 0,
  winRate: 0,
  sharpeRatio: 0,
  maxDrawdown: 0,
  timestamp: Date.now(),
};

// Use Kraken pair format for orchestrator (it talks to Kraken MCP)
const DEFAULT_STRATEGIES: StrategyConfig[] = CONFIG_STRATEGIES.map((s) => ({
  ...s,
  pairs: s.pairs.map(standardToKraken),
}));

export function getDefaultConfig(): OrchestratorConfig {
  return {
    portfolio: DEFAULT_PORTFOLIO,
    activeStrategies: DEFAULT_STRATEGIES,
    riskLimits: getRiskLimits(),
    mode: "paper",
  };
}

// Run the full multi-agent pipeline and return a streamable result
export async function runOrchestrator(messages: UIMessage[], config?: Partial<OrchestratorConfig>) {
  const cfg: OrchestratorConfig = {
    ...getDefaultConfig(),
    ...config,
  };

  // State that persists across tool calls within this orchestration run
  let latestAnalysis: MarketAnalysis | null = null;
  let latestProposal: StrategyProposal | null = null;
  let latestAssessments: RiskAssessment[] = [];
  let latestExecutions: ExecutionResult[] = [];
  const agentLog: AgentMessage[] = [];

  function log(role: AgentMessage["role"], content: string) {
    agentLog.push({ role, content, timestamp: Date.now() });
  }

  const result = streamText({
    model: "anthropic/claude-sonnet-4.6",
    system: ORCHESTRATOR_PROMPT + `\n\nSystem mode: ${cfg.mode.toUpperCase()} TRADING\nPortfolio equity: $${cfg.portfolio?.equity ?? INITIAL_BALANCE}\nActive strategies: ${cfg.activeStrategies.map(s => s.name).join(", ")}` + formatMemoriesForPrompt("strategist", `${cfg.activeStrategies.map(s => s.name).join(", ")} trading on ${cfg.mode} mode`),
    messages: await convertToModelMessages(messages),
    tools: {
      analyzeMarket: tool({
        description: "Run the Market Analyst agent to analyze a trading pair. Returns technical analysis, sentiment, and market microstructure data.",
        inputSchema: z.object({
          pair: z.string().describe("Trading pair to analyze, e.g. XBTUSD, ETHUSD"),
        }),
        execute: async ({ pair }) => {
          log("market_analyst", `Starting analysis for ${pair}`);
          try {
            latestAnalysis = await runMarketAnalyst(pair);
            log("market_analyst", `Analysis complete: ${latestAnalysis.sentiment} sentiment`);
            return {
              agent: "Market Analyst",
              status: "complete",
              analysis: latestAnalysis,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            log("market_analyst", `Analysis failed: ${msg}`);
            return { agent: "Market Analyst", status: "error", error: msg };
          }
        },
      }),

      proposeStrategy: tool({
        description: "Run the Strategist agent to propose trade signals based on market analysis. Includes bull/bear debate. Must run analyzeMarket first.",
        inputSchema: z.object({
          pair: z.string().describe("Trading pair to strategize on"),
        }),
        execute: async ({ pair }) => {
          if (!latestAnalysis || latestAnalysis.pair !== pair) {
            return { agent: "Strategist", status: "error", error: "Run analyzeMarket first" };
          }
          log("strategist", `Generating strategy for ${pair}`);
          try {
            latestProposal = await runStrategist(
              latestAnalysis,
              cfg.portfolio,
              cfg.activeStrategies
            );
            log("strategist", `Proposed ${latestProposal.signals.length} signals, confidence: ${latestProposal.overallConfidence}`);
            return {
              agent: "Strategist",
              status: "complete",
              proposal: latestProposal,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            log("strategist", `Strategy failed: ${msg}`);
            return { agent: "Strategist", status: "error", error: msg };
          }
        },
      }),

      assessRisk: tool({
        description: "Run the Risk Manager agent to evaluate proposed signals against risk limits. Must run proposeStrategy first.",
        inputSchema: z.object({
          pair: z.string().describe("Trading pair"),
        }),
        execute: async () => {
          if (!latestProposal || !latestProposal.signals.length) {
            return { agent: "Risk Manager", status: "error", error: "No signals to assess. Run proposeStrategy first." };
          }
          log("risk_manager", `Assessing ${latestProposal.signals.length} signals`);
          try {
            latestAssessments = await runRiskManager(
              latestProposal.signals,
              cfg.portfolio,
              cfg.riskLimits
            );
            const approved = latestAssessments.filter(a => a.approved).length;
            log("risk_manager", `${approved}/${latestAssessments.length} signals approved`);
            return {
              agent: "Risk Manager",
              status: "complete",
              assessments: latestAssessments.map((a, i) => ({
                signal: latestProposal!.signals[i]?.pair,
                side: latestProposal!.signals[i]?.side,
                ...a,
              })),
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            log("risk_manager", `Risk assessment failed: ${msg}`);
            return { agent: "Risk Manager", status: "error", error: msg };
          }
        },
      }),

      executeTrades: tool({
        description: "Run the Executor agent to execute approved trade signals. Must run assessRisk first. Only works in paper mode unless explicitly authorized for live.",
        inputSchema: z.object({
          confirm: z.boolean().describe("Confirm execution of approved trades"),
        }),
        execute: async ({ confirm }) => {
          if (!confirm) {
            return { agent: "Executor", status: "cancelled", message: "Execution not confirmed" };
          }
          if (!latestProposal?.signals.length || !latestAssessments.length) {
            return { agent: "Executor", status: "error", error: "No assessed signals. Run the full pipeline first." };
          }
          log("executor", `Executing trades in ${cfg.mode} mode`);
          try {
            latestExecutions = await runExecutor(latestProposal.signals, latestAssessments);
            const executed = latestExecutions.filter(e => e.status === "executed").length;
            log("executor", `${executed}/${latestExecutions.length} trades executed`);
            return {
              agent: "Executor",
              status: "complete",
              mode: cfg.mode,
              executions: latestExecutions,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            log("executor", `Execution failed: ${msg}`);
            return { agent: "Executor", status: "error", error: msg };
          }
        },
      }),

      getPortfolio: tool({
        description: "Get the current portfolio state including positions, balance, and performance metrics",
        inputSchema: z.object({}),
        execute: async () => {
          // Try to get live portfolio from trading engine
          try {
            const mod = await import("@/lib/trading");
            if (mod.getPortfolioState) {
              const portfolio = await mod.getPortfolioState();
              return { source: "live", portfolio };
            }
          } catch {
            // Fall through to default
          }
          return { source: "default", portfolio: cfg.portfolio };
        },
      }),

      getAgentLog: tool({
        description: "Get the full agent communication log from this orchestration run",
        inputSchema: z.object({}),
        execute: async () => ({ messages: agentLog }),
      }),

      runFullPipeline: tool({
        description: "Run the complete trading pipeline: Analyze -> Strategize (with debate) -> Risk Check -> Execute. This is the main workflow.",
        inputSchema: z.object({
          pair: z.string().describe("Trading pair to trade, e.g. XBTUSD"),
          autoExecute: z.boolean().optional().describe("Auto-execute approved trades (default: false, requires confirmation)"),
        }),
        execute: async ({ pair, autoExecute }) => {
          const steps: Record<string, unknown>[] = [];

          // Step 1: Market Analysis
          log("market_analyst", `Pipeline started for ${pair}`);
          try {
            latestAnalysis = await runMarketAnalyst(pair);
            log("market_analyst", `Sentiment: ${latestAnalysis.sentiment}`);
            steps.push({ step: "analysis", status: "complete", sentiment: latestAnalysis.sentiment, summary: latestAnalysis.summary });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            return { status: "failed", failedAt: "analysis", error: msg, steps };
          }

          // Step 2: Strategy with bull/bear debate
          try {
            latestProposal = await runStrategist(latestAnalysis, cfg.portfolio, cfg.activeStrategies);
            log("strategist", `Bull: ${latestProposal.bullCase.slice(0, 100)}`);
            log("strategist", `Bear: ${latestProposal.bearCase.slice(0, 100)}`);
            log("strategist", `Consensus: ${latestProposal.consensus.slice(0, 100)}`);
            steps.push({
              step: "strategy",
              status: "complete",
              signalCount: latestProposal.signals.length,
              bullCase: latestProposal.bullCase,
              bearCase: latestProposal.bearCase,
              consensus: latestProposal.consensus,
              confidence: latestProposal.overallConfidence,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            return { status: "failed", failedAt: "strategy", error: msg, steps };
          }

          if (!latestProposal.signals.length) {
            return {
              status: "complete",
              outcome: "no_trade",
              reason: "Strategist produced no actionable signals after debate",
              steps,
            };
          }

          // Step 3: Risk Assessment
          try {
            latestAssessments = await runRiskManager(latestProposal.signals, cfg.portfolio, cfg.riskLimits);
            const approved = latestAssessments.filter(a => a.approved).length;
            log("risk_manager", `${approved}/${latestAssessments.length} approved`);
            steps.push({
              step: "risk",
              status: "complete",
              approved,
              total: latestAssessments.length,
              assessments: latestAssessments,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            return { status: "failed", failedAt: "risk", error: msg, steps };
          }

          const hasApproved = latestAssessments.some(a => a.approved);
          if (!hasApproved) {
            return {
              status: "complete",
              outcome: "blocked_by_risk",
              reason: "Risk Manager rejected all signals",
              steps,
            };
          }

          // Step 4: Execution (only if auto or paper mode)
          if (autoExecute || cfg.mode === "paper") {
            try {
              latestExecutions = await runExecutor(latestProposal.signals, latestAssessments);
              const executed = latestExecutions.filter(e => e.status === "executed").length;
              log("executor", `${executed} trades executed in ${cfg.mode} mode`);
              steps.push({
                step: "execution",
                status: "complete",
                mode: cfg.mode,
                executed,
                results: latestExecutions,
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Unknown error";
              return { status: "failed", failedAt: "execution", error: msg, steps };
            }
          } else {
            steps.push({ step: "execution", status: "awaiting_confirmation", message: "Live trades require explicit confirmation" });
          }

          const decision: AgentDecision = {
            signal: latestProposal.signals[0] ?? null,
            analysis: latestProposal.consensus,
            confidence: latestProposal.overallConfidence,
            dissent: latestProposal.bearCase ? [latestProposal.bearCase] : undefined,
            timestamp: Date.now(),
          };

          return {
            status: "complete",
            outcome: "traded",
            decision,
            steps,
            agentLog: agentLog,
          };
        },
      }),
    },
    stopWhen: stepCountIs(10),
  });

  return result;
}
