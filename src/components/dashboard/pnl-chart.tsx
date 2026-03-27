"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
import { TrendingUp } from "lucide-react";
import { useDashboardStore } from "@/lib/store";

const chartConfig = {
  pnl: {
    label: "PnL",
    color: "oklch(0.76 0.18 163)",
  },
  equity: {
    label: "Equity",
    color: "oklch(0.65 0.15 260)",
  },
} satisfies ChartConfig;

export function PnlChart() {
  const { pnlHistory } = useDashboardStore();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <TrendingUp className="h-4 w-4" />
          PnL (24h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[260px] w-full">
          <AreaChart
            accessibilityLayer
            data={pnlHistory}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              interval="preserveStartEnd"
              tickFormatter={(value: string) => value}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              tickFormatter={(value: number) =>
                `$${value >= 0 ? "+" : ""}${value.toFixed(0)}`
              }
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => `Time: ${value}`}
                  formatter={(value) => [
                    `$${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}`,
                  ]}
                />
              }
            />
            <defs>
              <linearGradient id="fillPnl" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-pnl)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-pnl)"
                  stopOpacity={0.0}
                />
              </linearGradient>
            </defs>
            <Area
              dataKey="pnl"
              type="monotone"
              fill="url(#fillPnl)"
              stroke="var(--color-pnl)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
