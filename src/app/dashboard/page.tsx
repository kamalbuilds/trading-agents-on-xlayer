"use client";

import { useEffect } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { PortfolioCard } from "@/components/dashboard/portfolio-card";
import { PnlChart } from "@/components/dashboard/pnl-chart";
import { PositionsTable } from "@/components/dashboard/positions-table";
import { TradesTable } from "@/components/dashboard/trades-table";
import { StrategyChart } from "@/components/dashboard/strategy-chart";
import { AgentLog } from "@/components/dashboard/agent-log";
import { SystemControls } from "@/components/dashboard/system-controls";
import { SmartMoneyPanel } from "@/components/dashboard/smart-money-panel";
import { useDashboardStore } from "@/lib/store";

export default function DashboardPage() {
  const { startPolling, stopPolling, initialFetchDone, lastError } =
    useDashboardStore();

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  return (
    <>
      <DashboardHeader />

      {!initialFetchDone && (
        <div className="border-b border-border bg-muted/50 px-6 py-3 text-center text-sm text-muted-foreground">
          Connecting to trading engine...
        </div>
      )}

      {lastError && (
        <div className="border-b border-destructive/20 bg-destructive/5 px-6 py-2 text-center text-xs text-destructive">
          {lastError}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 lg:p-6">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
          {/* Row 1: Portfolio overview + System Controls */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <div className="lg:col-span-3">
              <PortfolioCard />
            </div>
            <SystemControls />
          </div>

          {/* Row 2: Charts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <PnlChart />
            </div>
            <StrategyChart />
          </div>

          {/* Row 3: Tables */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PositionsTable />
            <TradesTable />
          </div>

          {/* Row 4: Intelligence + Agent Log */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SmartMoneyPanel />
            <div className="lg:col-span-2">
              <AgentLog />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
