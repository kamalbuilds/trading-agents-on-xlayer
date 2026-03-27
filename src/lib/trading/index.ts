// Trading module re-exports
export {
  executeSignal,
  executeBatch,
  cancelOrder,
  cancelAllOrders,
  configureExecutor,
  getExecutorConfig,
  placeOrder,
  placeStopLoss,
} from "./executor";
export type { ExecutionMode } from "./executor";

export {
  configurePortfolio,
  resetPortfolio,
  recordTrade,
  updatePrices,
  getPortfolioState,
  getPositions,
  getCompletedTrades,
} from "./portfolio";

export { tradingEvents } from "./events";
export type { TradingEventBus } from "./events";
