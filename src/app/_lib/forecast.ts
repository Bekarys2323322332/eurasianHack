/**
 * Savings forecast: what a month of videos would cost at three price levels,
 * from the average real cost of fresh runs (no reused recordings, no cached
 * script) in the cost logs.
 */
import type { CostSummary } from "./costView";

export interface ForecastBasis {
  /** Average real cost of one fresh video, voice included. */
  averageCostUsd: number;
  /** Average cost of the same video with the strong model everywhere, voice included. */
  averageBaselineUsd: number;
  videosCounted: number;
}

export interface ForecastFigures {
  strongUsd: number;
  routedUsd: number;
  reservedUsd: number;
  savedUsd: number;
}

export const FORECAST_LIMITS = {
  videos: { min: 10, max: 10_000, default: 1_000 },
  discount: { min: 0, max: 30, default: 20 },
} as const;

/** A fresh run is a job that recorded its own steps and paid for its script. */
export function isFreshRun(summary: CostSummary): boolean {
  return summary.modelStages.every((stage) => stage.cacheHits === 0) && summary.costUsd > 0;
}

/** Average fresh-run costs; null when no run qualifies. */
export function forecastBasis(summaries: CostSummary[]): ForecastBasis | null {
  const fresh = summaries.filter(isFreshRun);
  if (fresh.length === 0) return null;
  const total = fresh.reduce((sum, s) => sum + s.costUsd, 0);
  const baseline = fresh.reduce((sum, s) => sum + s.baselineCostUsd + (s.voice?.costUsd ?? 0), 0);
  return {
    averageCostUsd: total / fresh.length,
    averageBaselineUsd: baseline / fresh.length,
    videosCounted: fresh.length,
  };
}

/** Monthly figures for a volume and a reserved-capacity discount in percent. */
export function forecastMonthly(basis: ForecastBasis, videosPerMonth: number, discountPercent: number): ForecastFigures {
  const strongUsd = basis.averageBaselineUsd * videosPerMonth;
  const routedUsd = basis.averageCostUsd * videosPerMonth;
  const reservedUsd = routedUsd * (1 - discountPercent / 100);
  return { strongUsd, routedUsd, reservedUsd, savedUsd: strongUsd - reservedUsd };
}
