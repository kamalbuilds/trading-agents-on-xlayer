import type { Position } from "@/lib/types";

// Pearson correlation coefficient between two price series
export function pearsonCorrelation(seriesA: number[], seriesB: number[]): number {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 3) return 0;

  const a = seriesA.slice(-n);
  const b = seriesB.slice(-n);

  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let denomA = 0;
  let denomB = 0;

  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }

  const denom = Math.sqrt(denomA * denomB);
  if (denom === 0) return 0;
  return num / denom;
}

// Convert price series to returns for more meaningful correlation
export function priceToReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] === 0) continue;
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return returns;
}

// Build correlation matrix for all pairs
export function buildCorrelationMatrix(
  priceHistory: Map<string, number[]>
): Map<string, number> {
  const matrix = new Map<string, number>();
  const pairs = Array.from(priceHistory.keys());

  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const returnsA = priceToReturns(priceHistory.get(pairs[i])!);
      const returnsB = priceToReturns(priceHistory.get(pairs[j])!);
      const corr = pearsonCorrelation(returnsA, returnsB);
      matrix.set(`${pairs[i]}:${pairs[j]}`, corr);
    }
  }

  return matrix;
}

// Check if adding a new position would create excessive correlation
export function checkCorrelationRisk(
  newPair: string,
  existingPositions: Position[],
  correlationMatrix: Map<string, number>,
  maxCorrelation: number
): { allowed: boolean; highCorrelations: { pair: string; correlation: number }[] } {
  const highCorrelations: { pair: string; correlation: number }[] = [];

  for (const pos of existingPositions) {
    // Look up correlation in both directions
    const key1 = `${newPair}:${pos.pair}`;
    const key2 = `${pos.pair}:${newPair}`;
    const corr = correlationMatrix.get(key1) ?? correlationMatrix.get(key2) ?? 0;

    if (Math.abs(corr) >= maxCorrelation) {
      highCorrelations.push({ pair: pos.pair, correlation: corr });
    }
  }

  return {
    allowed: highCorrelations.length === 0,
    highCorrelations,
  };
}

// Calculate portfolio concentration (Herfindahl index)
export function portfolioConcentration(positions: Position[]): number {
  if (positions.length === 0) return 0;

  const totalValue = positions.reduce(
    (sum, p) => sum + Math.abs(p.amount * p.currentPrice),
    0
  );
  if (totalValue === 0) return 0;

  // HHI: sum of squared weights. 1/n = perfectly diversified, 1 = single asset
  let hhi = 0;
  for (const pos of positions) {
    const weight = Math.abs(pos.amount * pos.currentPrice) / totalValue;
    hhi += weight * weight;
  }

  return hhi;
}

// Portfolio heat: total risk exposure as % of equity
export function portfolioHeat(positions: Position[], equity: number): number {
  if (equity <= 0) return 100;

  const totalExposure = positions.reduce(
    (sum, p) => sum + Math.abs(p.amount * p.currentPrice),
    0
  );

  return (totalExposure / equity) * 100;
}

// Check if portfolio is over-concentrated in one direction
export function directionalBias(positions: Position[]): {
  longExposure: number;
  shortExposure: number;
  netExposure: number;
  bias: "long" | "short" | "neutral";
} {
  let longExposure = 0;
  let shortExposure = 0;

  for (const pos of positions) {
    const value = Math.abs(pos.amount * pos.currentPrice);
    if (pos.side === "buy") {
      longExposure += value;
    } else {
      shortExposure += value;
    }
  }

  const netExposure = longExposure - shortExposure;
  const total = longExposure + shortExposure;
  const biasRatio = total > 0 ? netExposure / total : 0;

  return {
    longExposure,
    shortExposure,
    netExposure,
    bias: biasRatio > 0.3 ? "long" : biasRatio < -0.3 ? "short" : "neutral",
  };
}
