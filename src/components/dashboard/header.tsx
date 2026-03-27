"use client";

import { Activity, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useDashboardStore } from "@/lib/store";

export function DashboardHeader() {
  const { systemState } = useDashboardStore();

  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <span className="text-lg font-semibold tracking-tight">
            Trading Agent
          </span>
        </div>
        <Badge
          variant={systemState.isRunning ? "default" : "secondary"}
          className="gap-1"
        >
          <Activity className="h-3 w-3" />
          {systemState.isRunning ? "Running" : "Stopped"}
        </Badge>
        <Badge variant="outline" className="font-mono text-xs">
          {systemState.mode.toUpperCase()}
        </Badge>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono">
        <span>
          Last update:{" "}
          {new Date(systemState.lastUpdate).toLocaleTimeString("en-US", {
            hour12: false,
          })}
        </span>
      </div>
    </header>
  );
}
