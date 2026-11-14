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
import { Fragment, useEffect, useState } from "react";
import type { JobView } from "../_lib/jobView";
import type { CostSummary } from "../_lib/costView";
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

/** Format money with more precision for small totals. */
function formatMoney(amount: number): string {
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.01) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(4)}`;
}

/** Show the cost summary and the model usage details for one job. */
function CostPanel({ summary }: { summary: CostSummary }) {
  return (
    <div className={styles.costPanel}>
      <div className={styles.costMetric}>
        <p className={styles.costAmount}>This video cost {formatMoney(summary.costUsd)}</p>
        <p className={styles.costExplanation}>What the AI work for this video cost.</p>
      </div>

      <div className={styles.costMetric}>
        <p className={styles.costAmount}>Without routing: {formatMoney(summary.baselineCostUsd)}</p>
        <p className={styles.costExplanation}>If every AI step used the strongest model and nothing was reused.</p>
      </div>

      {summary.percentSaved !== null && (
        <div className={styles.costMetric}>
          <p className={styles.costAmount}>{summary.percentSaved}% saved</p>
          <p className={styles.costExplanation}>Simple steps went to a cheaper model.</p>
        </div>
      )}

      <div className={styles.costTableWrap}>
        <table className={styles.costTable}>
          <thead>
            <tr>
              <th scope="col">Stage</th>
              <th scope="col">Times</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {summary.modelStages.map((stage) => (
              <Fragment key={stage.label}>
                <tr>
                  <th scope="row">{stage.label}</th>
                  <td>{stage.calls}</td>
                  <td>{stage.costUsd === null ? "not available" : formatMoney(stage.costUsd)}</td>
                </tr>
                <tr className={styles.costTableNotes}>
                  <td colSpan={3}>
                    <span>Times: calls at this stage.</span>
                    <span>
                      {stage.costUsd === null
                        ? "Cost: no price available."
                        : "Cost: total price for this stage."}
                    </span>
                    {stage.unknown && stage.costUsd !== null && (
                      <span>Some calls have no reported price.</span>
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {summary.voice && (
        <div className={styles.costVoice}>
          <h3 className={styles.costDetailTitle}>Voice</h3>
          <p className={styles.costAmount}>
            {summary.voice.costUsd === null ? "not available" : formatMoney(summary.voice.costUsd)}
          </p>
          <p className={styles.costExplanation}>Recording the narration. Routing does not apply here.</p>
          {summary.voice.reused && <span className={styles.costBadge}>Reused</span>}
        </div>
      )}

      <details className={styles.costDetails}>
        <summary>Show details</summary>
        <div className={styles.costDetailsList}>
          {summary.modelStages.map((stage) => (
            <section className={styles.costDetail} key={stage.label}>
              <h3 className={styles.costDetailTitle}>{stage.label}</h3>
              <p className={styles.costDetailLine}>
                <strong>Models:</strong> {stage.models.length ? stage.models.join(", ") : "Not recorded"}
              </p>
              <p className={styles.costNumberNote}>Names of the models used for this stage.</p>
              <p className={styles.costDetailLine}>
                <strong>Tiers:</strong> {stage.tiers.length ? stage.tiers.join(", ") : "Not recorded"}
              </p>
              <p className={styles.costNumberNote}>Routing choices used for this stage.</p>
              <p className={styles.costDetailLine}>
                <strong>Tokens in/out:</strong>{" "}
                {stage.inputTokens.toLocaleString()} / {stage.outputTokens.toLocaleString()}
              </p>
              <p className={styles.costNumberNote}>Amounts of text processed for this stage.</p>
              {stage.cacheHits > 0 && (
                <div className={styles.costBadgeGroup}>
                  <span className={styles.costBadge}>
                    Reused{stage.cacheHits > 1 ? ` (${stage.cacheHits})` : ""}
                  </span>
                  {stage.cacheHits > 1 && (
                    <p className={styles.costNumberNote}>Work was reused this many times in this stage.</p>
                  )}
                </div>
              )}
              {Array.from({ length: stage.escalations }, (_, index) => (
                <span
                  className={styles.costBadge}
                  key={`${stage.label}-escalation-${index}`}
                >
                  Moved to the stronger model
                </span>
              ))}
            </section>
          ))}
        </div>
      </details>
    </div>
  );
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
            {view.cost ? (
              <CostPanel summary={view.cost} />
            ) : (
              <p className={styles.panelEmpty}>What this video cost to make will appear here.</p>
            )}
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
