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
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { AUDIENCES, type Audience } from "../../shared/audiences";
import type { JobView } from "../_lib/jobView";
import type { Step, StepFile } from "../../shared/stepFile";
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
                {stage.unknown && stage.costUsd !== null && (
                  <tr className={styles.costTableNotes}>
                    <td colSpan={3}>
                      <span>Some calls have no reported price.</span>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.costNumberNote}>
        Times: how many AI calls this stage made. Cost: what they cost.
      </p>

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
          <p className={styles.costExplanation}>
            Which models answered, which routing tier they used, and how much text they read and wrote.
          </p>
          {summary.modelStages.map((stage) => (
            <section className={styles.costDetail} key={stage.label}>
              <h3 className={styles.costDetailTitle}>{stage.label}</h3>
              <p className={styles.costDetailLine}>
                <strong>Models:</strong> {stage.models.length ? stage.models.join(", ") : "Not recorded"}
              </p>
              <p className={styles.costDetailLine}>
                <strong>Tiers:</strong> {stage.tiers.length ? stage.tiers.join(", ") : "Not recorded"}
              </p>
              <p className={styles.costDetailLine}>
                <strong>Tokens in/out:</strong>{" "}
                {stage.inputTokens.toLocaleString()} / {stage.outputTokens.toLocaleString()}
              </p>
              {stage.cacheHits > 0 && (
                <span className={styles.costBadge}>
                  Reused{stage.cacheHits > 1 ? ` (${stage.cacheHits})` : ""}
                </span>
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

type FindingItem = NonNullable<JobView["findings"]>["findings"][number];

const MAX_FINDINGS_SHOWN = 5;

const SEVERITY_LABELS = {
  high: "Serious",
  medium: "Worth fixing",
  low: "Minor",
} as const;

function findingScreenshotUrl(jobId: string, screenshot: string): string {
  const encodedPath = screenshot.split("/").map(encodeURIComponent).join("/");
  return `/api/jobs/${jobId}/files/${encodedPath}`;
}

const MAX_STEPS_SHOWN = 6;

/** The agent's reasons can run to a paragraph; show the first sentence, trimmed. */
function shortReason(text: string): string {
  const firstSentence = text.trim().match(/^[^.!?]*[.!?]?/)?.[0]?.trim() ?? text.trim();
  return firstSentence.length > 140 ? `${firstSentence.slice(0, 137).trimEnd()}...` : firstSentence;
}

const ACTION_LABELS: Record<Step["action"], (step: Step) => string> = {
  click: (step) => `Clicked "${step.target}"`,
  type: (step) => `Typed into "${step.target}"`,
  scroll: (step) => `Scrolled ${step.target ? `to "${step.target}"` : "the page"}`,
  navigate: (step) => `Opened ${step.target || "the page"}`,
  wait: () => "Waited for the page",
};

function StepsPanel({
  jobId,
  stepFile,
  sceneStarts,
  onSelect,
}: {
  jobId: string;
  stepFile: StepFile | null;
  /** Steps that have a scene in the video; trimmed steps are not clickable. */
  sceneStarts: Record<string, number>;
  onSelect: ((step: Step) => void) | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const steps = stepFile?.steps.filter((step) => !step.hidden) ?? [];
  const deadends = steps.filter((step) => step.status === "deadend").length;
  const shown = showAll ? steps : steps.slice(0, MAX_STEPS_SHOWN);
  return (
    <section className={styles.panel} aria-labelledby="steps-title">
      <h2 id="steps-title" className={styles.panelTitle}>
        Steps
      </h2>
      {steps.length === 0 ? (
        <p className={styles.panelEmpty}>
          Each step the agent took will appear here, with a picture and the reason for it.
        </p>
      ) : (
        <>
          <p className={styles.findingsSummary}>
            {steps.length} {steps.length === 1 ? "step" : "steps"}
            {deadends > 0 && `, ${deadends} ${deadends === 1 ? "dead end" : "dead ends"}`}
            {onSelect && ". Click a step to watch it."}
          </p>
          <ol className={styles.findingsList}>
            {shown.map((step) => {
              const seekable = onSelect !== null && sceneStarts[step.id] !== undefined;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    className={styles.findingCard}
                    onClick={seekable ? () => onSelect(step) : undefined}
                    disabled={!seekable}
                  >
                    <Image
                      className={styles.findingScreenshot}
                      src={findingScreenshotUrl(jobId, step.screenshotAfter)}
                      alt={`Screenshot after step ${step.index}`}
                      width={160}
                      height={90}
                    />
                    <span className={styles.findingCardText}>
                      <span className={styles.findingStep}>
                        Step {step.index}
                        {step.status === "deadend" && (
                          <span className={styles.stepDeadend}> Dead end</span>
                        )}
                      </span>
                      <span className={styles.stepAction}>{ACTION_LABELS[step.action](step)}</span>
                      <span className={styles.findingDescription}>
                        {shortReason(
                          step.status === "deadend" && step.deadendReason?.trim()
                            ? step.deadendReason
                            : step.reason,
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {shown.length < steps.length && (
            <button type="button" className={styles.secondaryLink} onClick={() => setShowAll(true)}>
              Show all {steps.length} steps
            </button>
          )}
        </>
      )}
    </section>
  );
}

function WhatWeFoundPanel({
  jobId,
  report,
  copied,
  copyError,
  onSelect,
  onCopy,
}: {
  jobId: string;
  report: JobView["findings"];
  copied: boolean;
  copyError: boolean;
  onSelect: ((finding: FindingItem) => void) | null;
  onCopy: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const findings = report?.findings ?? [];
  const shown = showAll ? findings : findings.slice(0, MAX_FINDINGS_SHOWN);
  const hiddenCount = findings.length - shown.length;
  return (
    <section className={styles.panel} aria-labelledby="findings-title">
      {report ? (
        <>
          <h2 id="findings-title" className={styles.panelTitle}>
            {report.headline}
          </h2>
          <p className={styles.findingsSummary}>{report.summary}</p>
          {report.findings.length === 0 ? (
            <p className={styles.panelEmpty}>No problems found on this route.</p>
          ) : (
            <div className={styles.findingsList}>
              {shown.map((finding) => (
                <button
                  type="button"
                  className={styles.findingCard}
                  key={finding.id}
                  onClick={onSelect ? () => onSelect(finding) : undefined}
                  disabled={!onSelect}
                >
                  <Image
                    className={styles.findingScreenshot}
                    src={findingScreenshotUrl(jobId, finding.screenshot)}
                    alt={`Screenshot of step ${finding.stepIndex}`}
                    width={160}
                    height={90}
                  />
                  <span className={styles.findingCardText}>
                    <span className={styles.findingSeverity}>
                      {SEVERITY_LABELS[finding.severity]}
                    </span>
                    <span className={styles.findingStep}>
                      {finding.stepIndexes.length > 1
                        ? `Steps ${finding.stepIndexes.join(", ")}`
                        : `Step ${finding.stepIndex}`}
                    </span>
                    <span className={styles.findingDescription}>{finding.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {hiddenCount > 0 && (
            <button type="button" className={styles.secondaryLink} onClick={() => setShowAll(true)}>
              Show all {findings.length}
            </button>
          )}
          <button
            type="button"
            className={`${styles.secondary} ${styles.findingsCopy}`}
            onClick={onCopy}
          >
            {copied ? "Copied" : "Copy as a list"}
          </button>
          {copyError && <p className={styles.error} role="status">Could not copy this list.</p>}
        </>
      ) : (
        <>
          <h2 id="findings-title" className={styles.panelTitle}>What we found</h2>
          <p className={styles.panelEmpty}>
            What a first-time visitor struggled with will appear here.
          </p>
        </>
      )}
    </section>
  );
}

export default function JobStatus({ initial, publicBaseUrl }: { initial: JobView; publicBaseUrl: string | null }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audienceSelectId = useId();
  const [view, setView] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [copied, setCopied] = useState(false);
  const [findingsCopied, setFindingsCopied] = useState(false);
  const [findingsCopyError, setFindingsCopyError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [cutAudience, setCutAudience] = useState<Audience>("investor");
  const [cutting, setCutting] = useState(false);
  const [cutError, setCutError] = useState<string | null>(null);
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
    const { mode, style, audience, url, repoUrl, goal, language } = view.job;
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, style, audience, url, repoUrl, goal, language }),
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

  async function makeAudienceCut() {
    setCutting(true);
    setCutError(null);
    const availableAudiences = (Object.keys(AUDIENCES) as Audience[]).filter(
      (audience) => audience !== view.job.audience,
    );
    const selectedAudience = availableAudiences.includes(cutAudience)
      ? cutAudience
      : availableAudiences[0] ?? "new-user";
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: view.job.mode,
          style: view.job.style,
          audience: selectedAudience,
          url: view.job.url,
          repoUrl: view.job.repoUrl,
          goal: view.job.goal,
          language: view.job.language,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.id) throw new Error(body.error);
      router.push(`/jobs/${body.id}`);
    } catch (problem) {
      setCutError(
        problem instanceof Error && problem.message
          ? problem.message
          : "We could not make that cut. Check your connection and try again.",
      );
      setCutting(false);
    }
  }

  function selectFinding(finding: FindingItem) {
    seekToStep(finding.stepId, finding.stepIndex);
  }

  function seekToStep(stepId: string, stepIndex: number) {
    const video = videoRef.current;
    if (!video) return;

    let sceneStart = view.sceneStarts[stepId];
    if (sceneStart === undefined) {
      const precedingStep = view.stepFile?.steps
        .filter(
          (step) =>
            step.index < stepIndex &&
            view.sceneStarts[step.id] !== undefined,
        )
        .sort((left, right) => right.index - left.index)[0];
      sceneStart = precedingStep ? view.sceneStarts[precedingStep.id] : 0;
    }

    const seekAndPlay = () => {
      video.currentTime = sceneStart!;
      void video.play().catch(() => undefined);
    };
    if (video.readyState > 0) seekAndPlay();
    else video.addEventListener("loadedmetadata", seekAndPlay, { once: true });
  }

  async function copyFindings() {
    const report = view.findings;
    if (!report) return;
    const lines = report.findings.map(
      (finding) =>
        `- [${SEVERITY_LABELS[finding.severity]}] Step ${finding.stepIndex}: ${finding.description}`,
    );
    try {
      await navigator.clipboard.writeText(
        lines.length > 0
          ? `${report.summary}\n\n${lines.join("\n")}`
          : report.summary,
      );
      setFindingsCopyError(false);
      setFindingsCopied(true);
      window.setTimeout(() => setFindingsCopied(false), 2500);
    } catch {
      setFindingsCopyError(true);
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

  if (view.job.status === "done" && view.stepFile?.goalAchieved === false) {
    return (
      <div className={styles.doneLayout}>
        <section className={`${styles.card} ${styles.videoColumn}`} aria-live="polite">
          <h1 className={styles.pageTitle}>We could not complete this route</h1>
          <p className={styles.lead}>
            {view.stepFile.resultText?.trim() || "The AI visitor explored the page but could not finish the goal."}
          </p>
          <p className={styles.fieldNote}>
            No video was made. The steps it tried are listed{" "}
            {view.stepFile?.steps.length ? "beside this" : "below"}. What to try: press Try again, change
            the goal, or use a page that opens without signing in.
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
        <aside className={styles.panels}>
          <WhatWeFoundPanel
            jobId={view.job.id}
            report={view.findings}
            copied={findingsCopied}
            copyError={findingsCopyError}
            onSelect={null}
            onCopy={copyFindings}
          />
          <StepsPanel jobId={view.job.id} stepFile={view.stepFile} sceneStarts={{}} onSelect={null} />
        </aside>
      </div>
    );
  }

  if (view.job.status === "done") {
    const video = view.videos.landscape ?? view.videos.vertical;
    const verticalVideo = !view.videos.landscape && Boolean(view.videos.vertical);
    const otherAudiences = (Object.keys(AUDIENCES) as Audience[]).filter(
      (audience) => audience !== view.job.audience,
    );
    const selectedCutAudience = otherAudiences.includes(cutAudience)
      ? cutAudience
      : otherAudiences[0] ?? "new-user";
    return (
      <div className={styles.doneLayout}>
        <section className={styles.videoColumn}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {video ? (
            <video
              ref={videoRef}
              className={`${styles.video} ${verticalVideo ? styles.videoVertical : ""}`}
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
          {view.stepFile?.resultText?.trim() && (
            <p className={styles.resultText}>
              <strong>Result:</strong> {view.stepFile.resultText.trim()}
            </p>
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
          <div className={styles.audienceCut}>
            <label className={styles.audienceCutLabel} htmlFor={audienceSelectId}>
              Audience
            </label>
            <select
              id={audienceSelectId}
              className={styles.input}
              value={selectedCutAudience}
              onChange={(event) => setCutAudience(event.target.value as Audience)}
            >
              {otherAudiences.map((audience) => (
                <option key={audience} value={audience}>
                  {AUDIENCES[audience].label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.secondary}
              onClick={makeAudienceCut}
              disabled={cutting}
            >
              {cutting ? "Making the cut..." : "Make a cut for another audience"}
            </button>
            {cutError && <p className={styles.error} role="alert">{cutError}</p>}
          </div>
          <Link href="/" className={styles.secondaryLink}>
            Make another video
          </Link>
        </section>
        <aside className={styles.panels}>
          <WhatWeFoundPanel
            jobId={view.job.id}
            report={view.findings}
            copied={findingsCopied}
            copyError={findingsCopyError}
            onSelect={selectFinding}
            onCopy={copyFindings}
          />
          <StepsPanel
            jobId={view.job.id}
            stepFile={view.stepFile}
            sceneStarts={view.sceneStarts}
            onSelect={(step) => seekToStep(step.id, step.index)}
          />
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
