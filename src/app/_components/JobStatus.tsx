"use client";
/**
 * The job page body. Polls GET /api/jobs/[id] every 2 seconds and shows one of
 * three views: progress while the video is being made, the finished video,
 * or a plain failure message with a Try again button.
 *
 * The page link stays the same the whole time, so the user can leave and come
 * back to it later.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { JobView } from "../_lib/jobView";
import { toPublicUrl } from "../../shared/publicUrl";
import styles from "./ui.module.css";

/** The four stages in plain words, in order. */
const STAGES = [
  { label: "Exploring the site", statuses: ["queued", "planning", "running"] },
  { label: "Writing the script", statuses: ["scripting"] },
  { label: "Recording the voice", statuses: ["voicing"] },
  { label: "Building the video", statuses: ["rendering"] },
] as const;

/** Rough seconds each stage takes, used for the "time left" estimate. */
const STAGE_SECONDS = [120, 20, 30, 60];

/** Find a number like "Step 3 of up to 12" or "(40% done)" in the message. */
function readProgress(message: string | null) {
  const step = /Step (\d+) of up to (\d+)/.exec(message ?? "");
  const percent = /\((\d+)% done\)/.exec(message ?? "");
  return {
    stepFraction: step ? Math.min(1, Number(step[1]) / Number(step[2])) : 0,
    renderFraction: percent ? Number(percent[1]) / 100 : 0,
  };
}

/** Overall progress (0 to 1) and rough seconds left for a running job. */
function estimate(view: JobView) {
  const { status, progressMessage } = view.job;
  const stageIndex = Math.max(0, STAGES.findIndex((stage) => (stage.statuses as readonly string[]).includes(status)));
  const { stepFraction, renderFraction } = readProgress(progressMessage);
  let withinStage = 0;
  if (status === "planning") withinStage = 0.1;
  if (status === "running") withinStage = 0.1 + 0.9 * stepFraction;
  if (status === "rendering") withinStage = renderFraction;

  const total = STAGE_SECONDS.reduce((sum, seconds) => sum + seconds, 0);
  const done = STAGE_SECONDS.slice(0, stageIndex).reduce((sum, s) => sum + s, 0) + STAGE_SECONDS[stageIndex] * withinStage;
  return { stageIndex, fraction: status === "queued" ? 0 : done / total, secondsLeft: Math.max(5, total - done) };
}

/** "About 2 minutes left" style text. */
function timeLeftText(seconds: number, queued: number) {
  if (queued > 0) return queued === 1 ? "Your video is next in line" : `${queued - 1} videos are ahead of yours`;
  if (seconds < 60) return "Less than a minute left";
  const minutes = Math.round(seconds / 60);
  return `About ${minutes} minute${minutes === 1 ? "" : "s"} left`;
}

export default function JobStatus({ initial, publicBaseUrl }: { initial: JobView; publicBaseUrl: string | null }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const finished = view.job.status === "done" || view.job.status === "failed";

  // Poll every 2 seconds until the job is done or failed.
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/jobs/${view.job.id}`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        setView(await response.json());
        setOffline(false);
      } catch {
        setOffline(true);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [finished, view.job.id]);

  /** Copy the share link, using PUBLIC_BASE_URL when it is set. */
  async function share() {
    const link = toPublicUrl(`/jobs/${view.job.id}`, publicBaseUrl);
    try {
      if (navigator.share) {
        await navigator.share({ title: view.stepFile?.title ?? "Product video", url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // The user closed the share sheet, or the clipboard is blocked.
      window.prompt("Copy this link:", link);
    }
  }

  /** Start a new job with exactly the same inputs. */
  async function tryAgain() {
    setRetrying(true);
    setRetryError(null);
    const { mode, style, url, repoUrl, goal, language } = view.job;
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, style, url, repoUrl, goal, language }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.id) throw new Error(body.error);
      router.push(`/jobs/${body.id}`);
    } catch (problem) {
      setRetryError(
        problem instanceof Error && problem.message
          ? problem.message
          : "We could not start it again. Check your connection and press Try again.",
      );
      setRetrying(false);
    }
  }

  const title = view.stepFile?.title || new URL(view.job.url).hostname;

  if (view.job.status === "failed") {
    return (
      <section className={styles.card} aria-live="polite">
        <h1 className={styles.pageTitle}>We could not finish this video</h1>
        <p className={styles.lead}>{view.job.progressMessage ?? "Something went wrong while making the video."}</p>
        <p className={styles.fieldNote}>
          What to try: press Try again, or use a page that opens without signing in.
        </p>
        {retryError && (
          <p className={styles.error} role="alert">
            {retryError}
          </p>
        )}
        <button type="button" className={styles.primary} onClick={tryAgain} disabled={retrying}>
          {retrying ? "Starting again..." : "Try again"}
        </button>
        <Link href="/" className={styles.secondaryLink}>
          Make a different video
        </Link>
      </section>
    );
  }

  if (view.job.status === "done") {
    const video = view.videos.landscape ?? view.videos.vertical;
    return (
      <div className={styles.doneLayout}>
        <section className={styles.videoColumn}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {video ? (
            <video
              className={styles.video}
              src={video}
              controls
              playsInline
              preload="metadata"
              poster={view.thumbnail ?? undefined}
              aria-label={`Video of ${title}`}
            />
          ) : (
            <p className={styles.panelEmpty}>The video file is missing. Press Make another video to try again.</p>
          )}
          <div className={styles.actions}>
            {video && (
              <a className={styles.primary} href={`${video}?download=1`} download>
                Download video
              </a>
            )}
            <button type="button" className={styles.secondary} onClick={share}>
              {copied ? "Link copied" : "Share link"}
            </button>
          </div>
          <Link href="/" className={styles.secondaryLink}>
            Make another video
          </Link>
        </section>
        <aside className={styles.panels}>
          <section className={styles.panel} aria-labelledby="steps-title">
            <h2 id="steps-title" className={styles.panelTitle}>
              Steps
            </h2>
            <p className={styles.panelEmpty}>
              Each step the agent took will appear here, with a picture and the reason for it.
            </p>
          </section>
          <section className={styles.panel} aria-labelledby="cost-title">
            <h2 id="cost-title" className={styles.panelTitle}>
              Cost
            </h2>
            <p className={styles.panelEmpty}>What this video cost to make will appear here.</p>
          </section>
        </aside>
      </div>
    );
  }

  const { stageIndex, fraction, secondsLeft } = estimate(view);
  return (
    <section className={styles.card} aria-live="polite">
      <h1 className={styles.pageTitle}>Making your video</h1>
      <p className={styles.lead}>{new URL(view.job.url).hostname}</p>

      <ol className={styles.stages}>
        {STAGES.map((stage, index) => {
          const state = index < stageIndex ? "done" : index === stageIndex ? "current" : "next";
          return (
            <li key={stage.label} className={`${styles.stage} ${styles[`stage_${state}`]}`}>
              <span className={styles.stageDot} aria-hidden="true" />
              {stage.label}
              <span className={styles.srOnly}>
                {state === "done" ? " (finished)" : state === "current" ? " (happening now)" : " (coming up)"}
              </span>
            </li>
          );
        })}
      </ol>

      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <div className={styles.progressFill} style={{ width: `${Math.max(3, fraction * 100)}%` }} />
      </div>
      <p className={styles.timeLeft}>{timeLeftText(secondsLeft, view.queuePosition)}</p>
      <p className={styles.message}>{view.job.progressMessage ?? "Getting ready"}</p>
      {offline && (
        <p className={styles.fieldHint} role="status">
          We lost the connection for a moment. Still trying; your video keeps going in the meantime.
        </p>
      )}
      <p className={styles.fieldNote}>You can leave this page. Come back to the same link to see your video.</p>
    </section>
  );
}
