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
