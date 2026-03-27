// ============================================================
// X Layer DEX Executor
// Extends trading executor to support X Layer DEX execution via OnchainOS.
// Handles swap execution, pair mapping, and signal conversion.
// ============================================================

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TradeSignal, Order } from '@/lib/types';

const execFileAsync = promisify(execFile);
const CLI_PATH = '/Users/kamal/.onchainos/bin/onchainos';

// ============================================================
// Type Definitions
// ============================================================

export interface XLayerSwapParams {
  fromToken: string;
  toToken: string;
  amount: number;
  slippage?: number;
  pair: string;
}

export interface XLayerExecutorConfig {
  maxSlippage: number;
  gasLimit: number;
  enabled: boolean;
}

interface SwapCLIResult {
  txHash?: string;
  hash?: string;
  tx?: string;
  amountIn?: number;
  amountInReceived?: number;
  amountOut?: number;
  amountOutReceived?: number;
  priceImpact?: number;
  gasUsed?: number;
  gas?: number;
  timestamp?: number;
  status?: string;
  error?: string;
}

// ============================================================
// Configuration
// ============================================================

const defaultConfig: XLayerExecutorConfig = {
  maxSlippage: 1.0, // 1% default
  gasLimit: 500000,
  enabled: true,
};

let config: XLayerExecutorConfig = { ...defaultConfig };

// ============================================================
// Public API
// ============================================================

/**
 * Get current X Layer executor configuration
 */
export function getXLayerConfig(): XLayerExecutorConfig {
  return { ...config };
}

/**
 * Configure X Layer executor settings
 */
export function configureXLayer(opts: Partial<XLayerExecutorConfig>): void {
  config = { ...config, ...opts };
}

/**
 * Map trading pair to from/to token symbols
 * Examples: "BTC/USDT" -> { base: "BTC", quote: "USDT" }
 *           "ETH/USDC" -> { base: "ETH", quote: "USDC" }
 */
export function mapPairToTokens(pair: string): { base: string; quote: string } {
  const parts = pair.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid pair format: ${pair}. Expected format: BASE/QUOTE`);
  }

  const [base, quote] = parts;
  if (!base || !quote) {
    throw new Error(`Invalid pair format: ${pair}. Base and quote must not be empty`);
  }

  return {
    base: base.toUpperCase(),
    quote: quote.toUpperCase(),
  };
}

/**
 * Execute a swap on X Layer DEX via onchainos CLI
 * Constructs CLI command: onchainos swap --from TOKEN --to TOKEN --amount AMOUNT --slippage SLIPPAGE --output json
 */
export async function executeXLayerSwap(params: XLayerSwapParams): Promise<Order> {
  if (!config.enabled) {
    throw new Error('X Layer DEX executor is disabled');
  }

  if (params.amount <= 0) {
    throw new Error('Swap amount must be positive');
  }

  const slippage = params.slippage ?? config.maxSlippage;
  if (slippage < 0 || slippage > 100) {
    throw new Error(`Slippage must be between 0 and 100, got ${slippage}`);
  }

  try {
    // Build CLI arguments
    const args = [
      'swap',
      '--from',
      params.fromToken,
      '--to',
      params.toToken,
      '--amount',
      String(params.amount),
      '--slippage',
      String(slippage),
      '--output',
      'json',
    ];

    // Execute onchainos CLI command
    const { stdout, stderr } = await execFileAsync(CLI_PATH, args, {
      timeout: 30000, // 30 second timeout
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    if (stderr) {
      console.warn(`OnchainOS CLI warning: ${stderr}`);
    }

    if (!stdout) {
      throw new Error('Empty response from OnchainOS CLI');
    }

    // Parse JSON response
    let result: SwapCLIResult;
    try {
      result = JSON.parse(stdout) as SwapCLIResult;
    } catch (parseErr) {
      throw new Error(`Failed to parse CLI output as JSON: ${stdout.substring(0, 200)}`);
    }

    // Extract transaction hash (try multiple field names)
    const txHash = String(result.txHash || result.hash || result.tx || '');
    if (!txHash) {
      throw new Error('Swap failed: no transaction hash returned from onchainos');
    }

    // Convert to Order object
    const order: Order = {
      id: txHash,
      pair: params.pair,
      side: 'buy', // Always "buy" from perspective of acquiring toToken
      type: 'market',
      price: (params.amount / (Number(result.amountOut || 0) || 1)), // Approximate execution price
      amount: params.amount,
      filled: Number(result.amountOut || result.amountOutReceived || 0),
      status: 'filled',
      fee: Number(result.gasUsed || result.gas || 0),
      timestamp: Number(result.timestamp || Date.now()),
    };

    return order;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`X Layer swap execution failed: ${message}`);
  }
}

/**
 * Convert a TradeSignal to an X Layer swap and execute it
 * Automatically maps pair and determines swap direction based on signal side
 */
export async function executeXLayerSignal(signal: TradeSignal): Promise<Order> {
  if (!config.enabled) {
    throw new Error('X Layer DEX executor is disabled');
  }

  if (signal.amount <= 0) {
    throw new Error(`Invalid trade amount: ${signal.amount}`);
  }

  // Map pair to tokens
  const tokens = mapPairToTokens(signal.pair);

  // Determine swap direction from signal side
  const [fromToken, toToken] =
    signal.side === 'buy'
      ? [tokens.quote, tokens.base] // Buy BTC with USDT: swap USDT -> BTC
      : [tokens.base, tokens.quote]; // Sell BTC for USDT: swap BTC -> USDT

  // Execute swap
  const swapParams: XLayerSwapParams = {
    fromToken,
    toToken,
    amount: signal.amount,
    slippage: signal.metadata?.slippage ? Number(signal.metadata.slippage) : undefined,
    pair: signal.pair,
  };

  const order = await executeXLayerSwap(swapParams);

  // Preserve signal metadata in order
  return {
    ...order,
    strategy: signal.strategy,
    side: signal.side,
  };
}

/**
 * Enable/disable the X Layer DEX executor
 */
export function setXLayerEnabled(enabled: boolean): void {
  config.enabled = enabled;
}

/**
 * Check if X Layer DEX executor is enabled
 */
export function isXLayerEnabled(): boolean {
  return config.enabled;
}

/**
 * Set maximum slippage tolerance (in percentage)
 */
export function setMaxSlippage(slippagePercent: number): void {
  if (slippagePercent < 0 || slippagePercent > 100) {
    throw new Error(`Invalid slippage: must be between 0 and 100, got ${slippagePercent}`);
  }
  config.maxSlippage = slippagePercent;
}

/**
 * Get maximum slippage tolerance (in percentage)
 */
export function getMaxSlippage(): number {
  return config.maxSlippage;
}

/**
 * Get the onchainos CLI path being used
 */
export function getCliPath(): string {
  return CLI_PATH;
}
