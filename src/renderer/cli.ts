/**
 * Command line wrapper around renderJob.
 *
 *   npm run render -- --job fixtures/fake-job --aspect 16:9
 *   npm run render -- --job fixtures/fake-job --aspect 9:16 --style social --no-music
 *
 * --style is trailer, tutorial or social. Without it, demo videos use
 * trailer and how-to videos use tutorial.
 */
import { parseArgs } from "node:util";
import { renderJob } from "./renderJob";

const { values } = parseArgs({
  options: {
    job: { type: "string" },
    aspect: { type: "string", default: "16:9" },
    style: { type: "string" },
    music: { type: "boolean", default: true },
  },
  // Lets the user write --no-music.
  allowNegative: true,
});

const { job, aspect, style, music } = values;
const styleIsValid =
  style === undefined || style === "trailer" || style === "tutorial" || style === "social";
if (!job || (aspect !== "16:9" && aspect !== "9:16") || !styleIsValid) {
  console.error(
    "Usage: npm run render -- --job <folder> --aspect 16:9|9:16 " +
      "[--style trailer|tutorial|social] [--no-music]",
  );
  process.exit(1);
}

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
