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
import { History } from "lucide-react";
import { useDashboardStore } from "@/lib/store";

export function TradesTable() {
  const { systemState } = useDashboardStore();
  const trades = systemState.recentTrades;

  function formatTime(ts: number) {
    return new Date(ts).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <History className="h-4 w-4" />
          Recent Trades
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Time</TableHead>
              <TableHead>Pair</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right pr-4">Fee</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((trade) => (
              <TableRow key={trade.id}>
                <TableCell className="pl-4 text-xs text-muted-foreground font-mono">
                  {formatTime(trade.timestamp)}
                </TableCell>
                <TableCell className="font-mono font-medium">
                  {trade.pair}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={trade.side === "buy" ? "default" : "secondary"}
                    className={
                      trade.side === "buy"
                        ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20"
                        : "bg-red-500/15 text-red-400 hover:bg-red-500/20"
                    }
                  >
                    {trade.side.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs capitalize text-muted-foreground">
                  {trade.type.replace("-", " ")}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  ${trade.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {trade.amount}
                </TableCell>
                <TableCell className="text-right pr-4 font-mono tabular-nums text-muted-foreground">
                  ${trade.fee.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
