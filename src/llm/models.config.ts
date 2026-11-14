/**
 * Keep model routing and pricing in one small configuration module so the
 * planner and browser agent can select a tier without knowing provider details.
 */
export type ModelTier = "small" | "strong";

/** USD rates for one million input and output tokens. */
export interface ModelPrice {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

/** Public model identifiers and their current estimated token prices. */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "anthropic/claude-haiku-5.5": {
    inputPerMillionUsd: 0.1,
    outputPerMillionUsd: 0.5,
  },
  "anthropic/claude-sonnet-5.5": {
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 10,
  },
  // Cheaper OpenRouter options. Small tier:
  "deepseek/deepseek-v4.1-flash": {
    // Discounted price at the time of writing; check OpenRouter if costs look off.
    inputPerMillionUsd: 0.05,
    outputPerMillionUsd: 0.2,
  },
  "z-ai/glm-5.3-flash": {
    inputPerMillionUsd: 0.04,
    outputPerMillionUsd: 0.08,
  },
  // Strong tier:
  "tencent/hy4-preview": {
    inputPerMillionUsd: 0.83,
    outputPerMillionUsd: 2.5,
  },
  "stepfun/step-5-preview": {
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 2.7,
  },
  "x-ai/grok-4.7": {
    // Price for prompts under 200K tokens; the agent's prompts are far smaller.
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 6,
  },
};

/**
 * Resolve a configured model for the requested tier without logging its key.
 */
export function modelForTier(
  tier: ModelTier,
  env: Record<string, string | undefined> = process.env,
): string {
  const variable = tier === "small" ? "SMALL_MODEL" : "STRONG_MODEL";
  const model = env[variable]?.trim();
  if (!model) {
    throw new Error(`${variable} is missing. Set it in .env.`);
  }
  return model;
}

/** Estimate a call's USD cost, or return null when the model price is unknown. */
export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  return (
    (inputTokens / 1_000_000) * price.inputPerMillionUsd +
    (outputTokens / 1_000_000) * price.outputPerMillionUsd
  );
}
