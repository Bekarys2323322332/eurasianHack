import { describe, expect, it } from "vitest";
import type { CostSummary } from "../src/app/_lib/costView";
import { forecastBasis, forecastMonthly, isFreshRun } from "../src/app/_lib/forecast";

function summary(costUsd: number, baselineCostUsd: number, voice: number | null, cacheHits = 0): CostSummary {
  return {
    costUsd,
    baselineCostUsd,
    percentSaved: null,
    voice: voice === null ? null : { costUsd: voice, reused: false },
    modelStages: [
      {
        label: "Exploring the site",
        calls: 3,
        costUsd: costUsd - (voice ?? 0),
        unknown: false,
        baselineCostUsd,
        inputTokens: 1,
        outputTokens: 1,
        models: [],
        tiers: [],
        cacheHits,
        escalations: 0,
      },
    ],
  };
}

describe("forecast", () => {
  it("averages fresh runs only and adds the voice to the strong-model figure", () => {
    const basis = forecastBasis([summary(0.05, 0.06, 0.02), summary(0.03, 0.04, 0.01), summary(0.01, 0.1, 0, 1)]);
    expect(basis).toEqual({ averageCostUsd: 0.04, averageBaselineUsd: 0.065, videosCounted: 2 });
    expect(isFreshRun(summary(0.01, 0.1, 0, 1))).toBe(false);
    expect(forecastBasis([])).toBeNull();
  });

  it("matches a hand calculation", () => {
    const figures = forecastMonthly({ averageCostUsd: 0.05, averageBaselineUsd: 0.08, videosCounted: 1 }, 1000, 20);
    expect(figures.strongUsd).toBeCloseTo(80);
    expect(figures.routedUsd).toBeCloseTo(50);
    expect(figures.reservedUsd).toBeCloseTo(40);
    expect(figures.savedUsd).toBeCloseTo(40);
  });
});
