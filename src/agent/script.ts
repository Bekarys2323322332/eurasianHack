/**
 * Write short narration and captions for the visible steps in a validated
 * agent result, then persist them for voice generation and rendering.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { callModel } from "../llm";
import { validateStepFile } from "../shared/stepFile";
import type { AgentCostCall } from "./cost";

interface ScriptLine {
  stepId: string;
  narration: string;
  caption: string;
}

/** Build a per-job schema that enforces exact step coverage and concise copy. */
function scriptSchema(visibleStepIds: string[]) {
  const expectedIds = new Set(visibleStepIds);
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
        if (narrationWords > 18) {
          context.addIssue({
            code: "custom",
            path: ["lines", index, "narration"],
            message: "Narration must be 18 words or fewer.",
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

/** Read steps, generate language-specific copy, and return model usage for the cost log. */
export async function writeScript(
  jobFolder: string,
  options: { languageName: string },
): Promise<Omit<AgentCostCall, "stage">> {
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
  const schema = scriptSchema(stepIds);
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
      "Narration must be at most 18 words; captions must be at most 6 words.",
      stepFile.mode === "demo"
        ? "Use a confident product-pitch tone. The first narration line opens with a one-line hook, and the last narration line ends with a call to action."
        : `Use clear how-to instructions. Begin each caption with the localized step label in this sequence: ${howToCaptionOrder}.`,
    ].join(" "),
    user: [
      `Job mode: ${stepFile.mode}`,
      `Video title: ${stepFile.title}`,
      `Video goal: ${stepFile.goal}`,
      `Language: ${options.languageName}`,
      `Visible steps:\n${JSON.stringify(
        visibleSteps.map(({ id, action, target, reason }) => ({ id, action, target, reason })),
        null,
        2,
      )}`,
      `Required JSON output shape; copy each stepId exactly and replace the text placeholders:\n${JSON.stringify(outputShape, null, 2)}`,
    ].join("\n\n"),
    json: schema,
  });

  const linesByStepId = new Map<string, ScriptLine>(
    result.data.lines.map((line) => [line.stepId, line]),
  );
  const updated = {
    ...stepFile,
    steps: stepFile.steps.map((step) => {
      if (step.status !== "ok" || step.hidden) return step;
      const line = linesByStepId.get(step.id);
      return line
        ? { ...step, narration: line.narration, caption: line.caption }
        : step;
    }),
  };
  const validated = validateStepFile(updated);
  if (!validated.ok) {
    throw new Error(`The scripted step file is not valid:\n${validated.errors.join("\n")}`);
  }

  fs.writeFileSync(stepsPath, `${JSON.stringify(validated.stepFile, null, 2)}\n`, "utf8");
  return {
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  };
}
