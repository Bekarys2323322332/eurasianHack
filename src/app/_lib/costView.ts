/**
 * Turn persisted model usage into the grouped, plain-language totals shown
 * beside a finished video.
 */
import { costUsd } from "../../llm";
import type { AgentCostCall, AgentCostFile } from "../../agent/cost";

export interface CostStageRow {
  label: string;
  calls: number;
  costUsd: number | null;
  unknown: boolean;
  baselineCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  models: string[];
  tiers: string[];
  cacheHits: number;
  escalations: number;
}

export interface VoiceCostSummary {
  costUsd: number | null;
  reused: boolean;
}

export interface CostSummary {
  costUsd: number;
  baselineCostUsd: number;
  percentSaved: number | null;
  modelStages: CostStageRow[];
  voice: VoiceCostSummary | null;
}

interface MutableCostStageRow extends Omit<CostStageRow, "costUsd" | "models" | "tiers"> {
  costUsd: number;
  knownCalls: number;
  models: Set<string>;
  tiers: Set<string>;
}

/** Use a display label for known stages while preserving unfamiliar stages. */
function stageLabel(stage: string): string {
  if (stage === "planner") return "Planning";
  if (stage.startsWith("agent-step-")) return "Exploring the site";
  if (stage === "script") return "Writing the script";
  return stage;
}

/** Estimate a full-strength comparison cost, falling back to the reported price. */
function callBaseline(call: AgentCostCall, strongModel: string | null): number {
  if (typeof call.baselineCostUsd === "number") return call.baselineCostUsd;

  if (strongModel && typeof call.inputTokens === "number" && typeof call.outputTokens === "number") {
    const estimated = costUsd(strongModel, call.inputTokens, call.outputTokens);
    if (estimated !== null) return estimated;
  }

  return typeof call.costUsd === "number" ? call.costUsd : 0;
}

/** Group calls in first-seen order and calculate cost totals. */
export function summarizeCost(file: AgentCostFile, strongModel: string | null): CostSummary {
  const rows = new Map<string, MutableCostStageRow>();
  let totalCostUsd = 0;
  let modelCostUsd = 0;
  let totalBaselineCostUsd = 0;
  const voiceCalls: AgentCostCall[] = [];

  for (const call of file.calls) {
    if (call.stage === "voice") {
      voiceCalls.push(call);
      if (call.costUsd !== null) totalCostUsd += call.costUsd;
      continue;
    }

    const label = stageLabel(call.stage);
    let row = rows.get(label);
    if (!row) {
      row = {
        label,
        calls: 0,
        costUsd: 0,
        knownCalls: 0,
        unknown: false,
        baselineCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        models: new Set<string>(),
        tiers: new Set<string>(),
        cacheHits: 0,
        escalations: 0,
      };
      rows.set(label, row);
    }

    row.calls += 1;
    if (call.costUsd === null) {
      row.unknown = true;
    } else {
      row.costUsd += call.costUsd;
      row.knownCalls += 1;
      totalCostUsd += call.costUsd;
      modelCostUsd += call.costUsd;
    }

    const baselineCostUsd = callBaseline(call, strongModel);
    row.baselineCostUsd += baselineCostUsd;
    totalBaselineCostUsd += baselineCostUsd;
    row.inputTokens += call.inputTokens;
    row.outputTokens += call.outputTokens;
    row.models.add(call.model);
    if (call.tier) row.tiers.add(call.tier);
    if (call.cacheHit) row.cacheHits += 1;
    if (call.escalated) row.escalations += 1;
  }

  const modelStages: CostStageRow[] = [...rows.values()].map(
    ({ knownCalls, models, tiers, ...row }) => ({
      ...row,
      costUsd: knownCalls > 0 ? row.costUsd : null,
      models: [...models],
      tiers: [...tiers],
    }),
  );
  const knownVoiceCosts = voiceCalls
    .map((call) => call.costUsd)
    .filter((cost): cost is number => cost !== null);
  const percentSaved =
    totalBaselineCostUsd > 0
      ? Math.max(0, Math.round((1 - modelCostUsd / totalBaselineCostUsd) * 100))
      : null;

  return {
    costUsd: totalCostUsd,
    baselineCostUsd: totalBaselineCostUsd,
    percentSaved,
    modelStages,
    voice:
      voiceCalls.length === 0
        ? null
        : {
            costUsd:
              knownVoiceCosts.length > 0
                ? knownVoiceCosts.reduce((total, cost) => total + cost, 0)
                : null,
            reused: voiceCalls.some((call) => call.cacheHit === true),
          },
  };
}
