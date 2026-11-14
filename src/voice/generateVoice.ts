/**
 * Turns the narration text in a step file into audio files.
 *
 *   const summary = await generateVoice("data/jobs/abc123", { language: "en" });
 *
 * For every step that will be shown in the video (status "ok", not hidden)
 * and has narration text, this writes <jobFolder>/audio/<stepId>.mp3 and
 * records audioFile and audioSeconds in steps.json, which is exactly what
 * the renderer reads.
 *
 * Lines that were generated before are copied from a cache instead of being
 * paid for again. One failing line never fails the job: it is retried once
 * and then left without audio.
 *
 * Server-side only (reads and writes files, calls the speech provider).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateStepFile } from "../shared/stepFile";
import { resolveVoice } from "./config";
import { mp3DurationSeconds } from "./mp3Duration";
import { PROVIDER_NAME, lookupCost, synthesize } from "./provider";

export interface VoiceOptions {
  /** Language of the narration text, e.g. "en" or "ru". See config.ts. */
  language: string;
  /** Voice name from config.ts. Left out: the language's default voice. */
  voice?: string;
}

export interface VoiceSummary {
  /** Lines the provider made in this run. */
  generated: number;
  /** Lines copied from the cache, at no cost. */
  cached: number;
  /** Lines that still failed after one retry. Those steps have no audio. */
  failed: number;
  /** What went wrong for each failed line, in plain words. */
  failures: { stepId: string; error: string }[];
  /**
   * What this run cost in US dollars, as reported by the provider. Null when
   * the provider did not report a cost for at least one generated line.
   */
  totalCost: number | null;
}

/** Shared by all jobs, so the same line in two jobs is only paid for once. */
function cacheDir(): string {
  return path.join(path.resolve(process.env.DATA_DIR || "./data"), "voice-cache");
}

/** Cache file for one line. The name is a fingerprint of everything that affects the sound. */
function cachePath(text: string, language: string, voice: string): string {
  const key = JSON.stringify([text, language, voice, PROVIDER_NAME]);
  return path.join(cacheDir(), `${createHash("sha256").update(key).digest("hex")}.mp3`);
}

/** Call the provider, and if that fails, once more before giving up. */
async function synthesizeWithRetry(text: string, voice: string) {
  try {
    return await synthesize(text, voice);
  } catch {
    return await synthesize(text, voice);
  }
}

export async function generateVoice(
  jobFolder: string,
  options: VoiceOptions,
): Promise<VoiceSummary> {
  jobFolder = path.resolve(jobFolder);
  // Fails early, before any money is spent, if the language or voice is unknown.
  const voice = resolveVoice(options.language, options.voice);

  const stepsPath = path.join(jobFolder, "steps.json");
  if (!fs.existsSync(stepsPath)) {
    throw new Error(`No steps.json found in ${jobFolder}. Run the agent first.`);
  }
  // The file exactly as it is on disk. It is kept so that fields the shared
  // step file type does not know about yet are still there after saving.
  const raw = JSON.parse(fs.readFileSync(stepsPath, "utf8"));
  const checked = validateStepFile(raw);
  if (!checked.ok) {
    throw new Error(`steps.json in ${jobFolder} is not valid:\n${checked.errors.join("\n")}`);
  }
  const stepFile = checked.stepFile;

  fs.mkdirSync(path.join(jobFolder, "audio"), { recursive: true });
  fs.mkdirSync(cacheDir(), { recursive: true });

  const summary: VoiceSummary = { generated: 0, cached: 0, failed: 0, failures: [], totalCost: 0 };
  const requestIds: (string | null)[] = [];

  // ponytail: lines are done one after another (about a second each). Run a
  // few at once if jobs with many steps make this the slow part.
  for (const step of stepFile.steps) {
    const text = step.narration?.trim();
    if (step.status !== "ok" || step.hidden || !text) continue;

    const audioFile = `audio/${step.id}.mp3`;
    const target = path.join(jobFolder, audioFile);
    const cached = cachePath(text, options.language, voice);

    try {
      if (fs.existsSync(cached)) {
        summary.cached += 1;
      } else {
        const speech = await synthesizeWithRetry(text, voice);
        // Write under a temporary name first so a crash half way through
        // can never leave a broken file in the cache.
        fs.writeFileSync(`${cached}.part`, speech.audio);
        fs.renameSync(`${cached}.part`, cached);
        requestIds.push(speech.requestId);
        summary.generated += 1;
      }
      fs.copyFileSync(cached, target);
      step.audioFile = audioFile;
      // Rounded to milliseconds to keep steps.json tidy.
      step.audioSeconds = Math.round(mp3DurationSeconds(fs.readFileSync(target)) * 1000) / 1000;
    } catch (error) {
      // Leave the step silent rather than pointing at audio from an older
      // run that may not match the current text or language.
      fs.rmSync(target, { force: true });
      step.audioFile = null;
      step.audioSeconds = null;
      summary.failed += 1;
      summary.failures.push({
        stepId: step.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Only the two audio fields are changed. They are copied into the file as
  // it was read, not into the checked copy, because the checker drops any
  // field it does not know (for example a step's "keyWord"), and saving the
  // checked copy would silently delete those.
  const audioById = new Map(stepFile.steps.map((step) => [step.id, step]));
  for (const rawStep of raw.steps) {
    const voiced = audioById.get(rawStep.id);
    if (!voiced) continue;
    rawStep.audioFile = voiced.audioFile;
    rawStep.audioSeconds = voiced.audioSeconds;
  }
  fs.writeFileSync(stepsPath, `${JSON.stringify(raw, null, 2)}\n`);

  // Ask the provider what the new lines cost. Cached lines cost nothing.
  const costs = await Promise.all(requestIds.map((id) => (id ? lookupCost(id) : null)));
  summary.totalCost = costs.some((cost) => cost === null)
    ? null
    : costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);

  return summary;
}
