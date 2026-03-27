"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { MessageSquare } from "lucide-react";
import { useDashboardStore } from "@/lib/store";
import type { AgentRole } from "@/lib/types";

const ROLE_CONFIG: Record<AgentRole, { label: string; className: string }> = {
  market_analyst: {
    label: "Analyst",
    className: "bg-blue-500/15 text-blue-400",
  },
  strategist: {
    label: "Strategist",
    className: "bg-violet-500/15 text-violet-400",
  },
  risk_manager: {
    label: "Risk",
    className: "bg-amber-500/15 text-amber-400",
  },
  executor: {
    label: "Executor",
    className: "bg-emerald-500/15 text-emerald-400",
  },
  portfolio_manager: {
    label: "Portfolio",
    className: "bg-cyan-500/15 text-cyan-400",
  },
};

export function AgentLog() {
  const { systemState } = useDashboardStore();
  const messages = systemState.agentMessages;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <MessageSquare className="h-4 w-4" />
          Agent Decisions
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <ScrollArea className="h-[320px] px-4">
          <div className="flex flex-col gap-3">
            {messages
              .slice()
              .reverse()
              .map((msg, i) => {
                const config = ROLE_CONFIG[msg.role];
                return (
                  <div
                    key={`${msg.timestamp}-${i}`}
                    className="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-muted/30 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${config.className}`}
                      >
                        {config.label}
                      </Badge>
                      <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                        {new Date(msg.timestamp).toLocaleTimeString("en-US", {
                          hour12: false,
                        })}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-foreground/80">
                      {msg.content}
                    </p>
                  </div>
                );
              })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
