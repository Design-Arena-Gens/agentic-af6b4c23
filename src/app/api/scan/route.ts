import { NextResponse } from "next/server";
import pLimit from "p-limit";
import {
  fetchPerpetualSymbols,
  fetchTickers,
  fetchKlines,
  fetchPremiumIndex,
  fetchOpenInterestHist,
  parseKlines,
  type Ticker24h,
  type OpenInterestPoint,
} from "@/lib/binance";
import {
  ema,
  macd,
  rsi,
  volatilityPercent,
  volumeSpikeRatio,
} from "@/lib/indicators";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface BaseTickerSnapshot {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  volume: number;
  tradeCount: number;
  highPrice: number;
  lowPrice: number;
  weightedAvgPrice: number;
}

interface EvaluatedSymbol {
  symbol: string;
  movementStatus: "Moving Now" | "About To Move" | "Likely in 24H";
  reason: string;
  trendStrength: string;
  volumeSpike: string;
  fundingRate: string;
  openInterestChange: string;
  volatility: string;
  breakoutSignal: string;
  whaleActivity: string;
  riskScore: number;
  confidence: "Low" | "Medium" | "High";
  direction: "Long" | "Short";
  entry: number;
  takeProfits: number[];
  stopLoss: number;
  safeLeverage: string;
  compositeScore: number;
  metadata: {
    rsi1h: number;
    rsi4h: number;
    macd1h: number;
    macdHistogram1h: number;
    macd4h: number;
    macdHistogram4h: number;
    emaTrend1h: number;
    emaTrend4h: number;
    volumeSpikeRatio: number;
    openInterestDeltaPct: number;
    fundingRatePct: number;
    volatilityPct: number;
    priceChange24h: number;
  };
}

const MAX_DEEP_SYMBOLS = 25;
const limiter = pLimit(6);

export async function GET() {
  try {
    const [symbols, tickers] = await Promise.all([
      fetchPerpetualSymbols(),
      fetchTickers(),
    ]);
    const tradable = new Set(symbols.map((s) => s.symbol));
    const filteredTickers = tickers
      .filter((t) => tradable.has(t.symbol))
      .map(normalizeTicker)
      .filter((t) => t.quoteVolume > 2_000_000); // ignore illiquid pairs

    if (filteredTickers.length === 0) {
      return NextResponse.json({
        timestamp: Date.now(),
        movers: [],
        strongest: [],
        message: "NO SAFE FUTURES TRADE RIGHT NOW.",
      });
    }

    const preScored = filteredTickers
      .map((ticker) => ({
        ticker,
        preScore: preScoreTicker(ticker),
      }))
      .sort((a, b) => b.preScore - a.preScore)
      .slice(0, MAX_DEEP_SYMBOLS);

    const evaluated = (
      await Promise.all(
        preScored.map(({ ticker }) =>
          limiter(() => evaluateSymbol(ticker).catch(() => null)),
        ),
      )
    )
      .filter((item): item is EvaluatedSymbol => Boolean(item))
      .filter((item) => item.compositeScore >= 55)
      .sort((a, b) => b.compositeScore - a.compositeScore);

    if (evaluated.length === 0) {
      return NextResponse.json({
        timestamp: Date.now(),
        movers: [],
        strongest: [],
        message: "NO SAFE FUTURES TRADE RIGHT NOW.",
      });
    }

    return NextResponse.json({
      timestamp: Date.now(),
      movers: evaluated.slice(0, 5),
      strongest: evaluated.slice(0, 3),
      all: evaluated,
    });
  } catch (error) {
    console.error("scan-error", error);
    return NextResponse.json(
      {
        error: "Failed to run live Binance Futures scan.",
      },
      { status: 500 },
    );
  }
}

function normalizeTicker(ticker: Ticker24h): BaseTickerSnapshot {
  return {
    symbol: ticker.symbol,
    lastPrice: Number(ticker.lastPrice),
    priceChangePercent: Number(ticker.priceChangePercent),
    quoteVolume: Number(ticker.quoteVolume),
    volume: Number(ticker.volume),
    tradeCount: Number(ticker.count ?? 0),
    highPrice: Number(ticker.highPrice),
    lowPrice: Number(ticker.lowPrice),
    weightedAvgPrice: Number(ticker.weightedAvgPrice),
  };
}

function preScoreTicker(ticker: BaseTickerSnapshot): number {
  const priceMoveScore = Math.min(Math.abs(ticker.priceChangePercent) * 1.2, 25);
  const volumeScore = Math.min(Math.log10(ticker.quoteVolume + 1) * 12, 25);
  const range =
    ticker.lowPrice > 0 ? ((ticker.highPrice - ticker.lowPrice) / ticker.lowPrice) * 100 : 0;
  const rangeScore = Math.min(range, 20);
  const velocity = Math.abs(ticker.priceChangePercent) / Math.max(range, 1);
  const velocityScore = Math.min(velocity * 10, 15);
  const baseline = priceMoveScore + volumeScore + rangeScore + velocityScore;
  return baseline;
}

async function evaluateSymbol(
  ticker: BaseTickerSnapshot,
): Promise<EvaluatedSymbol | null> {
  const [klines1h, klines4h, klines15m, premium, oiHist] = await Promise.all([
    fetchKlines(ticker.symbol, "1h", 180),
    fetchKlines(ticker.symbol, "4h", 180),
    fetchKlines(ticker.symbol, "15m", 180),
    fetchPremiumIndex(ticker.symbol),
    fetchOpenInterestHist(ticker.symbol, "5m", 12),
  ]);

  if (klines1h.length < 30 || klines4h.length < 30) {
    return null;
  }

  const oneHour = parseKlines(klines1h);
  const fourHour = parseKlines(klines4h);
  const fifteenMin = parseKlines(klines15m);

  const lastPrice = oneHour.closes[oneHour.closes.length - 1];
  const rsi1h = rsi(oneHour.closes.slice(-120));
  const rsi4h = rsi(fourHour.closes.slice(-120));
  const macd1h = macd(oneHour.closes.slice(-160));
  const macd4h = macd(fourHour.closes.slice(-160));
  const ema21_1h = ema(oneHour.closes, 21).pop() ?? lastPrice;
  const ema50_1h = ema(oneHour.closes, 50).pop() ?? lastPrice;
  const ema21_4h = ema(fourHour.closes, 21).pop() ?? lastPrice;
  const ema50_4h = ema(fourHour.closes, 50).pop() ?? lastPrice;
  const emaTrend1h = (lastPrice - ema21_1h) / ema21_1h - (ema21_1h - ema50_1h) / ema50_1h;
  const emaTrend4h =
    (lastPrice - ema21_4h) / ema21_4h - (ema21_4h - ema50_4h) / ema50_4h;
  const volSpike1h = volumeSpikeRatio(oneHour.volumes);
  const volSpike15m = volumeSpikeRatio(fifteenMin.volumes);
  const volatility = volatilityPercent(oneHour.closes.slice(-48));
  const fundingRatePct = Number(premium.lastFundingRate) * 100;
  const oiChangePct = calculateOpenInterestDelta(oiHist);

  const breakout = detectBreakout(oneHour.highs, oneHour.lows, lastPrice);
  const longerBreakout = detectBreakout(fourHour.highs, fourHour.lows, lastPrice);

  const movementStatus = determineMovementStatus({
    priceChange: ticker.priceChangePercent,
    volSpike1h,
    volSpike15m,
    emaTrend1h,
    emaTrend4h,
    rsi1h,
    rsi4h,
    macdHist1h: macd1h.histogram,
    macdHist4h: macd4h.histogram,
    breakout,
    longerBreakout,
    oiChangePct,
    volatility,
  });

  const direction: "Long" | "Short" =
    emaTrend1h >= 0 && emaTrend4h >= 0 && rsi1h >= 48
      ? "Long"
      : emaTrend1h <= 0 && emaTrend4h <= 0 && rsi1h <= 52
        ? "Short"
        : emaTrend1h >= emaTrend4h
          ? "Long"
          : "Short";

  const compositeScore = buildCompositeScore({
    priceChange: ticker.priceChangePercent,
    volSpike1h,
    volSpike15m,
    emaTrend1h,
    emaTrend4h,
    macdHist1h: macd1h.histogram,
    macdHist4h: macd4h.histogram,
    rsi1h,
    rsi4h,
    breakout,
    longerBreakout,
    fundingRatePct,
    oiChangePct,
    volatility,
  });

  const riskScore = deriveRiskScore({
    volatility,
    fundingRatePct,
    oiChangePct,
    volSpike1h,
    volSpike15m,
  });

  const confidence = deriveConfidence(compositeScore, riskScore);

  const tpMultipliers =
    direction === "Long" ? [1.006, 1.012, 1.02] : [0.994, 0.988, 0.978];
  const stopMultiplier =
    direction === "Long"
      ? Math.max(0.986, 1 - Math.max(volatility / 150, 0.012))
      : Math.min(1.014, 1 + Math.max(volatility / 150, 0.012));
  const leverage =
    volatility < 2 ? "15-20x"
    : volatility < 3.5 ? "10-15x"
    : volatility < 5 ? "6-10x"
    : volatility < 7 ? "4-6x"
    : "3-4x";

  const reason = buildReason({
    direction,
    volSpike1h,
    volSpike15m,
    macdHist1h: macd1h.histogram,
    macdHist4h: macd4h.histogram,
    emaTrend1h,
    emaTrend4h,
    rsi1h,
    rsi4h,
    breakout,
    longerBreakout,
    oiChangePct,
  });

  const whaleActivity = describeWhaleActivity(volSpike1h, volSpike15m, oiChangePct);
  const volatilityDescriptor = describeVolatility(volatility);
  const breakoutSignal = describeBreakoutSignal(breakout, longerBreakout, direction);
  const trendStrength = describeTrendStrength({
    direction,
    emaTrend1h,
    emaTrend4h,
    rsi1h,
    rsi4h,
    macd1h: macd1h.macd,
    macdSignal1h: macd1h.signal,
  });

  return {
    symbol: ticker.symbol,
    movementStatus,
    reason,
    trendStrength,
    volumeSpike: `${volSpike1h.toFixed(2)}x (1H) / ${volSpike15m.toFixed(2)}x (15M)`,
    fundingRate: `${fundingRatePct.toFixed(3)}%`,
    openInterestChange: `${oiChangePct >= 0 ? "+" : ""}${oiChangePct.toFixed(2)}% (5m)`,
    volatility: volatilityDescriptor,
    breakoutSignal,
    whaleActivity,
    riskScore,
    confidence,
    direction,
    entry: roundToTickSize(lastPrice),
    takeProfits: tpMultipliers.map((m) => roundToTickSize(lastPrice * m)),
    stopLoss: roundToTickSize(lastPrice * stopMultiplier),
    safeLeverage: leverage,
    compositeScore,
    metadata: {
      rsi1h,
      rsi4h,
      macd1h: macd1h.macd,
      macdHistogram1h: macd1h.histogram,
      macd4h: macd4h.macd,
      macdHistogram4h: macd4h.histogram,
      emaTrend1h,
      emaTrend4h,
      volumeSpikeRatio: volSpike1h,
      openInterestDeltaPct: oiChangePct,
      fundingRatePct,
      volatilityPct: volatility,
      priceChange24h: ticker.priceChangePercent,
    },
  };
}

function calculateOpenInterestDelta(points: OpenInterestPoint[]): number {
  if (!points || points.length < 2) return 0;
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const latest = Number(sorted[sorted.length - 1].sumOpenInterest);
  const prev = Number(sorted[sorted.length - 2].sumOpenInterest);
  if (prev === 0) return 0;
  return ((latest - prev) / prev) * 100;
}

function detectBreakout(highs: number[], lows: number[], price: number) {
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  const referenceHighs = recentHighs.length ? recentHighs : highs;
  const referenceLows = recentLows.length ? recentLows : lows;
  const recentHigh = Math.max(...referenceHighs);
  const recentLow = Math.min(...referenceLows);
  const nearHigh = (price - recentHigh) / recentHigh;
  const nearLow = (price - recentLow) / recentLow;
  return {
    nearHigh,
    nearLow,
    isBreakout: nearHigh > -0.002,
    isBreakdown: nearLow < 0.002,
  };
}

function determineMovementStatus(params: {
  priceChange: number;
  volSpike1h: number;
  volSpike15m: number;
  emaTrend1h: number;
  emaTrend4h: number;
  rsi1h: number;
  rsi4h: number;
  macdHist1h: number;
  macdHist4h: number;
  breakout: ReturnType<typeof detectBreakout>;
  longerBreakout: ReturnType<typeof detectBreakout>;
  oiChangePct: number;
  volatility: number;
}): EvaluatedSymbol["movementStatus"] {
  const {
    priceChange,
    volSpike1h,
    volSpike15m,
    emaTrend1h,
    emaTrend4h,
    rsi1h,
    rsi4h,
    macdHist1h,
    macdHist4h,
    breakout,
    longerBreakout,
    oiChangePct,
    volatility,
  } = params;

  const strongMomentum =
    volSpike1h > 1.6 &&
    volSpike15m > 1.4 &&
    Math.abs(priceChange) > 1 &&
    Math.sign(macdHist1h) === Math.sign(macdHist4h) &&
    Math.abs(emaTrend1h) > 0.01 &&
    Math.abs(emaTrend4h) > 0.01 &&
    Math.abs(oiChangePct) > 0.5;

  if (strongMomentum || (breakout.isBreakout && longerBreakout.isBreakout && volatility > 2.5)) {
    return "Moving Now";
  }

  const alignedMomentum =
    (volSpike1h > 1.3 && Math.abs(emaTrend1h) > 0.006 && Math.abs(macdHist1h) > 0.0005) ||
    (volSpike15m > 1.2 && Math.abs(oiChangePct) > 0.3);

  if (
    alignedMomentum &&
    Math.sign(emaTrend1h) === Math.sign(emaTrend4h) &&
    Math.sign(macdHist1h) === Math.sign(macdHist4h) &&
    ((rsi1h > 52 && rsi4h > 50) || (rsi1h < 48 && rsi4h < 50))
  ) {
    return "About To Move";
  }

  return "Likely in 24H";
}

function buildCompositeScore(params: {
  priceChange: number;
  volSpike1h: number;
  volSpike15m: number;
  emaTrend1h: number;
  emaTrend4h: number;
  macdHist1h: number;
  macdHist4h: number;
  rsi1h: number;
  rsi4h: number;
  breakout: ReturnType<typeof detectBreakout>;
  longerBreakout: ReturnType<typeof detectBreakout>;
  fundingRatePct: number;
  oiChangePct: number;
  volatility: number;
}): number {
  const trendAlignment =
    Math.sign(params.emaTrend1h) === Math.sign(params.emaTrend4h) ? 1 : 0;
  const macdAlignment =
    Math.sign(params.macdHist1h) === Math.sign(params.macdHist4h) ? 1 : 0;
  const rsiAlignment =
    (params.rsi1h > 55 && params.rsi4h > 52) ||
    (params.rsi1h < 45 && params.rsi4h < 48)
      ? 1
      : 0;

  const breakFactor =
    (params.breakout.isBreakout ? 1 : 0) + (params.longerBreakout.isBreakout ? 0.8 : 0);
  const volScore =
    Math.min(params.volSpike1h * 15, 18) + Math.min(params.volSpike15m * 12, 15);
  const trendScore =
    Math.min(Math.abs(params.emaTrend1h) * 110, 18) +
    Math.min(Math.abs(params.emaTrend4h) * 90, 16);
  const macdScore =
    Math.min(Math.abs(params.macdHist1h) * 70000, 12) +
    Math.min(Math.abs(params.macdHist4h) * 40000, 10);
  const rsiScore = rsiAlignment ? 10 : 4;
  const oiScore = Math.min(Math.abs(params.oiChangePct) * 4, 12);
  const fundingPenalty = Math.max(Math.abs(params.fundingRatePct) - 0.03, 0) * 120;
  const volatilityScore = Math.min(params.volatility * 4, 15);
  const base = volScore + trendScore + macdScore + rsiScore + oiScore + volatilityScore;
  const alignmentBonus = (trendAlignment + macdAlignment + rsiAlignment) * 6;
  const breakoutBonus = breakFactor * 8;
  const composite = base + alignmentBonus + breakoutBonus - fundingPenalty;
  return Number.isFinite(composite) ? composite : 0;
}

function deriveRiskScore(params: {
  volatility: number;
  fundingRatePct: number;
  oiChangePct: number;
  volSpike1h: number;
  volSpike15m: number;
}): number {
  const volRisk = Math.min(params.volatility / 1.5, 6);
  const fundingRisk = Math.min(Math.abs(params.fundingRatePct) * 120, 4);
  const oiRisk = Math.max(0, 3 - Math.min(Math.abs(params.oiChangePct), 3));
  const volumeRisk =
    params.volSpike1h > 2.2 || params.volSpike15m > 2.2 ? 1.5 : params.volSpike1h < 1 ? 4 : 1;
  const raw = volRisk + fundingRisk + oiRisk + volumeRisk;
  return Math.max(1, Math.min(10, Number(raw.toFixed(1))));
}

function deriveConfidence(composite: number, riskScore: number): "Low" | "Medium" | "High" {
  if (composite > 90 && riskScore <= 4) return "High";
  if (composite > 70 && riskScore <= 6) return "Medium";
  return "Low";
}

function buildReason(params: {
  direction: "Long" | "Short";
  volSpike1h: number;
  volSpike15m: number;
  macdHist1h: number;
  macdHist4h: number;
  emaTrend1h: number;
  emaTrend4h: number;
  rsi1h: number;
  rsi4h: number;
  breakout: ReturnType<typeof detectBreakout>;
  longerBreakout: ReturnType<typeof detectBreakout>;
  oiChangePct: number;
}): string {
  const pieces: string[] = [];
  pieces.push(
    params.direction === "Long" ? "Bullish alignment across 1H/4H EMAs" : "Bearish alignment across 1H/4H EMAs",
  );
  if (params.volSpike1h > 1.5 || params.volSpike15m > 1.3) {
    pieces.push("Live volume expansion confirmed");
  }
  if (Math.sign(params.macdHist1h) === Math.sign(params.macdHist4h)) {
    pieces.push(`MACD momentum ${params.macdHist1h > 0 ? "positive" : "negative"} on 1H & 4H`);
  }
  if (params.breakout.isBreakout || params.longerBreakout.isBreakout) {
    pieces.push("Price pressing breakout liquidity");
  }
  if (Math.abs(params.oiChangePct) > 0.5) {
    pieces.push("Open interest rising with price action");
  }
  if (params.rsi1h > 65 || params.rsi4h > 60 || params.rsi1h < 35 || params.rsi4h < 40) {
    pieces.push(`RSI extremes reinforcing ${params.direction === "Long" ? "bullish" : "bearish"} drive`);
  }
  return pieces.join(" · ");
}

function describeWhaleActivity(
  volSpike1h: number,
  volSpike15m: number,
  oiChangePct: number,
): string {
  if (volSpike15m > 1.8 && Math.abs(oiChangePct) > 1.2) {
    return "Aggressive block flow detected (OI + volume spike)";
  }
  if (volSpike1h > 1.6 && Math.abs(oiChangePct) > 0.6) {
    return "Institutional flow building steadily";
  }
  if (volSpike1h < 1.1 && Math.abs(oiChangePct) < 0.2) {
    return "No notable whale footprints right now";
  }
  return "Moderate leveraged participation active";
}

function describeVolatility(volatility: number): string {
  if (volatility < 1.5) return `Calm ${volatility.toFixed(2)}%`;
  if (volatility < 3) return `Controlled ${volatility.toFixed(2)}%`;
  if (volatility < 5) return `Elevated ${volatility.toFixed(2)}%`;
  return `High ${volatility.toFixed(2)}%`;
}

function describeBreakoutSignal(
  breakout: ReturnType<typeof detectBreakout>,
  longerBreakout: ReturnType<typeof detectBreakout>,
  direction: "Long" | "Short",
): string {
  if (direction === "Long") {
    if (breakout.isBreakout) return "Testing intraday highs; watch for breakout follow-through";
    if (longerBreakout.isBreakout) return "Pressing 4H supply; breakout likely with sustained bids";
    if (breakout.nearLow < -0.001) return "Liquidity sweep completed; bounce expected";
    return "Range-bound but building pressure";
  }
  if (breakout.isBreakdown) return "Slipping beneath intraday support; breakdown watch";
  if (longerBreakout.isBreakdown) return "4H support vulnerable; short continuation favoured";
  if (breakout.nearHigh > -0.001) return "Liquidity grab above highs; reversal setup";
  return "Compression; fade rallies until momentum shifts";
}

function describeTrendStrength(params: {
  direction: "Long" | "Short";
  emaTrend1h: number;
  emaTrend4h: number;
  rsi1h: number;
  rsi4h: number;
  macd1h: number;
  macdSignal1h: number;
}): string {
  const slope1h = params.emaTrend1h * 100;
  const slope4h = params.emaTrend4h * 100;
  const macdDiff = params.macd1h - params.macdSignal1h;
  const slopeDescriptor =
    Math.abs(slope1h) > 1.2 && Math.abs(slope4h) > 0.8
      ? "Strong"
      : Math.abs(slope1h) > 0.6
        ? "Firm"
        : "Moderate";
  const rsiDescriptor =
    params.direction === "Long"
      ? `RSI ${params.rsi1h.toFixed(1)}/${params.rsi4h.toFixed(1)}`
      : `RSI ${params.rsi1h.toFixed(1)}/${params.rsi4h.toFixed(1)}`;
  const macdDescriptor = macdDiff > 0 ? "MACD accelerating" : "MACD flattening";
  return `${slopeDescriptor} ${params.direction.toLowerCase()} bias · ${rsiDescriptor} · ${macdDescriptor}`;
}

function roundToTickSize(price: number): number {
  if (price >= 1000) return Number(price.toFixed(1));
  if (price >= 100) return Number(price.toFixed(2));
  if (price >= 10) return Number(price.toFixed(3));
  if (price >= 1) return Number(price.toFixed(4));
  return Number(price.toFixed(5));
}
