import Link from "next/link";
import { Bot, TrendingUp, Shield, Brain, ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <main className="flex max-w-2xl flex-col items-center gap-8 py-24 text-center">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            AI Trading Agent
          </h1>
        </div>

        <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
          Autonomous multi-agent system for crypto trading. AI-powered market
          analysis, risk management, and execution in real-time.
        </p>

        <div className="grid w-full max-w-lg grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-card p-4">
            <Brain className="h-5 w-5 text-violet-400" />
            <span className="text-sm font-medium">Multi-Agent AI</span>
            <span className="text-xs text-muted-foreground">
              Analyst, Strategist, Risk Manager, Executor
            </span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-card p-4">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
            <span className="text-sm font-medium">Real-Time Trading</span>
            <span className="text-xs text-muted-foreground">
              Live market data, automated execution
            </span>
          </div>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-card p-4">
            <Shield className="h-5 w-5 text-amber-400" />
            <span className="text-sm font-medium">Risk Controls</span>
            <span className="text-xs text-muted-foreground">
              Position limits, drawdown protection
            </span>
          </div>
        </div>

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open Dashboard
          <ArrowRight className="h-4 w-4" />
        </Link>
      </main>
    </div>
  );
}
