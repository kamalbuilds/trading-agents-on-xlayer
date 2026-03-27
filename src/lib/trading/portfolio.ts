// ============================================================
// Portfolio Tracker
// Tracks positions, calculates PnL, and maintains portfolio state.
// ============================================================

import { getTicker } from "@/lib/kraken/market-data";
import { tradingEvents } from "./events";
import { INITIAL_BALANCE } from "@/lib/config";
import { pairsMatch } from "@/lib/utils/pairs";
import type { Order, Position, PortfolioState } from "@/lib/types";

interface PortfolioConfig {
  initialBalance: number;
  baseCurrency: string;
}

const defaultPortfolioConfig: PortfolioConfig = {
  initialBalance: INITIAL_BALANCE,
  baseCurrency: "USD",
};

let portfolioConfig = { ...defaultPortfolioConfig };
let positions: Position[] = [];
let completedTrades: Order[] = [];
let currentBalance: number = defaultPortfolioConfig.initialBalance;
let peakEquity: number = defaultPortfolioConfig.initialBalance;

export function configurePortfolio(opts: Partial<PortfolioConfig>): void {
  portfolioConfig = { ...portfolioConfig, ...opts };
  if (opts.initialBalance !== undefined) {
    currentBalance = opts.initialBalance;
    peakEquity = opts.initialBalance;
  }
}

export function resetPortfolio(): void {
  positions = [];
  completedTrades = [];
  currentBalance = portfolioConfig.initialBalance;
  peakEquity = portfolioConfig.initialBalance;
}

export function recordTrade(order: Order): void {
  if (order.status !== "filled") return;

  completedTrades.push(order);

  if (order.side === "buy") {
    // Open or add to position
    const existing = positions.find((p) => pairsMatch(p.pair, order.pair) && p.side === "buy");
    if (existing) {
      // Average in
      const totalAmount = existing.amount + order.filled;
      existing.entryPrice =
        (existing.entryPrice * existing.amount + order.price * order.filled) / totalAmount;
      existing.amount = totalAmount;
    } else {
      const pos: Position = {
        pair: order.pair,
        side: "buy",
        entryPrice: order.price,
        currentPrice: order.price,
        amount: order.filled,
        unrealizedPnl: 0,
        realizedPnl: 0,
        openTime: order.timestamp,
        strategy: order.strategy,
      };
      positions.push(pos);
      tradingEvents.emitPositionOpened(pos, "portfolio");
    }
    currentBalance -= order.price * order.filled + order.fee;
  } else {
    // Close or reduce position
    const existing = positions.find((p) => pairsMatch(p.pair, order.pair) && p.side === "buy");
    if (existing) {
      const pnl = (order.price - existing.entryPrice) * order.filled - order.fee;
      existing.realizedPnl += pnl;
      existing.amount -= order.filled;

      currentBalance += order.price * order.filled - order.fee;

      if (existing.amount <= 0.00000001) {
        // Position closed
        tradingEvents.emitPositionClosed(existing, "portfolio");
        positions = positions.filter((p) => p !== existing);
      }
    } else {
      // Short sell (no existing long position)
      currentBalance += order.price * order.filled - order.fee;
    }
  }
}

export async function updatePrices(): Promise<void> {
  const pairs = [...new Set(positions.map((p) => p.pair))];

  await Promise.all(
    pairs.map(async (pair) => {
      try {
        const ticker = await getTicker(pair);
        for (const pos of positions) {
          if (pos.pair === pair) {
            pos.currentPrice = ticker.price;
            pos.unrealizedPnl =
              pos.side === "buy"
                ? (pos.currentPrice - pos.entryPrice) * pos.amount
                : (pos.entryPrice - pos.currentPrice) * pos.amount;
          }
        }
      } catch {
        // Skip price update on error
      }
    })
  );
}

export async function getPortfolioState(): Promise<PortfolioState> {
  await updatePrices();

  const equity =
    currentBalance +
    positions.reduce((sum, p) => sum + p.currentPrice * p.amount, 0);

  if (equity > peakEquity) peakEquity = equity;

  const totalPnl = equity - portfolioConfig.initialBalance;

  // Calculate wins by comparing sell price to the average buy price for that pair
  let wins = 0;
  const sellTrades = completedTrades.filter((t) => t.side === "sell");

  for (const sell of sellTrades) {
    // Find all buy trades for this pair before this sell
    const buyTrades = completedTrades.filter(
      (t) =>
        pairsMatch(t.pair, sell.pair) &&
        t.side === "buy" &&
        t.timestamp < sell.timestamp
    );

    if (buyTrades.length > 0) {
      // Calculate average buy price
      const totalBuyCost = buyTrades.reduce((sum, t) => sum + t.price * t.filled, 0);
      const totalBuyAmount = buyTrades.reduce((sum, t) => sum + t.filled, 0);
      const avgBuyPrice = totalBuyCost / totalBuyAmount;

      // Win if sell price > average buy price
      if (sell.price > avgBuyPrice) {
        wins++;
      }
    }
  }

  const totalSells = completedTrades.filter((t) => t.side === "sell").length;
  const winRate = totalSells > 0 ? wins / totalSells : 0;
  const maxDrawdown = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;

  return {
    balance: currentBalance,
    equity,
    positions: [...positions],
    openOrders: [],
    totalPnl,
    totalTrades: completedTrades.length,
    winRate,
    sharpeRatio: calculateSharpeRatio(),
    maxDrawdown,
    timestamp: Date.now(),
  };
}

export function getPositions(): Position[] {
  return [...positions];
}

export function getCompletedTrades(): Order[] {
  return [...completedTrades];
}

// --- Analytics ---

function calculateSharpeRatio(): number {
  if (completedTrades.length < 2) return 0;

  // Calculate returns from sell trades using FIFO buy matching
  const returns: number[] = [];
  const usedBuyIndices = new Set<number>();
  const sells = completedTrades.filter((t) => t.side === "sell" && t.price > 0);

  for (const sell of sells) {
    // Find the earliest unmatched buy for this pair
    const buyIdx = completedTrades.findIndex(
      (t, idx) =>
        pairsMatch(t.pair, sell.pair) &&
        t.side === "buy" &&
        t.timestamp < sell.timestamp &&
        !usedBuyIndices.has(idx)
    );
    if (buyIdx >= 0) {
      usedBuyIndices.add(buyIdx);
      const buy = completedTrades[buyIdx];
      returns.push((sell.price - buy.price) / buy.price);
    }
  }

  if (returns.length < 2) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualized (assuming ~365 trades/year for crypto)
  return (mean / stdDev) * Math.sqrt(365);
}
