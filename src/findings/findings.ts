/**
 * Turn the step file into a short list of findings a product owner can act on.
 * Everything here reads the shared step file; nothing depends on the agent.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callModel, ModelOutputError } from "../llm";
import { validateStepFile, type Step, type StepFile } from "../shared/stepFile";
import { modelCostCall, type AgentCostCall } from "../agent/cost";

export type FindingKind = "did-nothing" | "hard-to-find" | "slow" | "broken";
export type Severity = "high" | "medium" | "low";

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  /** The first step where this happened. */
  stepId: string;
  stepIndex: number;
  /** Every step where the same thing happened, in order. */
  stepIndexes: number[];
  screenshot: string;
  description: string;
}

export interface FindingsReport {
  /** Counts only serious and worth-fixing findings. */
  headline: string;
  summary: string;
  findings: Finding[];
}

const findingKindSchema = z.enum(["did-nothing", "hard-to-find", "slow", "broken"]);
const severitySchema = z.enum(["high", "medium", "low"]);

export const findingsReportSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  findings: z.array(
    z.object({
      id: z.string(),
      kind: findingKindSchema,
      severity: severitySchema,
      stepId: z.string(),
      stepIndex: z.number().int().positive(),
      stepIndexes: z.array(z.number().int().positive()).default([]),
      screenshot: z.string(),
      description: z.string(),
    }),
  ),
});

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function targetText(step: Step): string {
  return step.target.replace(/\s+/g, " ").trim() || "the page";
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Keep only errors on the site itself; console noise and third-party failures are dropped. */
export function relevantErrors(errors: string[], siteHost: string | null): string[] {
  return errors.filter((error) => {
    if (error.startsWith("Console error")) return false;
    const url = error.match(/https?:\/\/\S+/)?.[0];
    if (!url) return false;
    const host = hostOf(url);
    return host !== null && (siteHost === null || host === siteHost || host.endsWith(`.${siteHost}`));
  });
}

function describeError(error: string): string {
  const status = error.match(/^HTTP (\d{3}): (\S+)/);
  if (status) {
    const pathname = (() => {
      try {
        return new URL(status[2]).pathname;
      } catch {
        return status[2];
      }
    })();
    if (status[1].startsWith("5")) return `The page "${pathname}" showed a server error (${status[1]}).`;
    if (status[1] === "404") return `The page "${pathname}" was missing (404).`;
    return `The page "${pathname}" failed with error ${status[1]}.`;
  }
  return "Part of the page failed to load.";
}

function failedActionDescription(step: Step): string {
  if (step.deadendReason?.trim()) return step.deadendReason.trim().replace(/[.!?]*$/, ".");
  const target = targetText(step);
  if (step.action === "click") return `Clicking "${target}" did nothing.`;
  if (step.action === "type") return `Typing into "${target}" did not change anything.`;
  if (step.action === "navigate") return `Opening "${target}" did not work.`;
  if (step.action === "scroll") return "Scrolling showed nothing new.";
  return "Waiting did not make anything appear.";
}

function fallbackDescription(kind: FindingKind, step: Step, errors: string[]): string {
  if (kind === "did-nothing") return failedActionDescription(step);
  if (kind === "hard-to-find") return `"${targetText(step)}" was hard to find.`;
  if (kind === "slow") return `The page took ${step.loadSeconds!.toFixed(1)} seconds to load.`;
  return describeError(errors[0]);
}

/** Findings that describe the same thing share a key, so repeats are merged. */
function mergeKey(kind: FindingKind, step: Step, description: string): string {
  if (kind === "slow") return "slow";
  if (kind === "broken") return `broken:${description}`;
  return `${kind}:${step.action}:${targetText(step).toLowerCase()}`;
}

function withCount(description: string, count: number): string {
  if (count < 2) return description;
  return `${description.replace(/[.!?]*$/, ".")} This happened ${count} times.`;
}

/** Collect findings from every step, merging repeats and dropping noise. */
export function collectFindings(stepFile: StepFile): Finding[] {
  const siteHost = hostOf(stepFile.url);
  const merged = new Map<string, Finding>();

  const add = (step: Step, kind: FindingKind, severity: Severity, description: string) => {
    const key = mergeKey(kind, step, description);
    const existing = merged.get(key);
    if (existing) {
      existing.stepIndexes.push(step.index);
      if (SEVERITY_RANK[severity] < SEVERITY_RANK[existing.severity]) existing.severity = severity;
      return;
    }
    merged.set(key, {
      id: `${step.id}-${kind}`,
      kind,
      severity,
      stepId: step.id,
      stepIndex: step.index,
      stepIndexes: [step.index],
      screenshot: step.screenshotAfter,
      description,
    });
  };

  for (const step of stepFile.steps) {
    const errors = relevantErrors(step.errors ?? [], siteHost);

    if (step.status === "deadend") {
      add(step, "did-nothing", "medium", fallbackDescription("did-nothing", step, errors));
    }
    if (Boolean(step.confusion?.trim()) || (step.attempts ?? 0) > 1) {
      const severity = (step.attempts ?? 0) > 1 ? "medium" : "low";
      add(step, "hard-to-find", severity, fallbackDescription("hard-to-find", step, errors));
    }
    if ((step.loadSeconds ?? 0) > 3) {
      add(step, "slow", step.loadSeconds! > 6 ? "medium" : "low", fallbackDescription("slow", step, errors));
    }
    for (const error of errors) {
      const severity = /^HTTP 5/.test(error) ? "high" : "medium";
      add(step, "broken", severity, describeError(error));
    }
  }

  return [...merged.values()]
    .map((finding) => ({
      ...finding,
      description: withCount(finding.description, finding.stepIndexes.length),
    }))
    .sort(
      (left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
        left.stepIndex - right.stepIndex,
    );
}

/** "Worked smoothly", "1 thing to fix" or "N things to fix", counting high and medium only. */
export function headlineFor(findings: Finding[]): string {
  const count = findings.filter((finding) => finding.severity !== "low").length;
  if (count === 0) return "Worked smoothly";
  if (count === 1) return "1 thing to fix";
  return `${count} things to fix`;
}

function fallbackSummary(findings: Finding[]): string {
  if (findings.length === 0) {
    return "A first-time visitor could follow this route without problems.";
  }
  const rawIssue = findings[0].description.split(/(?<=\.)\s/)[0].trim().replace(/[.!?]+$/, "");
  const issue = rawIssue.charAt(0).toLowerCase() + rawIssue.slice(1);
  const others = findings.length - 1;
  const otherIssues = others > 0 ? ` There ${others === 1 ? "was 1 other problem" : `were ${others} other problems`}.` : "";
  return `A first-time visitor could explore the page but struggled because ${issue}.${otherIssues}`;
}

function rewriteSchema(expectedFindings: Finding[]) {
  const expectedIds = new Set(expectedFindings.map(({ id }) => id));
  return z
    .object({
      summary: z.string().trim().min(1),
      findings: z.array(
        z.object({
          id: z.string(),
          description: z.string().trim().min(1),
        }),
      ),
    })
    .superRefine((value, context) => {
      const actualIds = value.findings.map(({ id }) => id);
      const exactCoverage =
        actualIds.length === expectedIds.size &&
        new Set(actualIds).size === actualIds.length &&
        [...expectedIds].every((id) => actualIds.includes(id));

      if (!exactCoverage) {
        context.addIssue({
          code: "custom",
          path: ["findings"],
          message: "Include every finding id exactly once.",
        });
      }

      value.findings.forEach((finding, index) => {
        if (finding.description.trim().split(/\s+/).filter(Boolean).length > 25) {
          context.addIssue({
            code: "custom",
            path: ["findings", index, "description"],
            message: "Descriptions must be 25 words or fewer.",
          });
        }
      });

      if (value.summary.trim().split(/\s+/).filter(Boolean).length > 60) {
        context.addIssue({
          code: "custom",
          path: ["summary"],
          message: "The summary must be 60 words or fewer.",
        });
      }
    });
}

async function writeReport(jobFolder: string, report: FindingsReport): Promise<void> {
  const reportPath = path.join(jobFolder, "findings.json");
  const partPath = `${reportPath}.part`;
  await writeFile(partPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(partPath, reportPath);
}

/** Collect findings, have the strong model phrase them plainly in the job language, and save findings.json. */
export async function writeFindings(
  jobFolder: string,
  options: { languageName: string },
): Promise<Omit<AgentCostCall, "stage"> | null> {
  const stepFilePath = path.join(jobFolder, "steps.json");
  const parsed = validateStepFile(JSON.parse(await readFile(stepFilePath, "utf8")));
  if (!parsed.ok) {
    throw new Error(`steps.json in ${jobFolder} is not valid:\n${parsed.errors.join("\n")}`);
  }

  const stepFile = parsed.stepFile;
  const findings = collectFindings(stepFile);
  const headline = headlineFor(findings);
  if (findings.length === 0) {
    await writeReport(jobFolder, { headline, summary: fallbackSummary(findings), findings });
    return null;
  }

  const stepsById = new Map(stepFile.steps.map((step) => [step.id, step]));
  const schema = rewriteSchema(findings);
  const rawFindings = findings.map((finding) => {
    const step = stepsById.get(finding.stepId)!;
    return {
      id: finding.id,
      kind: finding.kind,
      severity: finding.severity,
      whatHappened: finding.description,
      steps: finding.stepIndexes,
      target: step.target,
      action: step.action,
      whyTheAgentTriedIt: step.reason,
      deadendReason: step.deadendReason ?? null,
      loadSeconds: step.loadSeconds ?? null,
      confusion: step.confusion ?? null,
    };
  });

  try {
    const result = await callModel({
      tier: "strong",
      system: [
        `Write directly in ${options.languageName}.`,
        "You explain usability problems to a non-technical product owner.",
        "For each finding write one plain sentence saying what a first-time visitor would have noticed, naming the button, field or page involved. Rephrase whatHappened in your own words instead of copying it. No technical words like HTTP, console, DOM or request.",
        "If a finding happened several times, say so in the same sentence.",
        "Write the summary as one short paragraph shaped like: A first-time visitor could do X easily but struggled with Y.",
        "Keep each description to 25 words and the summary to 60 words.",
      ].join(" "),
      user: [
        `Title: ${stepFile.title}`,
        `Goal: ${stepFile.goal}`,
        `URL: ${stepFile.url}`,
        stepFile.resultText ? `Outcome: ${stepFile.resultText}` : null,
        `Findings:\n${JSON.stringify(rawFindings, null, 2)}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      json: schema,
    });
    const descriptions = new Map(result.data.findings.map(({ id, description }) => [id, description]));
    await writeReport(jobFolder, {
      headline,
      summary: result.data.summary,
      findings: findings.map((finding) => ({
        ...finding,
        description: descriptions.get(finding.id)!,
      })),
    });
    return modelCostCall(result, "strong");
  } catch (error) {
    if (!(error instanceof ModelOutputError)) throw error;
    await writeReport(jobFolder, { headline, summary: fallbackSummary(findings), findings });
    return modelCostCall(error.usage, "strong");
  }
}
