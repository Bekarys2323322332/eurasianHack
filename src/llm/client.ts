/**
 * Provide the one OpenAI-compatible model-call boundary used by the agent.
 * This module owns prompts, response validation, retries, and usage accounting.
 */
import type { ZodType } from "zod";
import { costUsd, modelForTier, type ModelTier } from "./models.config";

/** A structured or plain-text model request routed through the configured tier. */
export interface CallModelOptions<T> {
  tier: ModelTier;
  system: string;
  user: string;
  json?: ZodType<T>;
  maxAttempts?: number;
}

/** Parsed output and the usage accumulated across every attempt in the call. */
export interface ModelResult<T> {
  text: string;
  data: T;
  model: string;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  attempts: number;
}

/** Usage attached to an invalid-output error so callers can still record cost. */
export interface ModelOutputUsage {
  model: string;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  attempts: number;
}

/** Raised when every structured-output attempt returns invalid JSON. */
export class ModelOutputError extends Error {
  constructor(
    message: string,
    readonly usage: ModelOutputUsage,
  ) {
    super(message);
    this.name = "ModelOutputError";
  }
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface InvalidReply {
  text: string;
  errors: string;
}

interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  attempts: number;
}

interface TierResult<T> {
  result?: ModelResult<T>;
  invalidReply?: InvalidReply;
}

/** Pause between transient gateway retries without blocking the event loop. */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Convert gateway usage to a safe, non-negative integer token count. */
function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** Build the OpenAI-compatible endpoint and fail plainly when configuration is absent. */
function gatewayConfiguration(): { url: string; apiKey: string } {
  const baseUrl = process.env.LLM_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("LLM_BASE_URL is missing. Set it in .env.");
  }

  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("LLM_API_KEY is missing. Set it in .env.");
  }

  return {
    url: `${baseUrl}/chat/completions`,
    apiKey,
  };
}

/** Retry transient rate-limit and server errors once, as required by the gateway contract. */
async function fetchCompletion(
  model: string,
  messages: ChatMessage[],
): Promise<ChatCompletionResponse> {
  const { url, apiKey } = gatewayConfiguration();
  const body = JSON.stringify({
    model,
    messages,
    temperature: 0.2,
  });

  for (let requestAttempt = 0; requestAttempt < 2; requestAttempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("The model gateway rejected LLM_API_KEY. Check the key in .env.");
    }

    const isTransient = response.status === 429 || response.status >= 500;
    if (isTransient && requestAttempt === 0) {
      await response.body?.cancel().catch(() => undefined);
      await wait(2_000);
      continue;
    }

    if (!response.ok) {
      throw new Error(`The model gateway request failed with status ${response.status}.`);
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  throw new Error("The model gateway request failed after a transient retry.");
}

/** Add the required JSON-only instruction and any prior invalid reply for correction. */
function makeMessages(
  system: string,
  user: string,
  wantsJson: boolean,
  invalidReply?: InvalidReply,
): ChatMessage[] {
  const systemPrompt = wantsJson
    ? `${system}\n\nReply with one JSON object only. No prose, no code fences.`
    : system;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: user },
  ];

  if (invalidReply) {
    messages.push(
      { role: "assistant", content: invalidReply.text },
      {
        role: "user",
        content: `Your reply was not valid: ${invalidReply.errors}. Reply again with only the corrected JSON object.`,
      },
    );
  }

  return messages;
}

/** Strip optional Markdown fences and isolate the outermost JSON object. */
function extractJson(text: string): { value?: unknown; error?: string } {
  const withoutFences = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const firstBrace = withoutFences.indexOf("{");
  const lastBrace = withoutFences.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < firstBrace) {
    return { error: "No JSON object was found in the reply." };
  }

  try {
    return { value: JSON.parse(withoutFences.slice(firstBrace, lastBrace + 1)) };
  } catch (error) {
    return {
      error: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Parse the JSON object, then validate it with the caller's schema. */
function validateJson<T>(
  text: string,
  schema: ZodType<T>,
): { success: true; data: T } | { success: false; errors: string } {
  const parsedJson = extractJson(text);
  if (parsedJson.error) {
    return { success: false, errors: parsedJson.error };
  }

  const parsed = schema.safeParse(parsedJson.value);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { success: false, errors: `Schema validation failed: ${errors}` };
  }

  return { success: true, data: parsed.data };
}

/** Add one response's token usage and price to the call-wide totals. */
function addUsage(
  accumulator: UsageAccumulator,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const attemptCost = costUsd(model, inputTokens, outputTokens);
  accumulator.inputTokens += inputTokens;
  accumulator.outputTokens += outputTokens;
  accumulator.costUsd =
    accumulator.costUsd === null || attemptCost === null
      ? null
      : accumulator.costUsd + attemptCost;
  accumulator.attempts += 1;
}

/** Execute one tier's requested number of output-validation attempts. */
async function callTier<T>(
  tier: ModelTier,
  opts: CallModelOptions<T>,
  attemptsForTier: number,
  accumulator: UsageAccumulator,
  priorInvalidReply?: InvalidReply,
): Promise<TierResult<T>> {
  const model = modelForTier(tier);
  let invalidReply = priorInvalidReply;

  for (let attempt = 0; attempt < attemptsForTier; attempt += 1) {
    const completion = await fetchCompletion(
      model,
      makeMessages(opts.system, opts.user, Boolean(opts.json), invalidReply),
    );
    const text = completion.choices?.[0]?.message?.content ?? "";
    const inputTokens = tokenCount(completion.usage?.prompt_tokens);
    const outputTokens = tokenCount(completion.usage?.completion_tokens);
    addUsage(accumulator, model, inputTokens, outputTokens);

    if (!opts.json) {
      return {
        result: {
          text,
          data: text as T,
          model,
          tier,
          inputTokens: accumulator.inputTokens,
          outputTokens: accumulator.outputTokens,
          costUsd: accumulator.costUsd,
          attempts: accumulator.attempts,
        },
      };
    }

    const validation = validateJson(text, opts.json);
    if (validation.success) {
      return {
        result: {
          text,
          data: validation.data,
          model,
          tier,
          inputTokens: accumulator.inputTokens,
          outputTokens: accumulator.outputTokens,
          costUsd: accumulator.costUsd,
          attempts: accumulator.attempts,
        },
      };
    }

    invalidReply = { text, errors: validation.errors };
  }

  return { invalidReply };
}

/** Call the selected model, validate structured replies, and escalate small-tier failures once. */
export async function callModel<T = string>(
  opts: CallModelOptions<T>,
): Promise<ModelResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 2;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer.");
  }

  const accumulator: UsageAccumulator = {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    attempts: 0,
  };
  const firstTier = await callTier(
    opts.tier,
    opts,
    maxAttempts,
    accumulator,
  );
  if (firstTier.result) return firstTier.result;

  let finalModel = modelForTier(opts.tier);
  let finalTier = opts.tier;
  let invalidReply = firstTier.invalidReply;

  if (opts.tier === "small" && invalidReply) {
    finalTier = "strong";
    finalModel = modelForTier(finalTier);
    const fallback = await callTier(finalTier, opts, 1, accumulator, invalidReply);
    if (fallback.result) return fallback.result;
    invalidReply = fallback.invalidReply ?? invalidReply;
  }

  const usage: ModelOutputUsage = {
    model: finalModel,
    tier: finalTier,
    inputTokens: accumulator.inputTokens,
    outputTokens: accumulator.outputTokens,
    costUsd: accumulator.costUsd,
    attempts: accumulator.attempts,
  };
  throw new ModelOutputError(
    `The model returned invalid JSON after ${usage.attempts} attempts: ${invalidReply?.errors ?? "No valid JSON object was returned."}`,
    usage,
  );
}
