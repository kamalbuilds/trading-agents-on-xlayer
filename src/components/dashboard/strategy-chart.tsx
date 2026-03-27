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
  const { systemState } = useDashboardStore();
  const strategies = systemState.activeStrategies;

  const chartData = strategies.map((s, i) => ({
    name: s.name,
    value: s.allocation,
    fill: COLORS[i % COLORS.length],
  }));

  const chartConfig: ChartConfig = {};
  strategies.forEach((s, i) => {
    chartConfig[s.name] = {
      label: s.name,
      color: COLORS[i % COLORS.length],
    };
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <PieChartIcon className="h-4 w-4" />
          Strategy Allocation
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="mx-auto h-[200px] w-full">
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => [`${value}%`]}
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
          {strategies.map((s, i) => (
            <Badge
              key={s.name}
              variant="outline"
              className="gap-1.5 text-xs"
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              {s.name} ({s.allocation}%)
              {!s.enabled && (
                <span className="text-muted-foreground ml-1">off</span>
              )}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
