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
    expect(basis).toEqual({ averageCostUsd: 0.04, averageBaselineUsd: 0.065, averageVoiceUsd: 0.015, videosCounted: 2 });
    expect(isFreshRun(summary(0.01, 0.1, 0, 1))).toBe(false);
    const reusedVoice = summary(0.05, 0.06, 0.02);
    reusedVoice.voice = { costUsd: 0.02, reused: true };
    expect(isFreshRun(reusedVoice)).toBe(false);
    const unpriced = summary(0.05, 0.06, 0.02);
    unpriced.modelStages[0].unknown = true;
    expect(isFreshRun(unpriced)).toBe(false);
    expect(forecastBasis([])).toBeNull();
  });

  it("matches a hand calculation", () => {
    const basis = { averageCostUsd: 0.05, averageBaselineUsd: 0.08, averageVoiceUsd: 0.01, videosCounted: 1 };
    const figures = forecastMonthly(basis, 1000, 20);
    expect(figures.strongUsd).toBeCloseTo(80);
    expect(figures.routedUsd).toBeCloseTo(50);
    // The 20% discount applies to the $40 of model calls only, not the $10 of voice.
    expect(figures.reservedUsd).toBeCloseTo(42);
    expect(figures.savedUsd).toBeCloseTo(38);
  });
});
