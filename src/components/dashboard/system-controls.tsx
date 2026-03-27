"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Play,
  Square,
  RefreshCw,
  Settings,
  Shield,
  Clock,
} from "lucide-react";
import { useDashboardStore } from "@/lib/store";

export function SystemControls() {
  const { systemState, toggleRunning, toggleMode, refreshData } =
    useDashboardStore();

  const uptimeMs = Date.now() - systemState.startTime;
  const uptimeHours = Math.floor(uptimeMs / 3_600_000);
  const uptimeMinutes = Math.floor((uptimeMs % 3_600_000) / 60_000);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Settings className="h-4 w-4" />
          System Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={systemState.isRunning ? "destructive" : "default"}
            onClick={toggleRunning}
            className="gap-1.5"
          >
            {systemState.isRunning ? (
              <>
                <Square className="h-3.5 w-3.5" /> Stop
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> Start
              </>
            )}
          </Button>

          <Button size="sm" variant="outline" onClick={toggleMode} className="gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            {systemState.mode === "paper" ? "Go Live" : "Paper Mode"}
          </Button>

          <Button size="sm" variant="ghost" onClick={refreshData} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">Status</span>
            <Badge
              variant={systemState.isRunning ? "default" : "secondary"}
              className="w-fit"
            >
              {systemState.isRunning ? "Running" : "Stopped"}
            </Badge>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">Mode</span>
            <Badge
              variant="outline"
              className={`w-fit font-mono ${
                systemState.mode === "live"
                  ? "border-amber-500/50 text-amber-400"
                  : ""
              }`}
            >
              {systemState.mode.toUpperCase()}
            </Badge>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Uptime
            </span>
            <span className="font-mono tabular-nums">
              {uptimeHours}h {uptimeMinutes}m
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">Total Trades</span>
            <span className="font-mono tabular-nums">
              {systemState.portfolio.totalTrades}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">Open Positions</span>
            <span className="font-mono tabular-nums">
              {systemState.portfolio.positions.length}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">Strategies</span>
            <span className="font-mono tabular-nums">
              {systemState.activeStrategies.filter((s) => s.enabled).length}/
              {systemState.activeStrategies.length}
            </span>
          </div>
        </div>

        {systemState.errors.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-destructive">
                Errors ({systemState.errors.length})
              </span>
              {systemState.errors.map((err, i) => (
                <p key={i} className="text-xs text-destructive/80">
                  {err}
                </p>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
