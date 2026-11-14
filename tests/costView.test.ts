import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelResult } from "../src/llm";
import { costUsd } from "../src/llm";
import {
  modelCostCall,
  type AgentCostCall,
  type AgentCostFile,
} from "../src/agent/cost";
import { summarizeCost } from "../src/app/_lib/costView";

const strongModel = "anthropic/claude-sonnet-5.5";

function costCall(stage: string, overrides: Partial<AgentCostCall> = {}): AgentCostCall {
  return {
    stage,
    model: "provider/model",
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.001,
    ...overrides,
  };
}

function costFile(calls: AgentCostCall[]): AgentCostFile {
  return {
    calls,
    totalUsd: calls.some((call) => call.costUsd === null)
      ? null
      : calls.reduce((total, call) => total + (call.costUsd ?? 0), 0),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("summarizeCost", () => {
  it("groups familiar labels and keeps first-appearance order", () => {
    const summary = summarizeCost(
      costFile([
        costCall("planner"),
        costCall("agent-step-1"),
        costCall("agent-step-2"),
        costCall("script"),
        costCall("custom-stage"),
        costCall("voice"),
        costCall("agent-step-3"),
      ]),
      strongModel,
    );

    expect(summary.modelStages.map((stage) => stage.label)).toEqual([
      "Planning",
      "Exploring the site",
      "Writing the script",
      "custom-stage",
    ]);
    expect(summary.modelStages[1].calls).toBe(3);
    expect(summary.voice).toEqual({ costUsd: 0.001, reused: false });
  });

  it("estimates baselines for older entries and falls back to their own price", () => {
    const oldCall: AgentCostCall = {
      stage: "planner",
      model: "old/model",
      inputTokens: 5_000,
      outputTokens: 1_000,
      costUsd: 0.01,
    };
    const oldSummary = summarizeCost(costFile([oldCall]), strongModel);
    expect(oldSummary.baselineCostUsd).toBeCloseTo(costUsd(strongModel, 5_000, 1_000)!);

    const unpricedStrongModel = summarizeCost(costFile([oldCall]), "unpriced/model");
    expect(unpricedStrongModel.baselineCostUsd).toBe(oldCall.costUsd);
  });

  it("counts escalations and reused calls", () => {
    const summary = summarizeCost(
      costFile([
        costCall("agent-step-1", { tier: "strong", escalated: true }),
        costCall("agent-step-2", { tier: "small", cacheHit: true }),
        costCall("script", { tier: "strong", cacheHit: true }),
      ]),
      strongModel,
    );

    expect(summary.modelStages[0]).toMatchObject({
      escalations: 1,
      cacheHits: 1,
      tiers: ["strong", "small"],
    });
    expect(summary.modelStages[1].cacheHits).toBe(1);
  });

  it("keeps the known model total when the voice price is unavailable", () => {
    const summary = summarizeCost(
      costFile([
        costCall("planner", { costUsd: 0.01, baselineCostUsd: 0.02 }),
        costCall("voice", { model: "voice/provider", costUsd: null }),
      ]),
      strongModel,
    );

    expect(summary.costUsd).toBe(0.01);
    expect(summary.voice).toEqual({ costUsd: null, reused: false });
    expect(summary.baselineCostUsd).toBe(0.02);
    expect(summary.percentSaved).toBe(50);
  });

  it("excludes voice cost from the routing baseline and savings percentage", () => {
    const saved = summarizeCost(
      costFile([
        costCall("planner", { costUsd: 0.25, baselineCostUsd: 0.5 }),
        costCall("voice", { costUsd: 0.75, baselineCostUsd: 0.75, cacheHit: true }),
      ]),
      strongModel,
    );

    expect(saved.costUsd).toBe(1);
    expect(saved.baselineCostUsd).toBe(0.5);
    expect(saved.percentSaved).toBe(50);
    expect(saved.voice).toEqual({ costUsd: 0.75, reused: true });
  });

  it("keeps known prices in a model row with a mix of known and unknown calls", () => {
    const summary = summarizeCost(
      costFile([
        costCall("agent-step-1", { costUsd: 0.02 }),
        costCall("agent-step-2", { costUsd: null }),
      ]),
      strongModel,
    );

    expect(summary.modelStages[0]).toMatchObject({
      calls: 2,
      costUsd: 0.02,
      unknown: true,
    });
  });

  it("leaves unpriced calls out of the routing comparison", () => {
    const summary = summarizeCost(
      costFile([
        costCall("agent-step-1", {
          costUsd: 0.001,
          baselineCostUsd: 0.01,
          tier: "small",
        }),
        costCall("agent-step-2", {
          costUsd: null,
          inputTokens: 1_000_000,
          outputTokens: 0,
          tier: "small",
        }),
      ]),
      strongModel,
    );

    expect(summary.baselineCostUsd).toBe(0.01);
    expect(summary.percentSaved).toBe(90);
    expect(summary.modelStages[0].baselineCostUsd).toBe(0.01);
  });

  it("hides the savings percentage when the model baseline is zero", () => {
    const summary = summarizeCost(
      costFile([costCall("planner", { costUsd: 0, baselineCostUsd: 0 })]),
      strongModel,
    );

    expect(summary.percentSaved).toBeNull();
  });
});

describe("modelCostCall", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("marks escalation and prices the same tokens at the strong model", () => {
    vi.stubEnv("STRONG_MODEL", strongModel);
    const strongResult: Pick<
      ModelResult<unknown>,
      "model" | "tier" | "inputTokens" | "outputTokens" | "costUsd"
    > = {
      model: "anthropic/claude-haiku-5.5",
      tier: "strong",
      inputTokens: 1_000_000,
      outputTokens: 0,
      costUsd: 0.1,
    };

    const escalated = modelCostCall(strongResult, "small");
    const notEscalated = modelCostCall({ ...strongResult, tier: "small" }, "small");

    expect(escalated).toMatchObject({
      tier: "strong",
      escalated: true,
      cacheHit: false,
      baselineCostUsd: costUsd(strongModel, 1_000_000, 0),
    });
    expect(notEscalated.escalated).toBe(false);
  });
});
