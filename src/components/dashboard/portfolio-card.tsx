"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrendingUp, TrendingDown, Wallet, BarChart3, Target, Activity } from "lucide-react";
import { useDashboardStore } from "@/lib/store";

function StatItem({
  label,
  value,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <span
        className={`font-mono text-lg font-semibold tabular-nums ${
          trend === "up"
            ? "text-emerald-400"
            : trend === "down"
              ? "text-red-400"
              : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function PortfolioCard() {
  const { systemState } = useDashboardStore();
  const { portfolio } = systemState;
  const pnlTrend = portfolio.totalPnl >= 0 ? "up" : "down";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Wallet className="h-4 w-4" />
          Portfolio Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatItem
            label="Balance"
            value={`$${portfolio.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
            icon={Wallet}
          />
          <StatItem
            label="Equity"
            value={`$${portfolio.equity.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
            icon={BarChart3}
          />
          <StatItem
            label="Total PnL"
            value={`${portfolio.totalPnl >= 0 ? "+" : ""}$${portfolio.totalPnl.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
            icon={portfolio.totalPnl >= 0 ? TrendingUp : TrendingDown}
            trend={pnlTrend}
          />
          <StatItem
            label="Win Rate"
            value={`${(portfolio.winRate * 100).toFixed(1)}%`}
            icon={Target}
            trend={portfolio.winRate > 0.5 ? "up" : "down"}
          />
          <StatItem
            label="Sharpe Ratio"
            value={portfolio.sharpeRatio.toFixed(2)}
            icon={Activity}
            trend={portfolio.sharpeRatio > 1 ? "up" : "neutral"}
          />
          <StatItem
            label="Max Drawdown"
            value={`${(portfolio.maxDrawdown * 100).toFixed(1)}%`}
            icon={TrendingDown}
            trend="down"
          />
        </div>
      </CardContent>
    </Card>
  );
}
