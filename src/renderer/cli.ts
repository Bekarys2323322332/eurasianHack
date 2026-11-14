/**
 * Command line wrapper around renderJob.
 *
 *   npm run render -- --job fixtures/fake-job --aspect 16:9
 *   npm run render -- --job fixtures/fake-job --aspect 9:16 --no-music
 */
import { parseArgs } from "node:util";
import { renderJob } from "./renderJob";

const { values } = parseArgs({
  options: {
    job: { type: "string" },
    aspect: { type: "string", default: "16:9" },
    music: { type: "boolean", default: true },
  },
  // Lets the user write --no-music.
  allowNegative: true,
});

const { job, aspect, music } = values;
if (!job || (aspect !== "16:9" && aspect !== "9:16")) {
  console.error("Usage: npm run render -- --job <folder> --aspect 16:9|9:16 [--no-music]");
  process.exit(1);
}

const started = Date.now();
let lastShown = -1;
renderJob(job, { aspect, music }, (percent) => {
  // Print every tenth percent so the log stays short.
  if (percent >= lastShown + 10 || percent === 100) {
    lastShown = percent;
    console.log(`Rendering: ${percent}%`);
  }
})
  .then((file) => {
    console.log(`Done in ${Math.round((Date.now() - started) / 1000)} seconds: ${file}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
