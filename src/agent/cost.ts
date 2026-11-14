/**
 * Shared cost accounting for the agent's persisted call log and CLI summary.
 */
import fs from "node:fs";
import path from "node:path";

/** One model call's aggregate usage, including its per-call price estimate. */
export interface AgentCostCall {
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** Exact JSON structure written to each job's agent-cost.json file. */
export interface AgentCostFile {
  calls: AgentCostCall[];
  totalUsd: number | null;
}

/** Create an empty cost log before the planner or browser agent makes a call. */
export function createAgentCostFile(): AgentCostFile {
  return { calls: [], totalUsd: 0 };
}

/** Append one call and preserve an unknown total if any model price is missing. */
export function addAgentCostCall(
  costFile: AgentCostFile,
  stage: string,
  call: Omit<AgentCostCall, "stage">,
): void {
  costFile.calls.push({ ...call, stage });
  if (call.costUsd === null) {
    costFile.totalUsd = null;
  } else if (costFile.totalUsd !== null) {
    costFile.totalUsd += call.costUsd;
  }
}

/** Append a script or voice stage to the job's existing model cost log. */
export function appendCostCall(
  jobFolder: string,
  stage: string,
  call: Omit<AgentCostCall, "stage">,
): void {
  const costFilePath = path.join(jobFolder, "agent-cost.json");
  const costFile = fs.existsSync(costFilePath)
    ? (JSON.parse(fs.readFileSync(costFilePath, "utf8")) as AgentCostFile)
    : createAgentCostFile();
  addAgentCostCall(costFile, stage, call);
  fs.writeFileSync(costFilePath, `${JSON.stringify(costFile, null, 2)}\n`, "utf8");
}

/** Return the first unpriced model name to explain why the total is unknown. */
export function findUnpricedModel(costFile: AgentCostFile): string | null {
  return costFile.calls.find((call) => call.costUsd === null)?.model ?? null;
}

/** Format the total-cost line for the standalone CLI. */
export function formatTotalCost(
  totalUsd: number | null,
  unpricedModel: string | null,
): string {
  return totalUsd === null
    ? `Total cost: unknown (no price for ${unpricedModel ?? "unknown model"})`
    : `Total cost: $${totalUsd.toFixed(6)}`;
}
