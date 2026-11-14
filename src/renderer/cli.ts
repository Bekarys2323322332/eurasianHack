/**
 * Command line wrapper around renderJob.
 *
 *   npx tsx src/renderer/cli.ts --job fixtures/fake-job --aspect 16:9
 *   npx tsx src/renderer/cli.ts --job fixtures/fake-job --style social --no-music
 *
 * Run it with "npx tsx <file>" as shown. "npm run render -- --job ..." also
 * works in bash, but PowerShell strips the flag names before they get here,
 * so the npx form is the one that works everywhere.
 *
 * --style is trailer, tutorial or social. Without it, demo videos use
 * trailer and how-to videos use tutorial.
 * --aspect is 16:9 or 9:16. Without it, social videos are 9:16 (the shape
 * that style is designed for) and everything else is 16:9.
 */
import { parseArgs } from "node:util";
import { renderJob } from "./renderJob";

const USAGE =
  "Usage: npx tsx src/renderer/cli.ts --job <folder> [--aspect 16:9|9:16] " +
  "[--style trailer|tutorial|social] [--no-music]";

/** Print what went wrong and how to call the script, then stop. */
function stop(problem: string): never {
  console.error(`${problem}\n${USAGE}`);
  process.exit(1);
}

function readFlags() {
  try {
    return parseArgs({
      options: {
        job: { type: "string" },
        aspect: { type: "string" },
        style: { type: "string" },
        music: { type: "boolean", default: true },
      },
      // Lets the user write --no-music.
      allowNegative: true,
    }).values;
  } catch (error) {
    // Typical cause on Windows: "npm run render -- --job x" in PowerShell,
    // which passes on "x" without the "--job" in front of it.
    return stop(
      `Could not read the options (${error instanceof Error ? error.message : error}).\n` +
        "If you used npm run in PowerShell, the flag names were dropped. Use the npx form.",
    );
  }
}

const flags = readFlags();
const { job, style, music } = flags;
if (!job) stop("Missing --job <folder>.");
if (style !== undefined && style !== "trailer" && style !== "tutorial" && style !== "social") {
  stop(`Unknown style "${style}".`);
}
const aspect = flags.aspect ??(style === "social" ? "9:16" : "16:9");
if (aspect !== "16:9" && aspect !== "9:16") stop(`Unknown aspect "${aspect}".`);

const started = Date.now();
// renderJob reports at least every 5 percent, and every report is printed.
renderJob(job, { aspect, style, music }, (percent) => console.log(`Rendering: ${percent}%`))
  .then((file) => {
    console.log(`Done in ${Math.round((Date.now() - started) / 1000)} seconds: ${file}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
