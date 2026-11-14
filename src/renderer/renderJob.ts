/**
 * The one function the rest of the app calls to make a video.
 *
 *   const file = await renderJob("data/jobs/abc123", { aspect: "16:9", music: true },
 *     (percent) => console.log(percent));
 *
 * It reads <jobFolder>/steps.json and writes <jobFolder>/video-16x9.mp4 or
 * <jobFolder>/video-9x16.mp4. Server-side only (it starts a headless browser).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { validateStepFile, type StepFile } from "../shared/stepFile";
import { visibleSteps, type Aspect, type VideoProps } from "./timeline";

export interface RenderOptions {
  aspect: Aspect;
  /** Add background music when public/music.mp3 exists. */
  music: boolean;
}

/** Name the music file gets inside the temporary public folder. */
export const MUSIC_FILE = "music.mp3";

/** Read and check steps.json. Errors say what is wrong in plain words. */
function readStepFile(jobFolder: string): StepFile {
  const file = path.join(jobFolder, "steps.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No steps.json found in ${jobFolder}. Run the agent first.`);
  }
  const result = validateStepFile(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!result.ok) {
    throw new Error(`steps.json in ${jobFolder} is not valid:\n${result.errors.join("\n")}`);
  }
  return result.stepFile;
}

/**
 * Copy only the files the video needs into a fresh folder that Remotion
 * serves as its "public" folder. Returns the step file with audio entries
 * cleared when the audio file is not on disk, so a missing voice file never
 * breaks the render.
 */
function preparePublicFolder(
  jobFolder: string,
  publicDir: string,
  stepFile: StepFile,
  wantMusic: boolean,
): VideoProps["stepFile"] & { hasMusic: boolean } {
  const copy = (relative: string) => {
    const target = path.join(publicDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(jobFolder, relative), target);
  };

  const shown = new Set(visibleSteps(stepFile).map((step) => step.id));
  const steps = stepFile.steps.map((step) => {
    if (!shown.has(step.id)) return step;
    for (const shot of [step.screenshotBefore, step.screenshotAfter]) {
      if (!fs.existsSync(path.join(jobFolder, shot))) {
        throw new Error(`Step ${step.id} is missing its screenshot ${shot} in ${jobFolder}.`);
      }
      copy(shot);
    }
    if (step.audioFile && fs.existsSync(path.join(jobFolder, step.audioFile))) {
      copy(step.audioFile);
      return step;
    }
    // No usable audio: the scene falls back to the silent length.
    return { ...step, audioFile: null, audioSeconds: null };
  });

  // Music is shared by all jobs and lives in the app's own public folder.
  const musicSource = path.resolve("public", MUSIC_FILE);
  const hasMusic = wantMusic && fs.existsSync(musicSource);
  if (hasMusic) fs.copyFileSync(musicSource, path.join(publicDir, MUSIC_FILE));

  return { ...stepFile, steps, hasMusic };
}

/**
 * Render the video for one job.
 *
 * @param jobFolder  Folder that contains steps.json and the screenshots.
 * @param options    Shape of the video and whether to add music.
 * @param onProgress Called with a whole number from 0 to 100.
 * @returns          Absolute path of the finished mp4.
 */
export async function renderJob(
  jobFolder: string,
  options: RenderOptions,
  onProgress?: (percent: number) => void,
): Promise<string> {
  jobFolder = path.resolve(jobFolder);
  const report = (percent: number) => onProgress?.(Math.round(percent));
  report(0);

  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-public-"));
  try {
    const { hasMusic, ...stepFile } = preparePublicFolder(
      jobFolder,
      publicDir,
      readStepFile(jobFolder),
      options.music,
    );
    const inputProps: VideoProps = { stepFile, aspect: options.aspect, music: hasMusic };

    // Step 1 (0 to 15 percent): pack the React code into a small website.
    // ponytail: this re-bundles on every render (a few seconds). Cache the
    // bundle folder between renders if that ever becomes the slow part.
    const serveUrl = await bundle({
      // Resolved from the project root so it also works when Next.js has
      // moved this file's compiled code somewhere else.
      entryPoint: path.resolve("src/renderer/index.tsx"),
      publicDir,
      onProgress: (percent) => report(percent * 0.15),
    });

    // Step 2 (15 to 100 percent): draw every frame and encode the mp4.
    const composition = await selectComposition({ serveUrl, id: "JobVideo", inputProps });
    const outputLocation = path.join(jobFolder, `video-${options.aspect.replace(":", "x")}.mp4`);
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation,
      inputProps,
      onProgress: ({ progress }) => report(15 + progress * 85),
    });

    report(100);
    return outputLocation;
  } finally {
    fs.rmSync(publicDir, { recursive: true, force: true });
  }
}
