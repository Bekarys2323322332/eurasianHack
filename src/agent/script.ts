/**
 * Write short narration and captions for the visible steps in a validated
 * agent result, then persist them for voice generation and rendering.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { callModel, costUsd, modelForTier } from "../llm";
import { validateStepFile, type StepFile } from "../shared/stepFile";
import type { Style } from "../renderer/settings";
import { modelCostCall, type AgentCostCall } from "./cost";

interface ScriptLine {
  stepId: string;
  narration: string;
  caption: string;
}

interface ScriptCache {
  lines: ScriptLine[];
  inputTokens?: number;
  outputTokens?: number;
}

const STYLE_TONES: Record<Style, string> = {
  trailer:
    "Energetic product pitch with short, confident lines. Open with a one-line hook and end with a call to action.",
  tutorial: "Clear, calm instructions that tell the viewer exactly what to do.",
  social: "Very short punchy lines of at most 8 words each. The first line is a hook that stops the scroll.",
};

/** Build a per-job schema that enforces exact step coverage and concise copy. */
function scriptSchema(visibleStepIds: string[], style: Style) {
  const expectedIds = new Set(visibleStepIds);
  const maxNarrationWords = style === "social" ? 8 : 18;
  return z
    .object({
      lines: z.array(
        z.object({
          stepId: z.string(),
          narration: z.string().min(1),
          caption: z.string().min(1),
        }),
      ),
    })
    .superRefine(({ lines }, context) => {
      const actualIds = lines.map((line) => line.stepId);
      const actualIdSet = new Set(actualIds);
      const exactCoverage =
        actualIds.length === expectedIds.size &&
        actualIdSet.size === actualIds.length &&
        [...expectedIds].every((stepId) => actualIdSet.has(stepId));

      if (!exactCoverage) {
        context.addIssue({
          code: "custom",
          path: ["lines"],
          message: "Include every visible step ID exactly once, with no extra IDs.",
        });
      }

      lines.forEach((line, index) => {
        const narrationWords = line.narration.trim().split(/\s+/).filter(Boolean).length;
        if (narrationWords > maxNarrationWords) {
          context.addIssue({
            code: "custom",
            path: ["lines", index, "narration"],
            message: `Narration must be ${maxNarrationWords} words or fewer.`,
          });
        }

        const captionWords = line.caption.trim().split(/\s+/).filter(Boolean).length;
        if (captionWords > 6) {
          context.addIssue({
            code: "custom",
            path: ["lines", index, "caption"],
            message: "Caption must be 6 words or fewer.",
          });
        }
      });
    });
}

/** Resolve the shared script cache file for this content and presentation style. */
function scriptCachePath(
  stepFile: StepFile,
  visibleSteps: StepFile["steps"],
  options: { languageName: string; style: Style },
): string {
  const key = JSON.stringify([
    stepFile.mode,
    stepFile.title,
    stepFile.goal,
    options.languageName,
    options.style,
    stepFile.resultText ?? null,
    visibleSteps.map(({ id, action, target, reason, typedText, observed }) => ({ id, action, target, reason, typedText, observed })),
  ]);
  const digest = createHash("sha256").update(key).digest("hex");
  const dataDir = path.resolve(process.env.DATA_DIR || "./data");
  return path.join(dataDir, "script-cache", `${digest}.json`);
}

/** Read and validate a cached script, treating malformed entries as cache misses. */
function readCachedScript(
  cachePath: string,
  schema: ReturnType<typeof scriptSchema>,
): ScriptCache | null {
  if (!fs.existsSync(cachePath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf8")) as {
      inputTokens?: unknown;
      outputTokens?: unknown;
    };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return null;
    return {
      lines: parsed.data.lines,
      inputTokens: validTokenCount(raw.inputTokens),
      outputTokens: validTokenCount(raw.outputTokens),
    };
  } catch {
    return null;
  }
}

/** Accept only non-negative token counts from cache files. */
function validTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** Estimate the original script's full-strength cost, or zero for old cache entries. */
function scriptCacheBaselineCost(cache: ScriptCache): number | null {
  if (cache.inputTokens === undefined || cache.outputTokens === undefined) return 0;
  try {
    return costUsd(
      modelForTier("strong"),
      cache.inputTokens,
      cache.outputTokens,
    );
  } catch {
    return null;
  }
}

/** Apply validated lines to visible steps and persist the validated step file. */
function applyScriptLines(stepFile: StepFile, stepsPath: string, lines: ScriptLine[]): void {
  const linesByStepId = new Map<string, ScriptLine>(lines.map((line) => [line.stepId, line]));
  const updated = {
    ...stepFile,
    steps: stepFile.steps.map((step) => {
      if (step.status !== "ok" || step.hidden) return step;
      const line = linesByStepId.get(step.id);
      return line ? { ...step, narration: line.narration, caption: line.caption } : step;
    }),
  };
  const validated = validateStepFile(updated);
  if (!validated.ok) {
    throw new Error(`The scripted step file is not valid:\n${validated.errors.join("\n")}`);
  }

  fs.writeFileSync(stepsPath, `${JSON.stringify(validated.stepFile, null, 2)}\n`, "utf8");
}

/** Read steps, generate language-specific copy, and return model usage for the cost log. */
export async function writeScript(
  jobFolder: string,
  options: { languageName: string; style: Style },
): Promise<Omit<AgentCostCall, "stage"> & { cached: boolean }> {
  const stepsPath = path.join(path.resolve(jobFolder), "steps.json");
  if (!fs.existsSync(stepsPath)) {
    throw new Error(`No steps.json found in ${jobFolder}. Run the agent first.`);
  }

  const checked = validateStepFile(JSON.parse(fs.readFileSync(stepsPath, "utf8")));
  if (!checked.ok) {
    throw new Error(`steps.json in ${jobFolder} is not valid:\n${checked.errors.join("\n")}`);
  }

  const stepFile = checked.stepFile;
  const visibleSteps = stepFile.steps.filter((step) => step.status === "ok" && !step.hidden);
  const stepIds = visibleSteps.map((step) => step.id);
  const schema = scriptSchema(stepIds, options.style);
  const cachePath = scriptCachePath(stepFile, visibleSteps, options);
  const cachedScript = readCachedScript(cachePath, schema);
  if (cachedScript) {
    applyScriptLines(stepFile, stepsPath, cachedScript.lines);
    return {
      model: "cache",
      tier: "strong",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      cacheHit: true,
      escalated: false,
      baselineCostUsd: scriptCacheBaselineCost(cachedScript),
      cached: true,
    };
  }

  const stepWord = options.languageName === "Russian" ? "Шаг" : "Step";
  const howToCaptionOrder = visibleSteps
    .map((_, index) => `${stepWord} ${index + 1}`)
    .join(", ");
  const outputShape = {
    lines: visibleSteps.map((step) => ({
      stepId: step.id,
      narration: "<one sentence in the requested language>",
      caption: "<caption in the requested language>",
    })),
  };

  const result = await callModel({
    tier: "strong",
    system: [
      "You write narration and captions for a product video.",
      `Write directly in ${options.languageName}; do not translate from English.`,
      "Return the required JSON fields: lines, and for every line the exact stepId, narration, and caption properties. Copy each stepId exactly from the input.",
      "Write exactly one natural spoken sentence of narration and one short caption for each visible step.",
      "Narrate what actually happened: mention the real typed text and the observed result, never an invented value.",
      stepFile.resultText && stepFile.goalAchieved !== false
        ? `The last line must state the result: ${stepFile.resultText}`
        : "",
      `Narration must be at most ${options.style === "social" ? 8 : 18} words; captions must be at most 6 words.`,
      STYLE_TONES[options.style],
      stepFile.mode === "howto"
        ? `Begin each caption with the localized step label in this sequence: ${howToCaptionOrder}.`
        : "",
    ].join(" "),
    user: [
      `Job mode: ${stepFile.mode}`,
      `Video title: ${stepFile.title}`,
      `Video goal: ${stepFile.goal}`,
      `Language: ${options.languageName}`,
      `Visible steps:\n${JSON.stringify(
        visibleSteps.map(({ id, action, target, reason, typedText, observed }) => ({
          id,
          action,
          target,
          reason,
          typedText,
          observed: observed ?? undefined,
        })),
        null,
        2,
      )}`,
      stepFile.resultText ? `Final result reached: ${stepFile.resultText}` : "",
      `Required JSON output shape; copy each stepId exactly and replace the text placeholders:\n${JSON.stringify(outputShape, null, 2)}`,
    ].join("\n\n"),
    json: schema,
  });

  const validatedLines = schema.parse(result.data).lines;
  applyScriptLines(stepFile, stepsPath, validatedLines);

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const partialCachePath = `${cachePath}.part`;
  fs.writeFileSync(
    partialCachePath,
    `${JSON.stringify(
      {
        lines: validatedLines,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.renameSync(partialCachePath, cachePath);

  return {
    ...modelCostCall(result, "strong"),
    cached: false,
  };
}
