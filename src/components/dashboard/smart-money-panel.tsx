"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDashboardStore } from "@/lib/store";
import { TrendingUp, TrendingDown, Minus, Eye, Zap } from "lucide-react";

function formatUsd(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function WhaleActivityBadge({ activity }: { activity: string }) {
  if (activity === "accumulating") {
    return (
      <Badge variant="default" className="bg-green-600 text-white">
        <TrendingUp className="mr-1 h-3 w-3" /> Accumulating
      </Badge>
    );
  }
  if (activity === "distributing") {
    return (
      <Badge variant="destructive">
        <TrendingDown className="mr-1 h-3 w-3" /> Distributing
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Minus className="mr-1 h-3 w-3" /> Neutral
    </Badge>
  );
}

export function SmartMoneyPanel() {
  const { nansenSignal } = useDashboardStore();

  if (!nansenSignal) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Eye className="h-4 w-4" />
            Smart Money Intelligence
            <Badge variant="outline" className="ml-auto text-[10px]">
              Nansen
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            Loading Nansen data...
          </div>
        </CardContent>
      </Card>
    );
  }

  const { aggregated, topBuys, topHoldings, netflows } = nansenSignal;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Eye className="h-4 w-4" />
          Smart Money Intelligence
          <Badge variant="outline" className="ml-auto text-[10px]">
            Nansen
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Whale Activity Summary */}
        <div className="flex items-center justify-between">
          <WhaleActivityBadge activity={aggregated.whaleActivity} />
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Buy Pressure</div>
            <div className="font-mono text-sm font-semibold">
              {(aggregated.buyPressure * 100).toFixed(0)}%
            </div>
          </div>
        </div>

        {/* Net Flows */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">24h Net Flow</div>
            <div
              className={`font-mono text-sm font-semibold ${
                aggregated.totalNetflow24h > 0
                  ? "text-green-500"
                  : aggregated.totalNetflow24h < 0
                  ? "text-red-500"
                  : "text-muted-foreground"
              }`}
            >
              {aggregated.totalNetflow24h > 0 ? "+" : ""}
              {formatUsd(aggregated.totalNetflow24h)}
            </div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">7d Net Flow</div>
            <div
              className={`font-mono text-sm font-semibold ${
                aggregated.totalNetflow7d > 0
                  ? "text-green-500"
                  : aggregated.totalNetflow7d < 0
                  ? "text-red-500"
                  : "text-muted-foreground"
              }`}
            >
              {aggregated.totalNetflow7d > 0 ? "+" : ""}
              {formatUsd(aggregated.totalNetflow7d)}
            </div>
          </div>
        </div>

        {/* Top Accumulated / Distributed */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-green-500">
              <TrendingUp className="h-3 w-3" /> Accumulated
            </div>
            <div className="flex flex-wrap gap-1">
              {aggregated.topAccumulated.slice(0, 4).map((token) => (
                <Badge
                  key={token}
                  variant="outline"
                  className="border-green-500/30 text-[10px] text-green-500"
                >
                  {token}
                </Badge>
              ))}
              {aggregated.topAccumulated.length === 0 && (
                <span className="text-[10px] text-muted-foreground">None</span>
              )}
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-red-500">
              <TrendingDown className="h-3 w-3" /> Distributed
            </div>
            <div className="flex flex-wrap gap-1">
              {aggregated.topDistributed.slice(0, 4).map((token) => (
                <Badge
                  key={token}
                  variant="outline"
                  className="border-red-500/30 text-[10px] text-red-500"
                >
                  {token}
                </Badge>
              ))}
              {aggregated.topDistributed.length === 0 && (
                <span className="text-[10px] text-muted-foreground">None</span>
              )}
            </div>
          </div>
        </div>

        {/* Recent Whale Trades */}
        {topBuys.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Zap className="h-3 w-3" /> Recent Smart Money Trades
            </div>
            <Table>
              <TableHeader>
                <TableRow className="text-[10px]">
                  <TableHead className="h-7 px-2">Sold</TableHead>
                  <TableHead className="h-7 px-2">Bought</TableHead>
                  <TableHead className="h-7 px-2 text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topBuys.slice(0, 5).map((trade, i) => (
                  <TableRow key={i} className="text-xs">
                    <TableCell className="px-2 py-1 font-mono">
                      {trade.token_sold_symbol}
                    </TableCell>
                    <TableCell className="px-2 py-1 font-mono">
                      {trade.token_bought_symbol}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right font-mono">
                      {formatUsd(trade.trade_value_usd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Top Holdings */}
        {topHoldings.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Top Whale Holdings
            </div>
            <div className="flex flex-wrap gap-1">
              {topHoldings.slice(0, 6).map((h) => (
                <Badge key={h.token_symbol} variant="secondary" className="text-[10px]">
                  {h.token_symbol} ({h.holders_count} whales, {formatUsd(h.value_usd)})
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Data Confidence */}
        <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
          <span>Data confidence: {(aggregated.confidence * 100).toFixed(0)}%</span>
          <span>Chain: {nansenSignal.chain}</span>
        </div>
      </CardContent>
    </Card>
  );
}
