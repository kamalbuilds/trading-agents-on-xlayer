import { execFile } from 'child_process';
import { promisify } from 'util';
import { access } from 'fs/promises';

const execFileAsync = promisify(execFile);

// ============================================================
// Type Definitions
// ============================================================

export interface SwapResult {
  txHash: string;
  fromToken: string;
  toToken: string;
  amountIn: number;
  amountOut: number;
  priceImpact: number;
  gasUsed: number;
  timestamp: number;
}

export interface TxResult {
  txHash: string;
  status: 'success' | 'failed' | 'pending';
  gasUsed: number;
  blockNumber: number;
  timestamp: number;
}

export interface PortfolioInfo {
  address: string;
  totalValueUsd: number;
  tokens: Array<{ token: string; balance: number; usdValue: number }>;
}

export interface BalanceInfo {
  token: string;
  balance: number;
  usdValue: number;
}

// ============================================================
// OnchainOS Client
// ============================================================

export class OnchainOSClient {
  private cliPath: string;
  private timeout: number = 30000; // 30 seconds

  constructor(cliPath?: string) {
    this.cliPath = cliPath || '/Users/kamal/.onchainos/bin/onchainos';
  }

  /**
   * Check if the onchainos binary exists
   */
  private async isBinaryAvailable(): Promise<boolean> {
    try {
      await access(this.cliPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a CLI command and return JSON output
   */
  private async executeCommand(args: string[]): Promise<Record<string, unknown>> {
    const available = await this.isBinaryAvailable();
    if (!available) {
      throw new Error(
        `OnchainOS CLI not found at ${this.cliPath}. Please install onchainos CLI first.`
      );
    }

    try {
      const { stdout, stderr } = await execFileAsync(this.cliPath, args, {
        timeout: this.timeout,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (stderr) {
        console.error(`OnchainOS CLI stderr:`, stderr);
      }

      if (!stdout) {
        throw new Error('Empty response from OnchainOS CLI');
      }

      try {
        return JSON.parse(stdout);
      } catch (parseErr) {
        throw new Error(
          `Failed to parse CLI output as JSON: ${stdout.substring(0, 500)}`
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('ETIMEDOUT')) {
          throw new Error(`OnchainOS CLI command timed out after ${this.timeout}ms`);
        }
        throw new Error(`OnchainOS CLI error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get the wallet address
   */
  async getWalletAddress(): Promise<string> {
    try {
      const result = await this.executeCommand(['wallet', 'address', '--json']);
      const address = result.address || result.wallet || result.result;

      if (!address || typeof address !== 'string') {
        throw new Error('Invalid response format: missing address field');
      }

      return address;
    } catch (error) {
      console.error('Error getting wallet address:', error);
      throw error;
    }
  }

  /**
   * Get balance for a specific token or all tokens
   */
  async getBalance(token?: string): Promise<BalanceInfo> {
    try {
      const args = ['wallet', 'balance', '--json'];
      if (token) {
        args.push('--token', token);
      }

      const result = await this.executeCommand(args);

      // Handle various response formats
      let balance = 0;
      let usdValue = 0;
      let resultToken = token || 'ETH';

      if ('balance' in result) {
        balance = Number(result.balance) || 0;
      } else if ('amount' in result) {
        balance = Number(result.amount) || 0;
      }

      if ('usdValue' in result) {
        usdValue = Number(result.usdValue) || 0;
      } else if ('value' in result) {
        usdValue = Number(result.value) || 0;
      }

      if ('token' in result && typeof result.token === 'string') {
        resultToken = result.token;
      }

      return {
        token: resultToken,
        balance,
        usdValue,
      };
    } catch (error) {
      console.error('Error getting balance:', error);
      throw error;
    }
  }

  /**
   * Execute a token swap on DEX
   */
  async swap(params: {
    fromToken: string;
    toToken: string;
    amount: number;
    slippage?: number;
  }): Promise<SwapResult> {
    try {
      const args = [
        'swap',
        '--from',
        params.fromToken,
        '--to',
        params.toToken,
        '--amount',
        String(params.amount),
        '--json',
      ];

      if (params.slippage !== undefined) {
        args.push('--slippage', String(params.slippage));
      }

      const result = await this.executeCommand(args);

      const txHash = String(result.txHash || result.hash || result.tx || '');
      const amountIn = Number(result.amountIn || result.amountInReceived || params.amount);
      const amountOut = Number(result.amountOut || result.amountOutReceived || 0);
      const priceImpact = Number(result.priceImpact || 0);
      const gasUsed = Number(result.gasUsed || result.gas || 0);
      const timestamp = Number(result.timestamp || Date.now());

      if (!txHash) {
        throw new Error('Swap failed: no transaction hash returned');
      }

      return {
        txHash,
        fromToken: params.fromToken,
        toToken: params.toToken,
        amountIn,
        amountOut,
        priceImpact,
        gasUsed,
        timestamp,
      };
    } catch (error) {
      console.error('Error executing swap:', error);
      throw error;
    }
  }

  /**
   * Send tokens to an address
   */
  async send(params: {
    to: string;
    amount: number;
    token: string;
  }): Promise<TxResult> {
    try {
      const args = [
        'send',
        '--to',
        params.to,
        '--amount',
        String(params.amount),
        '--token',
        params.token,
        '--json',
      ];

      const result = await this.executeCommand(args);

      const txHash = String(result.txHash || result.hash || result.tx || '');
      const status = (result.status as string | undefined)?.toLowerCase() as
        | 'success'
        | 'failed'
        | 'pending' || 'success';
      const gasUsed = Number(result.gasUsed || result.gas || 0);
      const blockNumber = Number(result.blockNumber || result.block || 0);
      const timestamp = Number(result.timestamp || Date.now());

      if (!txHash) {
        throw new Error('Send failed: no transaction hash returned');
      }

      return {
        txHash,
        status,
        gasUsed,
        blockNumber,
        timestamp,
      };
    } catch (error) {
      console.error('Error sending tokens:', error);
      throw error;
    }
  }

  /**
   * Get portfolio information
   */
  async getPortfolio(): Promise<PortfolioInfo> {
    try {
      const result = await this.executeCommand(['portfolio', '--json']);

      const address = String(result.address || result.wallet || '');
      const totalValueUsd = Number(result.totalValueUsd || result.totalValue || 0);

      let tokens: Array<{ token: string; balance: number; usdValue: number }> = [];

      if (Array.isArray(result.tokens)) {
        tokens = result.tokens.map(
          (t: Record<string, unknown>) => ({
            token: String(t.token || t.symbol || ''),
            balance: Number(t.balance || t.amount || 0),
            usdValue: Number(t.usdValue || t.value || 0),
          })
        );
      } else if (result.tokens && typeof result.tokens === 'object') {
        tokens = Object.entries(result.tokens).map(([symbol, data]) => {
          const tokenData = data as Record<string, unknown>;
          return {
            token: symbol,
            balance: Number(tokenData.balance || tokenData.amount || 0),
            usdValue: Number(tokenData.usdValue || tokenData.value || 0),
          };
        });
      }

      if (!address) {
        throw new Error('Portfolio response missing address');
      }

      return {
        address,
        totalValueUsd,
        tokens,
      };
    } catch (error) {
      console.error('Error getting portfolio:', error);
      throw error;
    }
  }

  /**
   * Set a custom timeout for CLI commands (in milliseconds)
   */
  setCommandTimeout(ms: number): void {
    if (ms > 0) {
      this.timeout = ms;
    }
  }

  /**
   * Get the current CLI path
   */
  getCliPath(): string {
    return this.cliPath;
  }
}

// ============================================================
// Singleton Instance and Factory
// ============================================================

let defaultClient: OnchainOSClient | null = null;

/**
 * Get or create the default OnchainOS client instance
 */
export function getOnchainOSClient(cliPath?: string): OnchainOSClient {
  if (!defaultClient) {
    defaultClient = new OnchainOSClient(cliPath);
  }
  return defaultClient;
}

/**
 * Create a new OnchainOS client instance
 */
export function createOnchainOSClient(cliPath?: string): OnchainOSClient {
  return new OnchainOSClient(cliPath);
}
