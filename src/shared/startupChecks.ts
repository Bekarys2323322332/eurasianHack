import { spawnSync } from "node:child_process";
import { getDb } from "./jobs";

export interface CheckResult {
  name: string;
  ok: boolean;
  message: string;
  required: boolean;
  fix?: string;
}

export const REQUIRED_ENV_VARS = [
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "SMALL_MODEL",
  "STRONG_MODEL",
] as const;
export const OPTIONAL_ENV_VARS = ["TTS_API_KEY"] as const;

export function checkEnv(env: Record<string, string | undefined> = process.env): CheckResult[] {
  const requiredEnvVars = new Set<string>(REQUIRED_ENV_VARS);
  return [...REQUIRED_ENV_VARS, ...OPTIONAL_ENV_VARS].map((name) => {
    const ok = typeof env[name] === "string" && env[name]!.trim().length > 0;
    return {
      name,
      ok,
      required: requiredEnvVars.has(name),
      message: `${name} is ${ok ? "set" : "missing"}`,
      ...(ok ? {} : { fix: `Set ${name} in .env` }),
    };
  });
}

export function summarizeChecks(
  checks: CheckResult[],
): { ok: boolean; warnings: CheckResult[] } {
  return {
    ok: checks.filter((check) => check.required).every((check) => check.ok),
    warnings: checks.filter((check) => !check.required && !check.ok),
  };
}

export async function checkChromium(): Promise<CheckResult> {
  let browser: { close: () => Promise<void>; newPage: () => Promise<{ close: () => Promise<void> }> } | undefined;
  let expired = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutCheck = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        expired = true;
        reject(new Error("Chromium check timed out after 20 seconds"));
      }, 20_000);
    });
    const launchCheck = (async () => {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ headless: true, timeout: 20_000 });
      if (expired) {
        await browser.close();
        browser = undefined;
        throw new Error("Chromium check timed out after 20 seconds");
      }
      const page = await browser.newPage();
      await page.close();
    })();

    await Promise.race([launchCheck, timeoutCheck]);
    return {
      name: "Chromium",
      ok: true,
      message: "Chromium launched successfully",
      required: true,
    };
  } catch (error) {
    return {
      name: "Chromium",
      ok: false,
      message: `Chromium could not launch: ${error instanceof Error ? error.message : String(error)}`,
      required: true,
      fix: "Run: npx playwright install chromium",
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    if (browser) await browser.close().catch(() => undefined);
  }
}

export function checkFfmpeg(): CheckResult {
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (!result.error && result.status === 0) {
    return { name: "ffmpeg", ok: true, message: "ffmpeg is available", required: true };
  }

  let installInstruction: string;
  if (process.platform === "darwin") {
    installInstruction = "brew install ffmpeg";
  } else if (process.platform === "win32") {
    installInstruction = "winget install Gyan.FFmpeg";
  } else {
    installInstruction = "Install ffmpeg with your Linux package manager";
  }
  return {
    name: "ffmpeg",
    ok: false,
    message: "ffmpeg is not available on PATH",
    required: true,
    fix: `${installInstruction}, then restart the terminal`,
  };
}

export function checkDatabase(): CheckResult {
  try {
    getDb().prepare("SELECT 1").get();
    return {
      name: "Database",
      ok: true,
      message: "SQLite database is ready",
      required: true,
    };
  } catch {
    return {
      name: "Database",
      ok: false,
      message: "SQLite database could not be opened",
      required: true,
      fix: "Run npm run setup",
    };
  }
}

export async function runStartupChecks(): Promise<{
  ok: boolean;
  checks: CheckResult[];
  warnings: CheckResult[];
}> {
  const checks = [
    ...checkEnv(),
    await checkChromium(),
    checkFfmpeg(),
    checkDatabase(),
  ];
  return { ...summarizeChecks(checks), checks };
}

export function formatCheckReport(result: { ok: boolean; checks: CheckResult[] }): string {
  const failedChecks = result.checks.filter((check) => check.required && !check.ok);
  if (failedChecks.length === 0) return "Startup checks passed.";

  return [
    "Startup checks failed:",
    ...failedChecks.flatMap((check) => [
      `- ${check.name}: ${check.message}`,
      ...(check.fix ? [`  Fix: ${check.fix}`] : []),
    ]),
  ].join("\n");
}
