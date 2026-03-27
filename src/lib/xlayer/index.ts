// X Layer module re-exports
// Includes OnchainOS client wrapper and other X Layer integrations

// ============================================================
// OnchainOS Client
// ============================================================
export {
  OnchainOSClient,
  getOnchainOSClient,
  createOnchainOSClient,
} from './onchainos-client';

export type {
  SwapResult,
  TxResult,
  PortfolioInfo,
  BalanceInfo,
} from './onchainos-client';

// ============================================================
// DEX Executor
// ============================================================
export {
  executeXLayerSwap,
  executeXLayerSignal,
  mapPairToTokens,
  getXLayerConfig,
  configureXLayer,
  setXLayerEnabled,
  isXLayerEnabled,
  setMaxSlippage,
  getMaxSlippage,
  getCliPath,
} from './dex-executor';

export type {
  XLayerSwapParams,
  XLayerExecutorConfig,
} from './dex-executor';

// ============================================================
// X402 Payments
// ============================================================
export {
  PaymentChannel,
  PaymentRouter,
  getPaymentRouter,
  getServicePrice,
  getAllServicePricing,
} from './x402-payments';

export type {
  PaymentReceipt,
  PaymentLedger,
  AgentServicePricing,
} from './x402-payments';
