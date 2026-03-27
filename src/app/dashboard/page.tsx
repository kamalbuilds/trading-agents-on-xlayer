"use client";

import { DashboardHeader } from "@/components/dashboard/header";
import { PortfolioCard } from "@/components/dashboard/portfolio-card";
import { PnlChart } from "@/components/dashboard/pnl-chart";
import { PositionsTable } from "@/components/dashboard/positions-table";
import { TradesTable } from "@/components/dashboard/trades-table";
import { StrategyChart } from "@/components/dashboard/strategy-chart";
import { AgentLog } from "@/components/dashboard/agent-log";
import { SystemControls } from "@/components/dashboard/system-controls";

export default function DashboardPage() {
  return (
    <>
      <DashboardHeader />

      <div className="flex-1 overflow-auto p-4 lg:p-6">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
          {/* Portfolio overview - full width */}
          <PortfolioCard />

          {/* Charts row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <PnlChart />
            </div>
            <StrategyChart />
          </div>

          {/* Tables row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PositionsTable />
            <TradesTable />
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <AgentLog />
            </div>
            <SystemControls />
          </div>
        </div>
      </div>
    </>
  );
}
