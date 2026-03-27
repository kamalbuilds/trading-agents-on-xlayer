// Pair format normalizer
// Kraken uses XBTUSD format, strategies use BTC/USD format
// This utility converts between them and provides consistent matching

const KRAKEN_TO_STANDARD: Record<string, string> = {
  XBT: "BTC",
  XXBT: "BTC",
  XETH: "ETH",
  XXRP: "XRP",
  XLTC: "LTC",
  XXLM: "XLM",
  ZUSD: "USD",
  ZEUR: "EUR",
  ZGBP: "GBP",
  ZJPY: "JPY",
};

const STANDARD_TO_KRAKEN: Record<string, string> = {
  BTC: "XBT",
};

// Convert Kraken pair (XBTUSD) to standard format (BTC/USD)
export function krakenToStandard(krakenPair: string): string {
  // Already in standard format
  if (krakenPair.includes("/")) return krakenPair;

  // Try known mappings first
  // Handle XBTUSD, ETHUSD, SOLUSD patterns
  const knownBases = [
    { k: "XXBT", s: "BTC" },
    { k: "XBT", s: "BTC" },
    { k: "XETH", s: "ETH" },
    { k: "ETH", s: "ETH" },
    { k: "SOL", s: "SOL" },
    { k: "DOT", s: "DOT" },
    { k: "ADA", s: "ADA" },
    { k: "AVAX", s: "AVAX" },
    { k: "LINK", s: "LINK" },
    { k: "MATIC", s: "MATIC" },
    { k: "ATOM", s: "ATOM" },
    { k: "UNI", s: "UNI" },
    { k: "XXRP", s: "XRP" },
    { k: "XRP", s: "XRP" },
    { k: "XLTC", s: "LTC" },
    { k: "LTC", s: "LTC" },
    { k: "XXLM", s: "XLM" },
    { k: "XLM", s: "XLM" },
  ];

  const knownQuotes = [
    { k: "ZUSD", s: "USD" },
    { k: "USD", s: "USD" },
    { k: "ZEUR", s: "EUR" },
    { k: "EUR", s: "EUR" },
    { k: "ZGBP", s: "GBP" },
    { k: "GBP", s: "GBP" },
  ];

  const upper = krakenPair.toUpperCase();

  for (const base of knownBases) {
    if (upper.startsWith(base.k)) {
      const remainder = upper.slice(base.k.length);
      for (const quote of knownQuotes) {
        if (remainder === quote.k) {
          return `${base.s}/${quote.s}`;
        }
      }
      // Default quote is USD
      if (remainder === "" || remainder === "USD") {
        return `${base.s}/USD`;
      }
    }
  }

  // Fallback: assume last 3 chars are quote currency
  if (upper.length >= 6) {
    const base = upper.slice(0, -3);
    const quote = upper.slice(-3);
    const stdBase = KRAKEN_TO_STANDARD[base] ?? base;
    const stdQuote = KRAKEN_TO_STANDARD[quote] ?? quote;
    return `${stdBase}/${stdQuote}`;
  }

  return krakenPair;
}

// Convert standard pair (BTC/USD) to Kraken format (XBTUSD)
export function standardToKraken(standardPair: string): string {
  // Already in Kraken format (no slash)
  if (!standardPair.includes("/")) return standardPair;

  const [base, quote] = standardPair.split("/");
  const krakenBase = STANDARD_TO_KRAKEN[base] ?? base;
  return `${krakenBase}${quote}`;
}

// Normalize any pair format to standard (BTC/USD)
export function normalizePair(pair: string): string {
  if (pair.includes("/")) return pair.toUpperCase();
  return krakenToStandard(pair);
}

// Check if two pairs refer to the same instrument
export function pairsMatch(a: string, b: string): boolean {
  return normalizePair(a) === normalizePair(b);
}
