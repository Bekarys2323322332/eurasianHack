"use client";
/**
 * The home page form: pick a mode, paste a link, press Generate.
 *
 * Demo mode is preselected and every option has a default, so a first-time
 * visitor can paste a link and press the button without changing anything.
 * The link is checked as the user types, and errors keep what was typed.
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { LANGUAGES } from "../../voice/config";
import styles from "./ui.module.css";

type Mode = "demo" | "howto";

/** Working examples that fill the form in one tap. */
const EXAMPLES: { label: string; mode: Mode; url: string; extra: string }[] = [
  {
    label: "A to-do list app",
    mode: "demo",
    url: "https://todomvc.com/examples/react/dist/",
    extra: "https://github.com/tastejs/todomvc",
  },
  {
    label: "How to search Wikipedia",
    mode: "howto",
    url: "https://en.wikipedia.org",
    extra: "How to search for an article and open it",
  },
];

/** Returns a plain sentence when the value is not a web address, else null. */
function checkWebAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".")) return null;
  } catch {
    // Fall through to the message below.
  }
  return "This is not a web address yet. It should look like https://example.com";
}

export default function JobForm() {
  const router = useRouter();
  const ids = { url: useId(), extra: useId(), language: useId(), error: useId() };
  const [mode, setMode] = useState<Mode>("demo");
  const [url, setUrl] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [language, setLanguage] = useState("en");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlProblem = checkWebAddress(url);
  const repoProblem = mode === "demo" ? checkWebAddress(repoUrl) : null;

  function fillExample(example: (typeof EXAMPLES)[number]) {
    setMode(example.mode);
    setUrl(example.url);
    if (example.mode === "demo") setRepoUrl(example.extra);
    else setGoal(example.extra);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return setError("Paste a link to your product first, for example https://example.com");
    if (urlProblem || repoProblem) return setError(urlProblem ?? repoProblem);
    if (mode === "howto" && !goal.trim()) {
      return setError("Tell us what the video should show, for example: How to create a new project.");
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          url: url.trim(),
          repoUrl: mode === "demo" ? repoUrl.trim() || null : null,
          goal: mode === "howto" ? goal.trim() : null,
          language,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.id) {
        throw new Error(body.error ?? "We could not start your video. Please try again in a moment.");
      }
      router.push(`/jobs/${body.id}`);
    } catch (problem) {
      setError(
        problem instanceof Error && problem.message !== "Failed to fetch"
          ? problem.message
          : "We could not reach the app. Check your connection and try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.card} onSubmit={submit} noValidate>
      <fieldset className={styles.modes}>
        <legend className={styles.srOnly}>What kind of video?</legend>
        {(
          [
            ["demo", "Show off my product", "A short video of the best things it can do."],
            ["howto", "Explain how to do something", "A step-by-step video for one task."],
          ] as const
        ).map(([value, title, description]) => (
          <label key={value} className={`${styles.mode} ${mode === value ? styles.modeActive : ""}`}>
            <input
              type="radio"
              name="mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
              className={styles.srOnly}
            />
            <span className={styles.modeTitle}>{title}</span>
            <span className={styles.modeText}>{description}</span>
          </label>
        ))}
      </fieldset>

      <label htmlFor={ids.url} className={styles.label}>
        Link to your product
      </label>
      <input
        id={ids.url}
        className={styles.input}
        type="url"
        inputMode="url"
        autoComplete="url"
        placeholder="https://your-product.com"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        aria-invalid={Boolean(urlProblem)}
        aria-describedby={urlProblem ? `${ids.url}-hint` : undefined}
      />
      {urlProblem && (
        <p id={`${ids.url}-hint`} className={styles.fieldHint} role="status">
          {urlProblem}
        </p>
      )}

      {mode === "demo" ? (
        <>
          <label htmlFor={ids.extra} className={styles.label}>
            Code repository link <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id={ids.extra}
            className={styles.input}
            type="url"
            inputMode="url"
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            aria-invalid={Boolean(repoProblem)}
          />
          <p className={styles.fieldNote}>We read its description to pick the best things to show.</p>
        </>
      ) : (
        <>
          <label htmlFor={ids.extra} className={styles.label}>
            What should the video show?
          </label>
          <input
            id={ids.extra}
            className={styles.input}
            type="text"
            placeholder="How to create a new project"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
          />
        </>
      )}

      <details className={styles.more}>
        <summary className={styles.moreSummary}>More options</summary>
        <label htmlFor={ids.language} className={styles.label}>
          Language of the video
        </label>
        <select
          id={ids.language}
          className={styles.input}
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          {Object.entries(LANGUAGES).map(([code, option]) => (
            <option key={code} value={code}>
              {option.label}
            </option>
          ))}
        </select>
        <p className={styles.fieldNote}>Narration is written and spoken in this language.</p>
      </details>

      {error && (
        <p id={ids.error} className={styles.error} role="alert">
          {error}
        </p>
      )}

      <button type="submit" className={styles.primary} disabled={submitting}>
        {submitting ? "Starting your video..." : "Generate video"}
      </button>

      <div className={styles.examples}>
        <span className={styles.examplesLabel}>Try an example:</span>
        {EXAMPLES.map((example) => (
          <button key={example.label} type="button" className={styles.chip} onClick={() => fillExample(example)}>
            {example.label}
          </button>
        ))}
      </div>
    </form>
  );
}
