/**
 * Standalone entry point for creating a job and running the planner/browser
 * agent without starting the web application.
 */
import { existsSync } from "node:fs";
import { createJob } from "../shared/jobs";
import type { JobMode } from "../shared/stepFile";
import { formatTotalCost } from "./cost";
import { runAgent } from "./index";

interface CliOptions {
  url: string;
  goal?: string;
  mode: JobMode;
  repoUrl?: string;
}

/** Parse the small, documented set of command-line options. */
function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Expected a value after ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }

  const url = values.get("--url");
  if (!url) {
    throw new Error('Pass a public page with "--url <url>".');
  }
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("The page URL must use HTTP or HTTPS.");
  }

  const goal = values.get("--goal");
  const requestedMode = values.get("--mode");
  const mode =
    requestedMode === undefined ? (goal ? "howto" : "demo") : requestedMode;
  if (mode !== "demo" && mode !== "howto") {
    throw new Error('The mode must be either "demo" or "howto".');
  }

  const repoUrl = values.get("--repo");
  if (repoUrl) {
    const parsedRepoUrl = new URL(repoUrl);
    if (parsedRepoUrl.protocol !== "http:" && parsedRepoUrl.protocol !== "https:") {
      throw new Error("The repository URL must use HTTP or HTTPS.");
    }
  }

  return { url, goal, mode, repoUrl };
}

/** Load the local environment file before creating or running the job. */
function loadLocalEnvironment(): void {
  if (!existsSync(".env")) return;
  try {
    process.loadEnvFile?.(".env");
  } catch (error) {
    throw new Error(`Could not load .env: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Create the queued job, run the agent, and print the two useful output values. */
async function main(): Promise<void> {
  loadLocalEnvironment();
  const options = parseArgs(process.argv.slice(2));
  const job = createJob({
    mode: options.mode,
    url: options.url,
    goal: options.goal,
    repoUrl: options.repoUrl,
  });
  const result = await runAgent(job, {
    onProgress: (message) => console.log(message),
  });

  console.log(`Step file: ${result.stepFilePath}`);
  console.log(formatTotalCost(result.costUsd, result.unknownCostModel));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
