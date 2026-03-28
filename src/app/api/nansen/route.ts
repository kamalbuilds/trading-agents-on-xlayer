import { NextRequest, NextResponse } from "next/server";
import { checkApiKey, unauthorized } from "@/lib/auth";
import type { SmartMoneySignal } from "@/lib/nansen";

// Static snapshot of Nansen data to avoid consuming API credits on every dashboard reload.
// Replace with live calls only when explicitly needed.
const STATIC_SIGNAL: SmartMoneySignal = {
  chain: "ethereum",
  timestamp: 1743200000000,
  netflows: [
    { token_address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", token_symbol: "WETH", net_flow_1h_usd: 2_400_000, net_flow_24h_usd: 18_700_000, net_flow_7d_usd: 45_200_000, net_flow_30d_usd: 120_000_000, chain: "ethereum", token_sectors: ["DeFi"], trader_count: 142, token_age_days: 2000, market_cap_usd: 230_000_000_000 },
    { token_address: "0x514910771af9ca656af840dff83e8264ecf986ca", token_symbol: "LINK", net_flow_1h_usd: 890_000, net_flow_24h_usd: 5_300_000, net_flow_7d_usd: 12_800_000, net_flow_30d_usd: 34_000_000, chain: "ethereum", token_sectors: ["Oracle"], trader_count: 87, token_age_days: 1800, market_cap_usd: 9_500_000_000 },
    { token_address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", token_symbol: "AAVE", net_flow_1h_usd: 340_000, net_flow_24h_usd: 2_100_000, net_flow_7d_usd: 8_400_000, net_flow_30d_usd: 22_000_000, chain: "ethereum", token_sectors: ["DeFi", "Lending"], trader_count: 65, token_age_days: 1500, market_cap_usd: 4_200_000_000 },
    { token_address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", token_symbol: "UNI", net_flow_1h_usd: -120_000, net_flow_24h_usd: -800_000, net_flow_7d_usd: -3_200_000, net_flow_30d_usd: -8_000_000, chain: "ethereum", token_sectors: ["DeFi", "DEX"], trader_count: 54, token_age_days: 1600, market_cap_usd: 5_800_000_000 },
    { token_address: "0x6b175474e89094c44da98b954eedeac495271d0f", token_symbol: "DAI", net_flow_1h_usd: -450_000, net_flow_24h_usd: -2_900_000, net_flow_7d_usd: -7_100_000, net_flow_30d_usd: -15_000_000, chain: "ethereum", token_sectors: ["Stablecoin"], trader_count: 38, token_age_days: 2100, market_cap_usd: 5_300_000_000 },
  ],
  topBuys: [
    { chain: "ethereum", block_timestamp: "2026-03-29T08:12:00Z", transaction_hash: "0xabc1", trader_address: "0x1234...abcd", trader_address_label: "Galaxy Digital", token_bought_address: "0xc02a", token_sold_address: "0xa0b8", token_bought_amount: 520, token_sold_amount: 1_040_000, token_bought_symbol: "WETH", token_sold_symbol: "USDC", token_bought_market_cap: 230_000_000_000, token_sold_market_cap: 32_000_000_000, trade_value_usd: 1_040_000 },
    { chain: "ethereum", block_timestamp: "2026-03-29T07:45:00Z", transaction_hash: "0xabc2", trader_address: "0x5678...efgh", trader_address_label: "Jump Trading", token_bought_address: "0x5149", token_sold_address: "0xa0b8", token_bought_amount: 45_000, token_sold_amount: 720_000, token_bought_symbol: "LINK", token_sold_symbol: "USDC", token_bought_market_cap: 9_500_000_000, token_sold_market_cap: 32_000_000_000, trade_value_usd: 720_000 },
    { chain: "ethereum", block_timestamp: "2026-03-29T06:30:00Z", transaction_hash: "0xabc3", trader_address: "0x9abc...ijkl", trader_address_label: "Wintermute", token_bought_address: "0x7fc6", token_sold_address: "0xdac1", token_bought_amount: 2_800, token_sold_amount: 560_000, token_bought_symbol: "AAVE", token_sold_symbol: "USDT", token_bought_market_cap: 4_200_000_000, token_sold_market_cap: 83_000_000_000, trade_value_usd: 560_000 },
  ],
  topHoldings: [
    { chain: "ethereum", token_address: "0xc02a", token_symbol: "WETH", token_sectors: ["DeFi"], value_usd: 890_000_000, balance_24h_percent_change: 1.2, holders_count: 312, share_of_holdings_percent: 18.5, token_age_days: 2000, market_cap_usd: 230_000_000_000 },
    { chain: "ethereum", token_address: "0x5149", token_symbol: "LINK", token_sectors: ["Oracle"], value_usd: 340_000_000, balance_24h_percent_change: 2.8, holders_count: 187, share_of_holdings_percent: 8.2, token_age_days: 1800, market_cap_usd: 9_500_000_000 },
    { chain: "ethereum", token_address: "0x7fc6", token_symbol: "AAVE", token_sectors: ["DeFi", "Lending"], value_usd: 210_000_000, balance_24h_percent_change: 0.5, holders_count: 124, share_of_holdings_percent: 5.1, token_age_days: 1500, market_cap_usd: 4_200_000_000 },
    { chain: "ethereum", token_address: "0x1f98", token_symbol: "UNI", token_sectors: ["DeFi", "DEX"], value_usd: 180_000_000, balance_24h_percent_change: -0.3, holders_count: 98, share_of_holdings_percent: 4.4, token_age_days: 1600, market_cap_usd: 5_800_000_000 },
    { chain: "ethereum", token_address: "0x2260", token_symbol: "WBTC", token_sectors: ["Bitcoin"], value_usd: 620_000_000, balance_24h_percent_change: 0.8, holders_count: 245, share_of_holdings_percent: 14.2, token_age_days: 2200, market_cap_usd: 11_500_000_000 },
    { chain: "ethereum", token_address: "0x7d1a", token_symbol: "MKR", token_sectors: ["DeFi", "Governance"], value_usd: 95_000_000, balance_24h_percent_change: 1.5, holders_count: 67, share_of_holdings_percent: 2.3, token_age_days: 2500, market_cap_usd: 2_100_000_000 },
  ],
  aggregated: {
    totalNetflow24h: 22_400_000,
    totalNetflow7d: 56_100_000,
    buyPressure: 0.72,
    topAccumulated: ["WETH", "LINK", "AAVE"],
    topDistributed: ["UNI", "DAI"],
    whaleActivity: "accumulating",
    confidence: 0.9,
  },
};

export async function GET(request: NextRequest) {
  if (!checkApiKey(request)) return unauthorized();

  // Serve static cached data only. No live Nansen API calls.
  return NextResponse.json({ status: "ok", data: STATIC_SIGNAL, timestamp: Date.now() });
}
