        # AgenticTradeX - Trading Agents on X Layer

        AI-powered multi-agent trading system built on OKX X Layer. Autonomous agents collaborate to analyze markets, generate trade signals, assess risk, and execute trades on-chain through X Layer DEX.

## Architecture

```
Market Data → Analysis Agents → Trade Signals → Risk Engine → DEX Executor (X Layer)
                                                      ↓
                                              x402 Agent Payments
```

### Core Components

- **Multi-Agent System**: Specialized agents for market analysis, signal generation, and risk assessment
- **Genetic Strategy Evolution**: Trading strategies that evolve and adapt using genetic algorithms
- **Risk Engine**: Position sizing, drawdown limits, correlation checks, signal freshness validation
- **X Layer DEX Executor**: Routes trades through X Layer DEX with configurable slippage and gas
- **x402 Agent Payments**: Micropayment system for agent-to-agent service billing
- **OnchainOS Integration**: CLI wrapper for wallet, swap, and portfolio operations

### Execution Modes

| Mode | Description |
|------|-------------|
| `paper` | Simulated trading with virtual portfolio |
| `live` | Real execution via connected exchange |
| `xlayer` | On-chain execution through X Layer DEX |

## Tech Stack

- **Frontend**: Next.js 15, React, TailwindCSS
- **Backend**: Next.js API routes, TypeScript
- **Blockchain**: X Layer (EVM, Chain ID 196/1952), viem
- **AI**: Multi-agent orchestration with genetic evolution
- **Payments**: x402 protocol for agent micropayments

## Getting Started

```bash
bun install
bun run dev
```

### Environment Variables

```
WALLET_KEY=<your-private-key>
```

## On-Chain Verification

**X Layer Testnet TX**: [`0xe38ab18d61ed1fcb6bb7a36e9df8ddf0dcfefd3a9807ed5d07ce76f09e7294fc`](https://www.okx.com/web3/explorer/xlayer-test/tx/0xe38ab18d61ed1fcb6bb7a36e9df8ddf0dcfefd3a9807ed5d07ce76f09e7294fc)

To send your own X Layer transaction:
```bash
bun run scripts/xlayer-tx.mjs
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/xlayer` | GET | System status |
| `/api/xlayer` | POST | Swap, balance, portfolio operations |
| `/api/trade` | POST | Submit trade signals through risk engine |
| `/api/status` | GET | Portfolio and system status |
| `/api/strategies` | GET | List active trading strategies |

## Live Demo

**Deployed at**: [app-dusky-two-11.vercel.app](https://app-dusky-two-11.vercel.app)

## Key Files

```
src/
├── lib/
│   ├── xlayer/
│   │   ├── onchainos-client.ts    # OnchainOS CLI wrapper
│   │   ├── x402-payments.ts       # Agent micropayment system
│   │   └── dex-executor.ts        # X Layer DEX trade routing
│   ├── agents/                    # Trading agent implementations
│   ├── risk/                      # Risk engine and position sizing
│   └── strategies/                # Genetic strategy evolution
├── app/
│   └── api/
│       ├── xlayer/route.ts        # X Layer API endpoint
│       ├── trade/route.ts         # Trade execution endpoint
│       └── status/route.ts        # System status endpoint
scripts/
└── xlayer-tx.mjs                  # X Layer testnet transaction script
```
