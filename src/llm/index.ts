/**
 * Stable public exports for the application's single model-call boundary.
 */
export { callModel, ModelOutputError } from "./client";
export type {
  CallModelOptions,
  ModelOutputUsage,
  ModelResult,
} from "./client";
export { costUsd, modelForTier, MODEL_PRICES } from "./models.config";
export type { ModelPrice, ModelTier } from "./models.config";
