"use client";

import { Pie, PieChart, Cell } from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { PieChartIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useDashboardStore } from "@/lib/store";

const COLORS = [
  "oklch(0.76 0.18 163)",
  "oklch(0.65 0.15 260)",
  "oklch(0.75 0.18 55)",
  "oklch(0.65 0.2 15)",
  "oklch(0.7 0.15 200)",
];

export function StrategyChart() {
  const { strategyAnalysis, systemState } = useDashboardStore();

  // Derive chart data from live strategy analysis when available,
  // fall back to static activeStrategies config
  const hasLiveData = strategyAnalysis && strategyAnalysis.strategies;
  const strategyNames = hasLiveData
    ? Object.keys(strategyAnalysis.strategies)
    : systemState.activeStrategies.map((s) => s.name);

  const chartData = strategyNames.map((name, i) => {
    if (hasLiveData) {
      const s = strategyAnalysis.strategies[name];
      return {
        name,
        value: s.signalCount || 1,
        fill: COLORS[i % COLORS.length],
        analysis: s.analysis,
      };
    }
    const cfg = systemState.activeStrategies[i];
    return {
      name,
      value: cfg?.allocation ?? 1,
      fill: COLORS[i % COLORS.length],
      analysis: "",
    };
  });

  const chartConfig: ChartConfig = {};
  strategyNames.forEach((name, i) => {
    chartConfig[name] = {
      label: name,
      color: COLORS[i % COLORS.length],
    };
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <PieChartIcon className="h-4 w-4" />
          Strategy Analysis
          {strategyAnalysis?.ensemble && (
            <Badge
              variant="outline"
              className={`ml-auto text-[10px] ${
                strategyAnalysis.ensemble.consensus === "BUY"
                  ? "border-emerald-500/40 text-emerald-400"
                  : strategyAnalysis.ensemble.consensus === "SELL"
                    ? "border-red-500/40 text-red-400"
                    : "border-muted-foreground/40 text-muted-foreground"
              }`}
            >
              Consensus: {strategyAnalysis.ensemble.consensus}{" "}
              ({(strategyAnalysis.ensemble.consensusStrength * 100).toFixed(0)}%)
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <>
            <ChartContainer config={chartConfig} className="mx-auto h-[200px] w-full">
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => [`${value}`]}
                    />
                  }
                />
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>

            <div className="mt-3 flex flex-wrap gap-2">
              {chartData.map((s, i) => (
                <Badge
                  key={s.name}
                  variant="outline"
                  className="gap-1.5 text-xs"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  {s.name}
                </Badge>
              ))}
            </div>
          </>
        ) : (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            No strategy data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
