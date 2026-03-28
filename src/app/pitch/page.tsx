import Link from "next/link";
import {
  Bot,
  TrendingUp,
  Shield,
  Brain,
  ArrowRight,
  Coins,
  Scale,
  Globe,
  Users,
  ChevronRight,
  BarChart3,
  Lock,
  Zap,
  Target,
  Layers,
  FileCheck,
  CircleDollarSign,
  Building2,
  Landmark,
  PieChart,
} from "lucide-react";

function Section({
  id,
  children,
  className = "",
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`flex min-h-screen flex-col items-center justify-center px-6 py-20 ${className}`}
    >
      <div className="w-full max-w-5xl">{children}</div>
    </section>
  );
}

function SlideNumber({ n, total }: { n: number; total: number }) {
  return (
    <div className="mb-8 text-xs font-mono text-muted-foreground tracking-widest uppercase">
      {String(n).padStart(2, "0")} / {String(total).padStart(2, "0")}
    </div>
  );
}

function StatCard({
  value,
  label,
  icon: Icon,
}: {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-border/50 bg-card/50 p-6 backdrop-blur">
      <Icon className="h-5 w-5 text-emerald-400" />
      <span className="text-2xl font-bold tracking-tight">{value}</span>
      <span className="text-xs text-muted-foreground text-center">{label}</span>
    </div>
  );
}

const TOTAL_SLIDES = 8;

export default function PitchDeckPage() {
  return (
    <div className="relative">
      {/* Fixed nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between border-b border-border/50 bg-background/80 px-6 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
            <Bot className="h-4 w-4 text-emerald-400" />
          </div>
          <span className="font-semibold text-sm">RWA Agent</span>
          <span className="text-[10px] font-mono text-muted-foreground ml-1 rounded bg-muted px-1.5 py-0.5">
            PITCH DECK
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <a href="#overview" className="hover:text-foreground transition-colors">Overview</a>
          <a href="#problem" className="hover:text-foreground transition-colors">Problem</a>
          <a href="#solution" className="hover:text-foreground transition-colors">Solution</a>
          <a href="#how" className="hover:text-foreground transition-colors">How It Works</a>
          <a href="#tokenomics" className="hover:text-foreground transition-colors">Tokenomics</a>
          <a href="#market" className="hover:text-foreground transition-colors">Market</a>
          <a href="#team" className="hover:text-foreground transition-colors">Team</a>
          <a href="#roadmap" className="hover:text-foreground transition-colors">Roadmap</a>
          <Link
            href="/dashboard"
            className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1.5 text-emerald-400 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
          >
            Live Demo <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </nav>

      {/* Slide 1: Title / Overview */}
      <Section id="overview">
        <SlideNumber n={1} total={TOTAL_SLIDES} />
        <div className="flex flex-col items-center text-center gap-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 ring-1 ring-emerald-500/30">
            <Bot className="h-10 w-10 text-emerald-400" />
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight">
            RWA Agent
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl leading-relaxed">
            The AI intelligence layer for Real World Asset portfolio management on BNB Chain.
            Five autonomous agents that research, assess risk, ensure compliance, execute trades, and optimize your RWA portfolio 24/7.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-4">
            <span className="rounded-full bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-400 ring-1 ring-emerald-500/20">
              BNB Chain Native
            </span>
            <span className="rounded-full bg-cyan-500/10 px-4 py-1.5 text-sm text-cyan-400 ring-1 ring-cyan-500/20">
              5 AI Agents
            </span>
            <span className="rounded-full bg-violet-500/10 px-4 py-1.5 text-sm text-violet-400 ring-1 ring-violet-500/20">
              Compliance-First
            </span>
            <span className="rounded-full bg-amber-500/10 px-4 py-1.5 text-sm text-amber-400 ring-1 ring-amber-500/20">
              DeFi Integrated
            </span>
          </div>
          <div className="mt-8 flex gap-4">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-emerald-400"
            >
              Try Live Demo <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#problem"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              View Deck <ChevronRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </Section>

      {/* Slide 2: Problem */}
      <Section id="problem" className="bg-card/30">
        <SlideNumber n={2} total={TOTAL_SLIDES} />
        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">The Problem</h2>
            <p className="mt-2 text-lg text-muted-foreground max-w-3xl">
              RWA tokenization is a $16T opportunity, but managing RWA portfolios on-chain is broken.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
                <Layers className="h-5 w-5 text-red-400" />
              </div>
              <h3 className="font-semibold">Fragmented Data</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                RWA yields, risk profiles, and compliance requirements are scattered across protocols. No unified view exists for portfolio decisions.
              </p>
            </div>
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
                <Scale className="h-5 w-5 text-red-400" />
              </div>
              <h3 className="font-semibold">Compliance Blindspot</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Institutional investors need regulatory compliance checks before every trade. Current DeFi tools have zero compliance awareness.
              </p>
            </div>
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
                <Zap className="h-5 w-5 text-red-400" />
              </div>
              <h3 className="font-semibold">Manual Execution</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Portfolio rebalancing, yield optimization, and risk management require constant manual intervention across multiple protocols.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
            <p className="text-center text-lg font-medium text-amber-300">
              Result: Institutional capital stays on the sidelines. Only $12B of the $16T addressable market is tokenized today.
            </p>
          </div>
        </div>
      </Section>

      {/* Slide 3: Solution */}
      <Section id="solution">
        <SlideNumber n={3} total={TOTAL_SLIDES} />
        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Our Solution</h2>
            <p className="mt-2 text-lg text-muted-foreground max-w-3xl">
              RWA Agent is a multi-agent AI system that automates the entire RWA investment lifecycle.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
            {[
              { icon: Brain, label: "Research Agent", desc: "Analyzes RWA markets, yield opportunities, and macro conditions", color: "violet" },
              { icon: Shield, label: "Risk Agent", desc: "Scores portfolio risk, monitors exposure, triggers alerts", color: "amber" },
              { icon: FileCheck, label: "Compliance Agent", desc: "Checks KYC/AML requirements, regulatory constraints per jurisdiction", color: "cyan" },
              { icon: TrendingUp, label: "Trading Agent", desc: "Executes swaps on PancakeSwap, manages DeFi positions on Venus", color: "emerald" },
              { icon: PieChart, label: "Portfolio Agent", desc: "Optimizes allocation across T-bills, gold, real estate tokens", color: "rose" },
            ].map(({ icon: Icon, label, desc, color }) => (
              <div
                key={label}
                className={`flex flex-col items-center gap-3 rounded-2xl border border-${color}-500/20 bg-${color}-500/5 p-5 text-center`}
              >
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-${color}-500/10`}>
                  <Icon className={`h-6 w-6 text-${color}-400`} />
                </div>
                <h3 className="text-sm font-semibold">{label}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
            <div className="flex flex-col sm:flex-row items-center gap-6 justify-center">
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-400">24/7</div>
                <div className="text-xs text-muted-foreground">Autonomous Operation</div>
              </div>
              <div className="hidden sm:block h-8 w-px bg-border" />
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-400">&lt;2s</div>
                <div className="text-xs text-muted-foreground">Decision Latency</div>
              </div>
              <div className="hidden sm:block h-8 w-px bg-border" />
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-400">5</div>
                <div className="text-xs text-muted-foreground">Specialized Agents</div>
              </div>
              <div className="hidden sm:block h-8 w-px bg-border" />
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-400">100%</div>
                <div className="text-xs text-muted-foreground">On-Chain Transparency</div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Slide 4: How It Works */}
      <Section id="how" className="bg-card/30">
        <SlideNumber n={4} total={TOTAL_SLIDES} />
        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">How It Works</h2>
            <p className="mt-2 text-lg text-muted-foreground max-w-3xl">
              A continuous intelligence loop that turns market data into optimized RWA positions.
            </p>
          </div>
          <div className="relative">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  step: "01",
                  title: "Market Intelligence",
                  desc: "Research Agent monitors BNB Chain RWA protocols, yield rates, and macro conditions. Identifies opportunities in T-bills (USDY), gold (PAXG), and real estate tokens.",
                  icon: Globe,
                },
                {
                  step: "02",
                  title: "Risk & Compliance",
                  desc: "Risk Agent scores each opportunity. Compliance Agent verifies regulatory requirements, KYC status, and jurisdiction constraints before any position.",
                  icon: Shield,
                },
                {
                  step: "03",
                  title: "Execution",
                  desc: "Trading Agent routes through PancakeSwap for optimal swaps. Deposits into Venus Protocol for lending yield. All on BNB Chain.",
                  icon: Zap,
                },
                {
                  step: "04",
                  title: "Optimization",
                  desc: "Portfolio Agent continuously rebalances across RWA categories. Targets optimal risk-adjusted returns with configurable risk tolerance.",
                  icon: Target,
                },
              ].map(({ step, title, desc, icon: Icon }) => (
                <div key={step} className="flex flex-col gap-4 rounded-2xl border border-border/50 bg-card/50 p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-xs font-mono font-bold text-emerald-400">
                      {step}
                    </span>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border/50 bg-card/50 p-6">
            <h3 className="font-semibold mb-3">BNB Chain Integration Stack</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center text-sm">
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="font-medium">PancakeSwap</div>
                <div className="text-xs text-muted-foreground">DEX / Swaps</div>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="font-medium">Venus Protocol</div>
                <div className="text-xs text-muted-foreground">Lending / Yield</div>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="font-medium">USDY / PAXG</div>
                <div className="text-xs text-muted-foreground">RWA Tokens</div>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="font-medium">BNB RPC</div>
                <div className="text-xs text-muted-foreground">Chain Data</div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Slide 5: Tokenomics */}
      <Section id="tokenomics">
        <SlideNumber n={5} total={TOTAL_SLIDES} />
        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Tokenomics</h2>
            <p className="mt-2 text-lg text-muted-foreground max-w-3xl">
              The RWAI token aligns incentives between AI agents, portfolio managers, and liquidity providers.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Token Utility */}
            <div className="rounded-2xl border border-border/50 bg-card/50 p-6 space-y-5">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Coins className="h-5 w-5 text-emerald-400" /> Token Utility
              </h3>
              <div className="space-y-3">
                {[
                  { title: "Agent Access", desc: "Stake RWAI to unlock AI agent tiers (Basic, Pro, Institutional)" },
                  { title: "Performance Fees", desc: "0.5% of AUM paid in RWAI, distributed to stakers" },
                  { title: "Governance", desc: "Vote on supported RWA categories, risk parameters, and new protocol integrations" },
                  { title: "Yield Boost", desc: "RWAI stakers earn 1.5x yield multiplier on managed positions" },
                ].map(({ title, desc }) => (
                  <div key={title} className="flex gap-3">
                    <ChevronRight className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium text-sm">{title}</span>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Distribution */}
            <div className="rounded-2xl border border-border/50 bg-card/50 p-6 space-y-5">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <PieChart className="h-5 w-5 text-cyan-400" /> Distribution
              </h3>
              <div className="space-y-2">
                {[
                  { label: "Community & Ecosystem", pct: 40, color: "bg-emerald-500" },
                  { label: "Team & Advisors (2yr vest)", pct: 15, color: "bg-violet-500" },
                  { label: "Treasury & Development", pct: 20, color: "bg-cyan-500" },
                  { label: "Liquidity & Market Making", pct: 15, color: "bg-amber-500" },
                  { label: "Early Backers (1yr vest)", pct: 10, color: "bg-rose-500" },
                ].map(({ label, pct, color }) => (
                  <div key={label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>{label}</span>
                      <span className="font-mono text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-border/50 text-xs text-muted-foreground">
                Total Supply: 100,000,000 RWAI (fixed, no inflation)
              </div>
            </div>
          </div>
          {/* Yield Mechanics */}
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5 text-emerald-400" /> Revenue Model
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl bg-background/50 p-4 text-center">
                <div className="text-2xl font-bold text-emerald-400">0.5%</div>
                <div className="text-xs text-muted-foreground mt-1">AUM Management Fee</div>
              </div>
              <div className="rounded-xl bg-background/50 p-4 text-center">
                <div className="text-2xl font-bold text-emerald-400">10%</div>
                <div className="text-xs text-muted-foreground mt-1">Performance Fee on Profits</div>
              </div>
              <div className="rounded-xl bg-background/50 p-4 text-center">
                <div className="text-2xl font-bold text-emerald-400">$50/mo</div>
                <div className="text-xs text-muted-foreground mt-1">Pro Tier Subscription</div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Slide 6: Market Opportunity */}
      <Section id="market" className="bg-card/30">
        <SlideNumber n={6} total={TOTAL_SLIDES} />
        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Market Opportunity</h2>
            <p className="mt-2 text-lg text-muted-foreground max-w-3xl">
              RWA tokenization is the fastest-growing sector in DeFi, with BNB Chain positioning as a key hub.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard value="$16T" label="Total Addressable Market (Tokenizable Assets)" icon={Globe} />
            <StatCard value="$12B+" label="Currently Tokenized On-Chain" icon={BarChart3} />
            <StatCard value="68%" label="YoY Growth in RWA TVL" icon={TrendingUp} />
            <StatCard value="$2.1B" label="RWA TVL on BNB Chain" icon={Landmark} />
          </div>
          <div className="rounded-2xl border border-border/50 bg-card/50 p-6 space-y-4">
            <h3 className="font-semibold">Competitive Landscape on BNB Chain</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4">Protocol</th>
                    <th className="pb-2 pr-4">Focus</th>
                    <th className="pb-2 pr-4">AI Agents</th>
                    <th className="pb-2 pr-4">Compliance</th>
                    <th className="pb-2">Auto-Rebalance</th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {[
                    { name: "Avalon Finance", focus: "RWA Lending", ai: false, compliance: false, rebalance: false },
                    { name: "OpenEden", focus: "T-Bill Vaults", ai: false, compliance: true, rebalance: false },
                    { name: "Brickken", focus: "Tokenization", ai: false, compliance: true, rebalance: false },
                    { name: "RWA Agent (Us)", focus: "Full Portfolio", ai: true, compliance: true, rebalance: true },
                  ].map((row) => (
                    <tr key={row.name} className={`border-b border-border/30 ${row.name.includes("Us") ? "bg-emerald-500/5" : ""}`}>
                      <td className={`py-2 pr-4 font-medium ${row.name.includes("Us") ? "text-emerald-400" : ""}`}>{row.name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{row.focus}</td>
                      <td className="py-2 pr-4">{row.ai ? <span className="text-emerald-400">Yes</span> : <span className="text-muted-foreground">No</span>}</td>
                      <td className="py-2 pr-4">{row.compliance ? <span className="text-emerald-400">Yes</span> : <span className="text-muted-foreground">No</span>}</td>
                      <td className="py-2">{row.rebalance ? <span className="text-emerald-400">Yes</span> : <span className="text-muted-foreground">No</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              No existing protocol combines AI-driven portfolio management with compliance-first RWA investing. RWA Agent is the first.
            </p>
          </div>
        </div>
      </Section>

      {/* Slide 7: Team */}
      <Section id="team">
        <SlideNumber n={7} total={TOTAL_SLIDES} />
        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Team</h2>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 max-w-2xl mx-auto">
            <div className="rounded-2xl border border-border/50 bg-card/50 p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 ring-1 ring-emerald-500/30 text-lg font-bold">
                  KS
                </div>
                <div>
                  <h3 className="font-semibold">Kamal Singh</h3>
                  <p className="text-xs text-muted-foreground">Founder & Lead Developer</p>
                </div>
              </div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>Full-stack blockchain developer with 4+ years building DeFi protocols and AI agent systems.</p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded bg-muted px-2 py-0.5">AI Agents</span>
                  <span className="rounded bg-muted px-2 py-0.5">DeFi</span>
                  <span className="rounded bg-muted px-2 py-0.5">BNB Chain</span>
                  <span className="rounded bg-muted px-2 py-0.5">Solidity</span>
                </div>
              </div>
              <div className="flex gap-3 text-xs">
                <a href="https://github.com/kamalbuilds" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                  GitHub
                </a>
                <a href="https://x.com/0xkamal7" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                  Twitter/X
                </a>
              </div>
            </div>
            <div className="rounded-2xl border border-border/50 bg-card/50 p-6 space-y-4 flex flex-col items-center justify-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted/50 ring-1 ring-border text-lg">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-semibold">AI Agent Team</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                5 specialized AI agents powered by Claude, each with distinct expertise in research, risk, compliance, trading, and portfolio optimization.
              </p>
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400 ring-1 ring-emerald-500/20">
                Always Online
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* Slide 8: Roadmap */}
      <Section id="roadmap" className="bg-card/30">
        <SlideNumber n={8} total={TOTAL_SLIDES} />
        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Roadmap</h2>
            <p className="mt-2 text-lg text-muted-foreground max-w-3xl">
              From hackathon prototype to institutional-grade RWA management platform.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                phase: "Q1 2026",
                title: "Foundation",
                status: "current",
                items: [
                  "5-agent system architecture",
                  "BNB Chain integration (PancakeSwap, Venus)",
                  "Real-time dashboard with agent visibility",
                  "RWA Demo Day launch",
                ],
              },
              {
                phase: "Q2 2026",
                title: "Protocol Expansion",
                status: "next",
                items: [
                  "RWAI token launch on BNB Chain",
                  "Integrate Avalon Finance, OpenEden vaults",
                  "Advanced risk models (VaR, stress testing)",
                  "Multi-chain support (Ethereum, Arbitrum)",
                ],
              },
              {
                phase: "Q3 2026",
                title: "Institutional",
                status: "future",
                items: [
                  "Institutional API access",
                  "Custom compliance rule engine",
                  "Whitelabel dashboard for fund managers",
                  "Audit by QuillAudits / CertiK",
                ],
              },
              {
                phase: "Q4 2026",
                title: "Scale",
                status: "future",
                items: [
                  "$100M+ AUM target",
                  "DAO governance launch",
                  "Cross-chain RWA aggregation",
                  "AI model fine-tuning on RWA data",
                ],
              },
            ].map(({ phase, title, status, items }) => (
              <div
                key={phase}
                className={`rounded-2xl border p-6 space-y-4 ${
                  status === "current"
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-border/50 bg-card/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">{phase}</span>
                  {status === "current" && (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-500/20">
                      NOW
                    </span>
                  )}
                </div>
                <h3 className="font-semibold">{title}</h3>
                <ul className="space-y-1.5">
                  {items.map((item) => (
                    <li key={item} className="flex gap-2 text-xs text-muted-foreground">
                      <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-emerald-400/50" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* CTA Footer */}
      <section className="flex flex-col items-center justify-center px-6 py-20 text-center gap-6 border-t border-border/50">
        <h2 className="text-3xl font-bold tracking-tight">Ready to see it in action?</h2>
        <p className="text-muted-foreground max-w-lg">
          RWA Agent is live on BNB Chain testnet. Watch the AI agents analyze markets, assess risk, and execute trades in real-time.
        </p>
        <div className="flex gap-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-emerald-400"
          >
            Open Live Dashboard <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="https://github.com/kamalbuilds/rwa-agent"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            View Source Code <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>
    </div>
  );
}
