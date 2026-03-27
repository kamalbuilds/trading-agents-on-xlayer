"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Crosshair } from "lucide-react";
import { useDashboardStore } from "@/lib/store";

export function PositionsTable() {
  const { systemState } = useDashboardStore();
  const { positions } = systemState.portfolio;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Crosshair className="h-4 w-4" />
          Active Positions ({positions.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Pair</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead className="text-right pr-4">Unrealized PnL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.map((pos) => (
              <TableRow key={`${pos.pair}-${pos.openTime}`}>
                <TableCell className="pl-4 font-mono font-medium">
                  {pos.pair}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={pos.side === "buy" ? "default" : "secondary"}
                    className={
                      pos.side === "buy"
                        ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20"
                        : "bg-red-500/15 text-red-400 hover:bg-red-500/20"
                    }
                  >
                    {pos.side.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  ${pos.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  ${pos.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {pos.amount}
                </TableCell>
                <TableCell
                  className={`text-right pr-4 font-mono font-medium tabular-nums ${
                    pos.unrealizedPnl >= 0
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {pos.unrealizedPnl >= 0 ? "+" : ""}$
                  {pos.unrealizedPnl.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
            {positions.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-16 text-center text-muted-foreground"
                >
                  No active positions
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
