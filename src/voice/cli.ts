/**
 * Command line wrapper around generateVoice.
 *
 *   npm run voice -- --job data/jobs/abc123 --language en
 *   npm run voice -- --job data/jobs/abc123 --language ru --voice george
 *
 * Reads LLM_API_KEY and LLM_BASE_URL from .env.local (or .env).
 */
import { parseArgs } from "node:util";
import { generateVoice } from "./generateVoice";

// Load keys the same way the Next.js app does: .env.local wins over .env.
// A missing file is fine, the variables may already be set in the shell.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File does not exist.
  }
}

const { values } = parseArgs({
  options: {
    job: { type: "string" },
    language: { type: "string", default: "en" },
    voice: { type: "string" },
  },
});

const { job, language, voice } = values;
if (!job) {
  console.error("Usage: npm run voice -- --job <folder> --language en|ru [--voice name]");
  process.exit(1);
}

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
