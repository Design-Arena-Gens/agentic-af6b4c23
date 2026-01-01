const BASE_URL = "https://fapi.binance.com";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Binance request failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface FuturesSymbol {
  symbol: string;
  contractType: string;
  status: string;
  quoteAsset: string;
  baseAsset: string;
}

export interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
  count: number;
  highPrice: string;
  lowPrice: string;
  weightedAvgPrice: string;
}

export interface PremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  estimatedSettlePrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  interestRate: string;
  time: number;
}

export interface OpenInterestPoint {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  timestamp: number;
}

export type Kline = [
  number,
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
];

export async function fetchPerpetualSymbols(): Promise<FuturesSymbol[]> {
  const data = await fetchJson<{ symbols: FuturesSymbol[] }>(
    `${BASE_URL}/fapi/v1/exchangeInfo`,
  );
  return data.symbols.filter(
    (s) =>
      s.contractType === "PERPETUAL" &&
      s.status === "TRADING" &&
      s.quoteAsset === "USDT",
  );
}

export async function fetchTickers(): Promise<Ticker24h[]> {
  return fetchJson<Ticker24h[]>(`${BASE_URL}/fapi/v1/ticker/24hr`);
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit = 120,
): Promise<Kline[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });
  return fetchJson<Kline[]>(`${BASE_URL}/fapi/v1/klines?${params.toString()}`);
}

export async function fetchPremiumIndex(
  symbol: string,
): Promise<PremiumIndex> {
  return fetchJson<PremiumIndex>(`${BASE_URL}/fapi/v1/premiumIndex?symbol=${symbol}`);
}

export async function fetchOpenInterestHist(
  symbol: string,
  period: string,
  limit = 2,
): Promise<OpenInterestPoint[]> {
  const params = new URLSearchParams({
    symbol,
    period,
    limit: String(limit),
  });
  return fetchJson<OpenInterestPoint[]>(
    `${BASE_URL}/futures/data/openInterestHist?${params.toString()}`,
  );
}

export function parseKlines(
  klines: Kline[],
): { closes: number[]; highs: number[]; lows: number[]; volumes: number[] } {
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];
  for (const k of klines) {
    closes.push(Number(k[4]));
    highs.push(Number(k[2]));
    lows.push(Number(k[3]));
    volumes.push(Number(k[5]));
  }
  return { closes, highs, lows, volumes };
}
