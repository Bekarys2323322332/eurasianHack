/**
 * The job pipeline: agent, then script, then voice, then render.
 *
 * Only one job runs at a time (one browser and one render at once is all a
 * laptop can take). Other jobs wait in an in-memory queue, in the order they
 * were created. The queue lives on globalThis so Next's dev reloads do not
 * create a second copy.
 */
import { getJob, getJobDir, listJobs, updateJob, type Job } from "../../shared/jobs";
import { LANGUAGES } from "../../voice/config";
import {
  appendCostCall,
  generateVoice,
  PROVIDER_NAME,
  renderJob,
  runAgent,
  writeScript,
} from "./stages";

interface PipelineState {
  queue: string[];
  running: string | null;
  resumed: boolean;
}

const globalForPipeline = globalThis as typeof globalThis & { __pipeline?: PipelineState };
const state: PipelineState = (globalForPipeline.__pipeline ??= {
  queue: [],
  running: null,
  resumed: false,
});

/** Statuses that mean a job was in the middle of a stage. */
const ACTIVE_STATUSES: Job["status"][] = ["planning", "running", "scripting", "voicing", "rendering"];

/**
 * Called once per server process. Jobs still "queued" in the database go back
 * in the queue. Jobs that were mid-run when the app stopped cannot be resumed,
 * so they are marked failed with a plain message and a Try again path.
 */
export function resumePendingJobs() {
  if (state.resumed) return;
  state.resumed = true;
  const jobs = listJobs({ limit: 500 }).reverse();
  for (const job of jobs) {
    if (job.status === "queued") {
      state.queue.push(job.id);
    } else if (ACTIVE_STATUSES.includes(job.status) && job.id !== state.running) {
      updateJob(job.id, {
        status: "failed",
        progressMessage: "The app restarted while this video was being made. Press Try again to start it again.",
      });
    }
  }
  void drain();
}

/** Add a new job to the end of the queue and start it if nothing is running. */
export function enqueueJob(jobId: string) {
  resumePendingJobs();
  if (!state.queue.includes(jobId) && state.running !== jobId) state.queue.push(jobId);
  void drain();
}

/**
 * The app is shared through a public tunnel, so cap how many jobs can wait.
 * Each one runs a browser and ffmpeg, and a long line is useless to visitors anyway.
 */
const MAX_WAITING_JOBS = 10;

/** True when the line is full and new jobs should be turned away for now. */
export function isQueueFull(): boolean {
  resumePendingJobs();
  return state.queue.length >= MAX_WAITING_JOBS;
}

/** 0 when the job is running or not queued, otherwise its place in line (1 = next). */
export function queuePosition(jobId: string): number {
  const index = state.queue.indexOf(jobId);
  return index === -1 ? 0 : index + 1;
}

/** Run queued jobs one after another until the queue is empty. */
async function drain() {
  if (state.running) return;
  const next = state.queue.shift();
  if (!next) return;
  state.running = next;
  try {
    await runPipeline(next);
  } finally {
    state.running = null;
    void drain();
  }
}

/** Turn any error into a sentence that says what happened and what to do. */
function plainFailure(stage: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Something went wrong while ${stage}: ${detail}. Press Try again, or try a different page.`;
}

/** Run every stage for one job and keep its status up to date. */
async function runPipeline(jobId: string) {
  const job = getJob(jobId);
  if (!job) return;
  let stage = "exploring the site";
  try {
    await runAgent(job);

    stage = "writing the script";
    updateJob(jobId, { status: "scripting", progressMessage: "Writing the script" });
    const jobFolder = getJobDir(jobId);
    const scriptCall = await writeScript(jobFolder, {
      languageName: LANGUAGES[job.language]?.label ?? "English",
      style: job.style,
    });
    appendCostCall(jobFolder, "script", {
      model: scriptCall.model,
      inputTokens: scriptCall.inputTokens,
      outputTokens: scriptCall.outputTokens,
      costUsd: scriptCall.costUsd,
      tier: scriptCall.tier,
      escalated: scriptCall.escalated,
      cacheHit: scriptCall.cacheHit,
      baselineCostUsd: scriptCall.baselineCostUsd,
    });

    stage = "recording the voice";
    updateJob(jobId, { status: "voicing", progressMessage: "Recording the voice" });
    const voiceSummary = await generateVoice(jobFolder, { language: job.language });
    appendCostCall(jobFolder, "voice", {
      model: PROVIDER_NAME,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: voiceSummary.totalCost,
      cacheHit: voiceSummary.generated === 0 && voiceSummary.cached > 0,
    });
    if (voiceSummary.failed > 0) {
      console.warn(
        `Voice generation failed for ${voiceSummary.failed} step(s); the renderer will use silent audio for them.`,
        voiceSummary.failures,
      );
    }

    stage = "building the video";
    updateJob(jobId, { status: "rendering", progressMessage: "Building the video" });
    let lastPercent = -1;
    await renderJob(
      getJobDir(jobId),
      {
        aspect: job.style === "social" ? "9:16" : "16:9",
        music: true,
        style: job.style,
      },
      (percent) => {
        // Write at most every 5 percent so the database is not flooded.
        if (percent >= lastPercent + 5 || percent === 100) {
          lastPercent = percent;
          updateJob(jobId, { progressMessage: `Building the video (${percent}% done)` });
        }
      },
    );

    updateJob(jobId, { status: "done", progressMessage: "Your video is ready" });
  } catch (error) {
    console.error(`Job ${jobId} failed while ${stage}:`, error);
    // The agent writes its own plain failure message (for example a login
    // wall). Keep it instead of replacing it with a generic one.
    if (getJob(jobId)?.status !== "failed") {
      updateJob(jobId, { status: "failed", progressMessage: plainFailure(stage, error) });
    }
  }
}
