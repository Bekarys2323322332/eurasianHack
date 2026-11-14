/**
 * The step file is the single source of truth for one job.
 *
 * The agent writes it, and every later stage (script, voice, renderer, the
 * Steps panel, the editor) only reads or updates it. Because of that, this
 * file is the contract between all parts of the project. Do not change the
 * shape without saying so clearly in the pull request.
 *
 * The schema is written with zod so we get both the TypeScript types and a
 * runtime validator from one definition.
 */
import { z } from "zod";

/** What the agent did in a step. */
export const STEP_ACTIONS = ["click", "type", "scroll", "navigate", "wait"] as const;

/**
 * "ok" steps go into the video. "deadend" steps (the action failed or the page
 * did not change) are kept in the log but left out of the video.
 */
export const STEP_STATUSES = ["ok", "deadend"] as const;

/** Demo mode makes a pitch video, how-to mode makes a step-by-step guide. */
export const JOB_MODES = ["demo", "howto"] as const;

export const stepSchema = z.object({
  /** Stable id, also used in file names, for example "s1". */
  id: z.string().min(1),
  /** 1-based position in the run. */
  index: z.number().int().positive(),
  action: z.enum(STEP_ACTIONS),
  /** Plain description of the element the agent used, e.g. "Sign up button". */
  target: z.string(),
  /** Centre of the element in viewport pixels (where the cursor clicks). */
  x: z.number(),
  y: z.number(),
  /** Only set for "type" steps. */
  typedText: z.string().nullable(),
  /** Why the agent took this step. Shown in the Steps panel. */
  reason: z.string(),
  /** Paths relative to the job folder, e.g. "steps/s1-before.png". */
  screenshotBefore: z.string().min(1),
  screenshotAfter: z.string().min(1),
  status: z.enum(STEP_STATUSES),
  /** Filled in by the script stage. Null until then. */
  narration: z.string().nullable(),
  caption: z.string().nullable(),
  /** Filled in by the voice stage. Null until then. */
  audioFile: z.string().nullable(),
  audioSeconds: z.number().nonnegative().nullable(),
  /** True when the user removed the step in the editor. */
  hidden: z.boolean(),
  /** Seconds from action start until the page finished loading. */
  loadSeconds: z.number().nonnegative().optional(),
  /** Number of times the browser action was tried. */
  attempts: z.number().int().positive().optional(),
  /** Which options the agent was unsure how to choose between. */
  confusion: z.string().nullable().optional(),
  /** Browser errors observed while the agent handled this step. */
  errors: z.array(z.string()).optional(),
  /** Why a dead-end step did nothing, in plain words. */
  deadendReason: z.string().nullable().optional(),
});

export const stepFileSchema = z.object({
  jobId: z.string().min(1),
  mode: z.enum(JOB_MODES),
  /** The live app the agent explored. */
  url: z.string().url(),
  /** Optional GitHub repo whose README the planner reads in demo mode. */
  repoUrl: z.string().url().nullable(),
  /** What the video should show. Chosen by the planner in demo mode. */
  goal: z.string(),
  /** Narration and caption language, e.g. "en". */
  language: z.string().min(2),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  /** Shown on the title card. */
  title: z.string(),
  /** False when the agent could not finish the goal honestly. Missing means unknown. */
  goalAchieved: z.boolean().optional(),
  /** What the agent reached, or why it stopped. */
  resultText: z.string().nullable().optional(),
  steps: z.array(stepSchema),
});

export type StepAction = (typeof STEP_ACTIONS)[number];
export type StepStatus = (typeof STEP_STATUSES)[number];
export type JobMode = (typeof JOB_MODES)[number];
export type Step = z.infer<typeof stepSchema>;
export type StepFile = z.infer<typeof stepFileSchema>;

export type ValidationResult =
  | { ok: true; stepFile: StepFile }
  | { ok: false; errors: string[] };

/**
 * Check that an unknown value (usually parsed JSON) is a valid step file.
 *
 * Besides the shape, this also checks that step ids are unique and that the
 * index values run 1, 2, 3 ... in order, because the renderer and the editor
 * rely on both.
 */
export function validateStepFile(value: unknown): ValidationResult {
  const parsed = stepFileSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    };
  }

  const errors: string[] = [];
  const seenIds = new Set<string>();
  parsed.data.steps.forEach((step, position) => {
    if (seenIds.has(step.id)) errors.push(`steps.${position}.id: duplicate id "${step.id}"`);
    seenIds.add(step.id);
    if (step.index !== position + 1) {
      errors.push(`steps.${position}.index: expected ${position + 1}, got ${step.index}`);
    }
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, stepFile: parsed.data };
}
