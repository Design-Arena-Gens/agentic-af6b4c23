export function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const emaValues: number[] = [];
  let prevEma = values[0];
  emaValues.push(prevEma);
  for (let i = 1; i < values.length; i++) {
    const current = values[i];
    prevEma = current * k + prevEma * (1 - k);
    emaValues.push(prevEma);
  }
  return emaValues;
}

export function rsi(values: number[], period = 14): number {
  if (values.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  gains /= period;
  losses /= period;
  let avgGain = gains;
  let avgLoss = losses;
  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) {
      avgGain = (avgGain * (period - 1) + delta) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - delta) / period;
    }
  }
  if (avgLoss === 0) return 80;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macd: number; signal: number; histogram: number } {
  if (values.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  const fastEma = ema(values, fastPeriod);
  const slowEma = ema(values, slowPeriod);
  const macdSeries = values.map((_, idx) => fastEma[idx] - slowEma[idx]);
  const signalSeries = ema(macdSeries.slice(slowPeriod - 1), signalPeriod);
  const macdValue = macdSeries[macdSeries.length - 1];
  const signalValue = signalSeries[signalSeries.length - 1];
  return {
    macd: macdValue,
    signal: signalValue,
    histogram: macdValue - signalValue,
  };
}

export function standardDeviation(values: number[]): number {
  const mean = values.reduce((acc, val) => acc + val, 0) / values.length;
  const variance =
    values.reduce((acc, val) => acc + (val - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function volatilityPercent(closes: number[]): number {
  if (closes.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return standardDeviation(returns) * Math.sqrt(returns.length) * 100;
}

export function volumeSpikeRatio(volumes: number[], lookback = 20): number {
  if (volumes.length === 0) return 1;
  const slice = volumes.slice(-lookback - 1);
  if (slice.length < 2) return 1;
  const latest = slice[slice.length - 1];
  const rest = slice.slice(0, -1);
  const avg =
    rest.reduce((acc, val) => acc + val, 0) / (rest.length === 0 ? 1 : rest.length);
  if (avg === 0) return 1;
  return latest / avg;
}
