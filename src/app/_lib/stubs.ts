/**
 * Stand-ins for the agent and the renderer.
 *
 * - runAgentStub copies fixtures/fake-job into the job folder, so the job has
 *   a real step file and screenshots without opening a browser.
 * - renderJobStub turns the screenshots into a simple slideshow with ffmpeg
 *   (ffmpeg is already required by the startup check), so the job page always
 *   has a real video to play.
 *
 * Both keep the exact signatures of the real functions so they can be swapped
 * in stages.ts without touching the pipeline.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getJobDir, updateJob, type Job } from "../../shared/jobs";
import { validateStepFile, type StepFile } from "../../shared/stepFile";

/** Same shape as the real agent's result (src/agent). */
export interface AgentResult {
  stepFile: StepFile;
  stepFilePath: string;
  costUsd: number;
}

/** Same shape as the real renderer's options (src/renderer/renderJob.ts). */
export interface RenderOptions {
  aspect: "16:9" | "9:16";
  /** Add background music when available. The stub ignores it. */
  music: boolean;
}

const FIXTURE_DIR = path.resolve("fixtures", "fake-job");

/** Small pause so the progress view has something to show while testing. */
function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pretend to explore the site: copy the fake job's step file and screenshots,
 * rewriting the job fields so the result belongs to this job.
 */
export async function runAgentStub(
  job: Job,
  options: { onProgress?: (message: string) => void } = {},
): Promise<AgentResult> {
  const jobDir = getJobDir(job.id);
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "steps.json"), "utf8"));

  updateJob(job.id, { status: "planning", progressMessage: "Reading the page" });
  await pause(1500);

  updateJob(job.id, { status: "running" });
  fs.mkdirSync(path.join(jobDir, "steps"), { recursive: true });
  const steps = fixture.steps as StepFile["steps"];
  for (const step of steps) {
    const message = `Step ${step.index} of up to ${steps.length}: ${step.action} ${step.target}`;
    updateJob(job.id, { progressMessage: message });
    options.onProgress?.(message);
    for (const shot of [step.screenshotBefore, step.screenshotAfter]) {
      fs.copyFileSync(path.join(FIXTURE_DIR, shot), path.join(jobDir, shot));
    }
    await pause(700);
  }

  const result = validateStepFile({
    ...fixture,
    jobId: job.id,
    mode: job.mode,
    url: job.url,
    repoUrl: job.repoUrl,
    goal: job.goal ?? fixture.goal,
    language: job.language,
  });
  if (!result.ok) throw new Error(`Fixture step file is not valid: ${result.errors.join("; ")}`);

  const stepFilePath = path.join(jobDir, "steps.json");
  fs.writeFileSync(stepFilePath, JSON.stringify(result.stepFile, null, 2));
  return { stepFile: result.stepFile, stepFilePath, costUsd: 0 };
}

/**
 * Build a slideshow from the visible steps' screenshots: each before/after
 * image is shown for 1.5 seconds. Writes video-16x9.mp4 or video-9x16.mp4 in
 * the job folder and returns its path, like the real renderer.
 */
export async function renderJobStub(
  jobFolder: string,
  options: RenderOptions,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const stepFile = JSON.parse(fs.readFileSync(path.join(jobFolder, "steps.json"), "utf8")) as StepFile;
  const shots = stepFile.steps
    .filter((step) => step.status === "ok" && !step.hidden)
    .flatMap((step) => [step.screenshotBefore, step.screenshotAfter]);
  if (shots.length === 0) throw new Error("There are no steps to put in the video.");

  // ffmpeg's concat demuxer reads a list of images with a duration for each.
  const listFile = path.join(jobFolder, "slideshow.txt");
  // Paths are single-quoted in the list, so a quote inside a path is written as '\''.
  const quote = (shot: string) => `'${path.resolve(jobFolder, shot).replace(/'/g, "'\\''")}'`;
  const lines = shots.flatMap((shot) => [`file ${quote(shot)}`, "duration 1.5"]);
  // The last image must be listed twice or its duration is ignored.
  lines.push(`file ${quote(shots[shots.length - 1])}`);
  fs.writeFileSync(listFile, lines.join("\n"));

  const vertical = options.aspect === "9:16";
  const output = path.join(jobFolder, vertical ? "video-9x16.mp4" : "video-16x9.mp4");
  const size = vertical ? "720:1280" : "1280:720";
  const filter = `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
  const totalSeconds = shots.length * 1.5;

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listFile,
      "-vf", filter, "-r", "30", "-c:v", "libx264", "-movflags", "+faststart",
      "-progress", "pipe:1", "-nostats", output,
    ]);
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk.toString()));
    // ffmpeg reports out_time_ms (microseconds, despite the name) as it goes.
    child.stdout.on("data", (chunk: Buffer) => {
      const match = /out_time_ms=(\d+)/.exec(chunk.toString());
      if (match) onProgress?.(Math.min(99, Math.round((Number(match[1]) / 1e6 / totalSeconds) * 100)));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg could not build the video: ${errors.slice(-500)}`));
    });
  });

  fs.rmSync(listFile, { force: true });
  onProgress?.(100);
  return output;
}
