// Post-Trade Reflection & Memory System
// Inspired by TradingAgents (42K stars) BM25-based memory
// Each agent role has its own memory bank that learns from outcomes.
// Uses BM25-like TF-IDF scoring for memory retrieval (no API calls needed).

import type { TradeSignal, RiskAssessment } from "@/lib/types";

export interface TradeOutcome {
  signal: TradeSignal;
  assessment: RiskAssessment;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  holdingPeriodMs: number;
  timestamp: number;
}

export interface MemoryEntry {
  situation: string;     // Market context when the trade was made
  decision: string;      // What was decided
  outcome: string;       // What happened
  lesson: string;        // What to learn
  pnl: number;
  confidence: number;
  strategy: string;
  timestamp: number;
  relevanceScore: number; // Updated on retrieval
}

export type AgentMemoryRole = "analyst" | "strategist" | "risk_manager" | "executor";

// Simple TF-IDF scoring for memory retrieval (no external deps)
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function termFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return freq;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, freqA] of a) {
    const freqB = b.get(term) ?? 0;
    dotProduct += freqA * freqB;
    normA += freqA * freqA;
  }
  for (const [, freqB] of b) {
    normB += freqB * freqB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dotProduct / denom : 0;
}

class AgentMemory {
  private entries: MemoryEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  add(entry: MemoryEntry): void {
    this.entries.push(entry);
    // Evict oldest if over capacity
    if (this.entries.length > this.maxEntries) {
      // Keep entries with negative PnL (learning from mistakes is more valuable)
      this.entries.sort((a, b) => {
        // Prioritize keeping: 1) recent entries, 2) large losses (lessons)
        const aScore = (a.pnl < 0 ? 2 : 1) * (1 / (Date.now() - a.timestamp + 1));
        const bScore = (b.pnl < 0 ? 2 : 1) * (1 / (Date.now() - b.timestamp + 1));
        return bScore - aScore;
      });
      this.entries = this.entries.slice(0, this.maxEntries);
    }
  }

  // Retrieve memories most relevant to the current situation
  recall(currentSituation: string, topK = 3): MemoryEntry[] {
    if (this.entries.length === 0) return [];

    const queryTF = termFrequency(tokenize(currentSituation));

    const scored = this.entries.map((entry) => {
      const entryText = `${entry.situation} ${entry.decision} ${entry.lesson}`;
      const entryTF = termFrequency(tokenize(entryText));
      const similarity = cosineSimilarity(queryTF, entryTF);

      // Boost recent memories and high-impact lessons (big wins/losses)
      const recencyBoost = Math.exp(-(Date.now() - entry.timestamp) / (7 * 24 * 60 * 60 * 1000)); // 7-day half-life
      const impactBoost = Math.min(2, Math.abs(entry.pnl) / 100); // Bigger PnL = more memorable

      return {
        ...entry,
        relevanceScore: similarity * (1 + recencyBoost * 0.3 + impactBoost * 0.2),
      };
    });

    return scored
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);
  }

  // Get aggregate statistics
  getStats(): {
    totalTrades: number;
    winRate: number;
    avgPnl: number;
    bestStrategy: string;
    worstStrategy: string;
  } {
    if (this.entries.length === 0) {
      return { totalTrades: 0, winRate: 0, avgPnl: 0, bestStrategy: "none", worstStrategy: "none" };
    }

    const wins = this.entries.filter((e) => e.pnl > 0).length;
    const avgPnl = this.entries.reduce((sum, e) => sum + e.pnl, 0) / this.entries.length;

    // Strategy performance
    const stratPnl = new Map<string, number>();
    for (const e of this.entries) {
      stratPnl.set(e.strategy, (stratPnl.get(e.strategy) ?? 0) + e.pnl);
    }

    let bestStrategy = "none";
    let worstStrategy = "none";
    let bestPnl = -Infinity;
    let worstPnl = Infinity;
    for (const [strat, pnl] of stratPnl) {
      if (pnl > bestPnl) { bestPnl = pnl; bestStrategy = strat; }
      if (pnl < worstPnl) { worstPnl = pnl; worstStrategy = strat; }
    }

    return {
      totalTrades: this.entries.length,
      winRate: wins / this.entries.length,
      avgPnl,
      bestStrategy,
      worstStrategy,
    };
  }

  size(): number {
    return this.entries.length;
  }
}

// Per-agent memory banks (singleton)
const memories: Record<AgentMemoryRole, AgentMemory> = {
  analyst: new AgentMemory(100),
  strategist: new AgentMemory(100),
  risk_manager: new AgentMemory(100),
  executor: new AgentMemory(50),
};

// Record a trade outcome and generate reflections for each agent role
export function reflectOnTrade(outcome: TradeOutcome): void {
  const { signal, assessment, entryPrice, exitPrice, pnl } = outcome;
  const isWin = pnl > 0;
  const returnPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;

  // Analyst reflection: was the market read correct?
  memories.analyst.add({
    situation: `${signal.pair} ${signal.side} signal, confidence ${signal.confidence}, strategy ${signal.strategy}`,
    decision: `Analyzed as ${signal.side} opportunity with ${(signal.confidence * 100).toFixed(0)}% confidence`,
    outcome: isWin ? `Correct: ${returnPct.toFixed(2)}% return` : `Wrong: ${returnPct.toFixed(2)}% loss`,
    lesson: isWin
      ? `${signal.strategy} on ${signal.pair} at this confidence level was profitable. Pattern worth repeating.`
      : `${signal.strategy} on ${signal.pair} misjudged. ${signal.confidence > 0.7 ? "High confidence was misleading." : "Low confidence was correctly uncertain but still traded."}`,
    pnl,
    confidence: signal.confidence,
    strategy: signal.strategy,
    timestamp: Date.now(),
    relevanceScore: 0,
  });

  // Strategist reflection: was the strategy selection correct?
  memories.strategist.add({
    situation: `Strategy: ${signal.strategy}, pair: ${signal.pair}, type: ${signal.type}`,
    decision: `Proposed ${signal.side} with ${signal.reasoning.slice(0, 100)}`,
    outcome: `PnL: $${pnl.toFixed(2)} (${returnPct.toFixed(2)}%)`,
    lesson: isWin
      ? `${signal.strategy} worked well here. Key factors: ${signal.reasoning.slice(0, 80)}`
      : `${signal.strategy} failed. Consider: was the signal timing off? Was the thesis invalidated before exit?`,
    pnl,
    confidence: signal.confidence,
    strategy: signal.strategy,
    timestamp: Date.now(),
    relevanceScore: 0,
  });

  // Risk manager reflection: was the risk assessment correct?
  memories.risk_manager.add({
    situation: `Risk score: ${assessment.riskScore}, approved: ${assessment.approved}, size: ${assessment.positionSizeRecommended}`,
    decision: assessment.approved
      ? `Approved with risk score ${assessment.riskScore}, reasons: ${assessment.reasons.join("; ")}`
      : `Blocked with risk score ${assessment.riskScore}`,
    outcome: `Actual result: $${pnl.toFixed(2)}`,
    lesson: assessment.approved && !isWin
      ? `Approved a losing trade (risk score was ${assessment.riskScore}). Should the threshold be higher?`
      : !assessment.approved && isWin
        ? `Blocked a winning trade. Risk assessment was too conservative.`
        : isWin
          ? `Correctly approved a winner. Risk framework validated.`
          : `Correctly would have blocked, or loss was within acceptable parameters.`,
    pnl,
    confidence: signal.confidence,
    strategy: signal.strategy,
    timestamp: Date.now(),
    relevanceScore: 0,
  });
}

// Get memories relevant to a current trading situation
export function recallMemories(
  role: AgentMemoryRole,
  currentSituation: string,
  topK = 3
): MemoryEntry[] {
  return memories[role].recall(currentSituation, topK);
}

// Format memories for inclusion in agent prompts
export function formatMemoriesForPrompt(
  role: AgentMemoryRole,
  currentSituation: string,
  topK = 3
): string {
  const recalled = recallMemories(role, currentSituation, topK);
  if (recalled.length === 0) return "";

  const stats = memories[role].getStats();

  let prompt = `\n## Past Experience (${stats.totalTrades} trades, ${(stats.winRate * 100).toFixed(0)}% win rate)\n`;
  prompt += `Best strategy: ${stats.bestStrategy}, Worst: ${stats.worstStrategy}\n\n`;

  for (const mem of recalled) {
    prompt += `### Similar situation:\n`;
    prompt += `- Context: ${mem.situation}\n`;
    prompt += `- Decision: ${mem.decision}\n`;
    prompt += `- Outcome: ${mem.outcome}\n`;
    prompt += `- Lesson: ${mem.lesson}\n\n`;
  }

  return prompt;
}

// Get stats for dashboard display
export function getMemoryStats(): Record<AgentMemoryRole, ReturnType<AgentMemory["getStats"]>> {
  return {
    analyst: memories.analyst.getStats(),
    strategist: memories.strategist.getStats(),
    risk_manager: memories.risk_manager.getStats(),
    executor: memories.executor.getStats(),
  };
}
