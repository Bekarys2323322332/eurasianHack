/**
 * Command line wrapper around generateVoice.
 *
 *   npx tsx src/voice/cli.ts --job data/jobs/abc123 --language en
 *   npx tsx src/voice/cli.ts --job data/jobs/abc123 --language ru --voice george
 *
 * Run it with "npx tsx <file>" as shown. "npm run voice -- --job ..." also
 * works in bash, but PowerShell strips the flag names before they get here,
 * so the npx form is the one that works everywhere.
 *
 * Reads LLM_API_KEY and LLM_BASE_URL from .env.local (or .env).
 */
import { parseArgs } from "node:util";
import { generateVoice } from "./generateVoice";

const USAGE = "Usage: npx tsx src/voice/cli.ts --job <folder> [--language en|ru] [--voice name]";

/** Print what went wrong and how to call the script, then stop. */
function stop(problem: string): never {
  console.error(`${problem}\n${USAGE}`);
  process.exit(1);
}

// Load keys the same way the Next.js app does: .env.local wins over .env.
// A missing file is fine, the variables may already be set in the shell.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File does not exist.
  }
}

function readFlags() {
  try {
    return parseArgs({
      options: {
        job: { type: "string" },
        language: { type: "string", default: "en" },
        voice: { type: "string" },
      },
    }).values;
  } catch (error) {
    // Typical cause on Windows: "npm run voice -- --job x" in PowerShell,
    // which passes on "x" without the "--job" in front of it.
    return stop(
      `Could not read the options (${error instanceof Error ? error.message : error}).\n` +
        "If you used npm run in PowerShell, the flag names were dropped. Use the npx form.",
    );
  }
}

const { job, language, voice } = readFlags();
if (!job) stop("Missing --job <folder>.");

generateVoice(job, { language, voice })
  .then((summary) => {
    console.log(`Lines generated: ${summary.generated}`);
    console.log(`Lines from cache: ${summary.cached}`);
    console.log(`Lines failed: ${summary.failed}`);
    for (const failure of summary.failures) {
      console.log(`  ${failure.stepId}: ${failure.error}`);
    }
    console.log(
      summary.totalCost === null
        ? "Cost: not reported by the provider"
        : `Cost: $${summary.totalCost.toFixed(4)}`,
    );
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
