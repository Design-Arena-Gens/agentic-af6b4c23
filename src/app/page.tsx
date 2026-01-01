'use client';

import { useCallback, useEffect, useMemo, useState } from "react";

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
}

interface ScanResponse {
  timestamp: number;
  movers: EvaluatedSymbol[];
  strongest: EvaluatedSymbol[];
  all?: EvaluatedSymbol[];
  message?: string;
  error?: string;
}

const REFRESH_INTERVAL = 60_000;

export default function Home() {
  const [data, setData] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/scan", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Scan failed (${res.status})`);
      }
      const body = (await res.json()) as ScanResponse;
      if (body.error) {
        throw new Error(body.error);
      }
      setData(body);
      setLastUpdated(new Date(body.timestamp));
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to fetch live scan.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const timer = setInterval(() => {
      fetchData();
    }, REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchData]);

  const formattedTimestamp = useMemo(() => {
    if (!lastUpdated) return "Awaiting first scan...";
    return `${lastUpdated.toLocaleTimeString()} (${lastUpdated.toLocaleDateString()})`;
  }, [lastUpdated]);

  const hasSignals =
    data && data.movers && data.movers.length > 0 && !data.message;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-12 md:px-10">
        <header className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Binance Futures – Live Quant Scan
          </h1>
          <p className="text-sm text-slate-400">
            Fully real-time double-verified momentum analytics across every USDT
            perpetual contract on Binance Futures.
          </p>
          <div className="flex flex-col gap-2 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between">
            <span>Last refreshed: {formattedTimestamp}</span>
            <div className="flex items-center gap-4">
              <span>
                Auto-refresh: {Math.round(REFRESH_INTERVAL / 1000)}s cadence
              </span>
              <button
                type="button"
                onClick={fetchData}
                className="rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:bg-slate-800"
              >
                Force Live Refresh
              </button>
            </div>
          </div>
        </header>

        {loading && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-300">
            Pulling fresh Binance derivatives telemetry...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-700/60 bg-rose-900/40 p-6 text-sm text-rose-100">
            {error}
          </div>
        )}

        {!loading && data?.message && (
          <div className="rounded-lg border border-amber-700/60 bg-amber-900/30 p-6 text-base font-semibold text-amber-200">
            {data.message}
          </div>
        )}

        {hasSignals && data && (
          <div className="flex flex-col gap-8">
            <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6 shadow-lg shadow-slate-950/40">
              <h2 className="text-xl font-semibold text-slate-100">
                🚀 REAL-TIME MOVERS (Verified Market Scan)
              </h2>
              <p className="mt-3 text-sm text-slate-300">
                • Coins currently showing strong movement potential:
              </p>
              <ol className="mt-3 space-y-2 pl-4 text-sm text-slate-200">
                {data.movers.slice(0, 5).map((coin, idx) => (
                  <li key={coin.symbol}>
                    {idx + 1}. {coin.symbol} — {coin.movementStatus} (
                    {coin.direction} bias, risk {coin.riskScore.toFixed(1)}/10,
                    confidence {coin.confidence})
                  </li>
                ))}
              </ol>
            </section>

            <section className="rounded-3xl border border-emerald-800/60 bg-emerald-950/20 p-6 shadow-lg shadow-emerald-950/40">
              <h2 className="text-xl font-semibold text-emerald-200">
                ⭐ DOUBLE-VERIFIED STRONGEST SETUPS
              </h2>
              <p className="mt-3 text-sm text-emerald-100">
                • Top 1–3 coins with highest real-time movement probability:
              </p>
              <ol className="mt-3 space-y-2 pl-4 text-sm text-emerald-100">
                {data.strongest.slice(0, 3).map((coin, idx) => (
                  <li key={coin.symbol}>
                    {idx + 1}. {coin.symbol} — {coin.reason}
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-6">
              {data.movers.map((coin) => (
                <article
                  key={coin.symbol}
                  className="rounded-3xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl shadow-slate-950/30"
                >
                  <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-100">
                        {coin.symbol}
                      </h3>
                      <p className="text-sm text-slate-300">
                        {coin.movementStatus} · {coin.reason}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200">
                      <span className="rounded-full border border-slate-700 px-3 py-1">
                        Risk {coin.riskScore.toFixed(1)}/10
                      </span>
                      <span className="rounded-full border border-slate-700 px-3 py-1">
                        Confidence: {coin.confidence}
                      </span>
                      <span className="rounded-full border border-slate-700 px-3 py-1">
                        Alignment: {coin.trendStrength}
                      </span>
                    </div>
                  </header>

                  <div className="space-y-2 text-sm text-slate-200">
                    <p>
                      • Movement Status (Moving Now / About To Move / Likely in
                      24H):{" "}
                      <span className="font-semibold text-slate-100">
                        {coin.movementStatus}
                      </span>
                    </p>
                    <p>
                      • Reason It Will Move:{" "}
                      <span className="text-slate-100">{coin.reason}</span>
                    </p>
                    <p>
                      • Live Trend Strength:{" "}
                      <span className="text-slate-100">
                        {coin.trendStrength}
                      </span>
                    </p>
                    <p>
                      • Live Volume Spike:{" "}
                      <span className="text-slate-100">
                        {coin.volumeSpike}
                      </span>
                    </p>
                    <p>
                      • Funding Rate (real-time):{" "}
                      <span className="text-slate-100">
                        {coin.fundingRate}
                      </span>
                    </p>
                    <p>
                      • Open Interest Change (real-time):{" "}
                      <span className="text-slate-100">
                        {coin.openInterestChange}
                      </span>
                    </p>
                    <p>
                      • Volatility Level:{" "}
                      <span className="text-slate-100">
                        {coin.volatility}
                      </span>
                    </p>
                    <p>
                      • Breakout/Bounce Signals:{" "}
                      <span className="text-slate-100">
                        {coin.breakoutSignal}
                      </span>
                    </p>
                    <p>
                      • Whale Activity:{" "}
                      <span className="text-slate-100">
                        {coin.whaleActivity}
                      </span>
                    </p>
                    <p>
                      • Risk Score (1–10):{" "}
                      <span className="text-slate-100">
                        {coin.riskScore.toFixed(1)}
                      </span>
                    </p>
                    <p>
                      • Confidence Level (Low/Medium/High):{" "}
                      <span className="text-slate-100">{coin.confidence}</span>
                    </p>
                    <div className="mt-4 space-y-2 rounded-2xl border border-emerald-700/50 bg-emerald-900/20 p-4 text-sm text-emerald-100">
                      <p className="font-semibold text-emerald-200">
                        📈 BINANCE FUTURES SIGNAL (Short & Clear)
                      </p>
                      <p>• Direction (Long/Short): {coin.direction}</p>
                      <p>• Entry: {formatPrice(coin.entry)}</p>
                      <p>
                        • TP1: {formatPrice(coin.takeProfits[0])}
                        {"  "}• TP2: {formatPrice(coin.takeProfits[1])}
                        {"  "}• TP3: {formatPrice(coin.takeProfits[2])}
                      </p>
                      <p>• Stop Loss: {formatPrice(coin.stopLoss)}</p>
                      <p>• Safe Leverage: {coin.safeLeverage}</p>
                      <p>• Confidence Level: {coin.confidence}</p>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          </div>
        )}

        <footer className="mt-8 border-t border-slate-800 pt-6 text-xs text-slate-500">
          ⚠️ FINAL NOTE — Only live market data is surfaced. Historical stats
          beyond the current active session are ignored. Signals apply strictly
          to Binance USDT-M perpetual futures. If market conditions flip to
          unsafe, recommendations will pause automatically.
        </footer>
      </main>
    </div>
  );
}

function formatPrice(price: number) {
  if (price >= 1000) return price.toFixed(1);
  if (price >= 100) return price.toFixed(2);
  if (price >= 10) return price.toFixed(3);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(5);
}
