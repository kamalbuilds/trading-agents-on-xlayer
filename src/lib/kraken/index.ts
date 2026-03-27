// Kraken module re-exports
export { KrakenMcpClient, getKrakenClient, ensureConnected } from "./mcp-client";
export type { KrakenMcpClientOptions } from "./mcp-client";

export {
  getTicker,
  getTickers,
  getOHLC,
  getOrderBook,
  getRecentTrades,
  getSpread,
} from "./market-data";
export type { RecentTrade } from "./market-data";

export {
  getBalance,
  getExtendedBalance,
  getOpenOrders,
  getClosedOrders,
  getTradeHistory,
  queryOrders,
} from "./account";
export type { AccountBalance } from "./account";

export {
  initPaperTrading,
  paperBuy,
  paperSell,
  getPaperStatus,
  getPaperHistory,
  getPaperPositions,
  resetPaperTrading,
} from "./paper-trading";
export type { PaperAccount, PaperOrder } from "./paper-trading";
