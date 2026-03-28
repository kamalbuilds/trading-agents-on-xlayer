import Link from "next/link";
import { Bot, TrendingUp, Shield, Brain, ArrowRight, FileCheck, PieChart } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <main className="flex max-w-2xl flex-col items-center gap-8 py-24 text-center">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
            <Bot className="h-6 w-6 text-emerald-400" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            RWA Agent
          </h1>
        </div>

        <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
          AI-powered multi-agent system for Real World Asset portfolio management on BNB Chain.
          Autonomous research, risk assessment, compliance, and execution.
        </p>

        <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-5">
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-card p-3">
            <Brain className="h-4 w-4 text-violet-400" />
            <span className="text-xs font-medium">Research</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-card p-3">
            <Shield className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-medium">Risk</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-card p-3">
            <FileCheck className="h-4 w-4 text-cyan-400" />
            <span className="text-xs font-medium">Compliance</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-card p-3">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-medium">Trading</span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-card p-3">
            <PieChart className="h-4 w-4 text-rose-400" />
            <span className="text-xs font-medium">Portfolio</span>
          </div>
        </div>

        <div className="flex gap-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-emerald-400"
          >
            Open Dashboard
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/pitch"
            className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            Pitch Deck
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
    </div>
  );
}
