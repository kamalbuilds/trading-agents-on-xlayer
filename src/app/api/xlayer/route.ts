// ============================================================
// X Layer API Route
// Provides endpoints for X Layer DEX operations and wallet management.
// Supports swaps, balance queries, portfolio info, x402 payments, and status.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { checkApiKey, unauthorized } from '@/lib/auth';
import {
  executeXLayerSwap,
  executeXLayerSignal,
  getXLayerConfig,
  configureXLayer,
  mapPairToTokens,
  type XLayerSwapParams,
} from '@/lib/xlayer/dex-executor';
import {
  getOnchainOSClient,
  type SwapResult,
  type BalanceInfo,
  type PortfolioInfo,
} from '@/lib/xlayer';

// ============================================================
// Type Definitions
// ============================================================

interface SwapRequest {
  fromToken: string;
  toToken: string;
  amount: number;
  slippage?: number;
  pair?: string;
}

interface BalanceRequest {
  token?: string;
}

interface PaymentRequest {
  to: string;
  amount: number;
  service: string;
  memo?: string;
}

interface XLayerAPIRequest {
  action: 'swap' | 'balance' | 'portfolio' | 'pay' | 'status';
  [key: string]: unknown;
}

interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================
// Utilities
// ============================================================


/**
 * Add CORS headers to response
 */
function addCORSHeaders(response: NextResponse): NextResponse {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

// ============================================================
// API Handlers
// ============================================================

/**
 * POST /api/xlayer
 * Main API endpoint for X Layer operations
 * Routes requests based on action field in request body
 */
export async function POST(request: NextRequest) {
  if (!checkApiKey(request)) {
    return addCORSHeaders(
      NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    );
  }

  try {
    const body = (await request.json()) as XLayerAPIRequest;
    const { action, ...params } = body;

    if (!action) {
      return addCORSHeaders(
        NextResponse.json(
          { success: false, error: 'Missing action field' },
          { status: 400 }
        )
      );
    }

    let result: APIResponse;

    switch (action) {
      case 'swap':
        result = await handleSwap(params);
        break;

      case 'balance':
        result = await handleBalance(params);
        break;

      case 'portfolio':
        result = await handlePortfolio();
        break;

      case 'pay':
        result = await handlePayment(params);
        break;

      case 'status':
        result = handleStatus();
        break;

      default:
        result = { success: false, error: `Unknown action: ${action}` };
    }

    const statusCode = result.success ? 200 : 400;
    return addCORSHeaders(NextResponse.json(result, { status: statusCode }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return addCORSHeaders(
      NextResponse.json(
        { success: false, error: `API error: ${message}` },
        { status: 500 }
      )
    );
  }
}

/**
 * GET /api/xlayer
 * Returns X Layer integration status and configuration
 */
export async function GET(request: NextRequest) {
  if (!checkApiKey(request)) return unauthorized();

  try {
    const result = handleStatus();
    return addCORSHeaders(NextResponse.json(result, { status: 200 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return addCORSHeaders(
      NextResponse.json(
        { success: false, error: `Failed to get status: ${message}` },
        { status: 500 }
      )
    );
  }
}

/**
 * OPTIONS request handler for CORS preflight
 */
export async function OPTIONS() {
  const response = new NextResponse(null, { status: 204 });
  return addCORSHeaders(response);
}

// ============================================================
// Action Handlers
// ============================================================

/**
 * Handle swap action
 * Executes a token swap on X Layer DEX
 */
async function handleSwap(params: unknown): Promise<APIResponse> {
  const swapParams = params as SwapRequest;

  if (!swapParams.fromToken || !swapParams.toToken || !swapParams.amount) {
    return {
      success: false,
      error: 'Missing required fields: fromToken, toToken, amount',
    };
  }

  if (swapParams.amount <= 0) {
    return { success: false, error: 'Amount must be positive' };
  }

  try {
    const pair = swapParams.pair || `${swapParams.fromToken}/${swapParams.toToken}`;

    const xlayerSwapParams: XLayerSwapParams = {
      fromToken: swapParams.fromToken,
      toToken: swapParams.toToken,
      amount: swapParams.amount,
      slippage: swapParams.slippage,
      pair,
    };

    const order = await executeXLayerSwap(xlayerSwapParams);

    return {
      success: true,
      data: {
        orderId: order.id,
        pair: order.pair,
        status: order.status,
        amount: order.amount,
        filled: order.filled,
        fee: order.fee,
        timestamp: order.timestamp,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Swap failed: ${message}` };
  }
}

/**
 * Handle balance action
 * Gets wallet balance for a specific token or all tokens
 */
async function handleBalance(params: unknown): Promise<APIResponse> {
  const balanceParams = params as BalanceRequest;

  try {
    const client = getOnchainOSClient();
    const balance = await client.getBalance(balanceParams.token);

    return {
      success: true,
      data: {
        token: balance.token,
        balance: balance.balance,
        usdValue: balance.usdValue,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to get balance: ${message}` };
  }
}

/**
 * Handle portfolio action
 * Gets complete portfolio information including all tokens and total value
 */
async function handlePortfolio(): Promise<APIResponse> {
  try {
    const client = getOnchainOSClient();
    const portfolio = await client.getPortfolio();

    return {
      success: true,
      data: {
        address: portfolio.address,
        totalValueUsd: portfolio.totalValueUsd,
        tokens: portfolio.tokens.map((t) => ({
          token: t.token,
          balance: t.balance,
          usdValue: t.usdValue,
        })),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to get portfolio: ${message}` };
  }
}

/**
 * Handle payment action
 * Execute x402 payment for API access or services
 */
async function handlePayment(params: unknown): Promise<APIResponse> {
  const paymentParams = params as PaymentRequest;

  if (!paymentParams.to || !paymentParams.amount || !paymentParams.service) {
    return {
      success: false,
      error: 'Missing required fields: to, amount, service',
    };
  }

  if (paymentParams.amount <= 0) {
    return { success: false, error: 'Amount must be positive' };
  }

  try {
    const client = getOnchainOSClient();

    // Use default stablecoin for payments (typically USDC)
    const txResult = await client.send({
      to: paymentParams.to,
      amount: paymentParams.amount,
      token: 'USDC',
    });

    return {
      success: true,
      data: {
        txHash: txResult.txHash,
        status: txResult.status,
        service: paymentParams.service,
        amount: paymentParams.amount,
        memo: paymentParams.memo,
        timestamp: txResult.timestamp,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Payment failed: ${message}` };
  }
}

/**
 * Handle status action
 * Returns X Layer integration status and configuration
 */
function handleStatus(): APIResponse {
  try {
    const config = getXLayerConfig();

    return {
      success: true,
      data: {
        status: 'operational',
        xlayer: {
          enabled: config.enabled,
          maxSlippage: config.maxSlippage,
          gasLimit: config.gasLimit,
        },
        onchainos: {
          installed: true,
          cli_path: '/Users/kamal/.onchainos/bin/onchainos',
        },
        features: {
          swap: true,
          balance: true,
          portfolio: true,
          payment: true,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to get status: ${message}` };
  }
}
