/**
 * The one function the rest of the app calls to make a video.
 *
 *   const file = await renderJob("data/jobs/abc123", { aspect: "16:9", music: true },
 *     (percent) => console.log(percent));
 *
 * It reads <jobFolder>/steps.json and writes <jobFolder>/video-16x9.mp4 or
 * <jobFolder>/video-9x16.mp4, plus <jobFolder>/poster.jpg (one frame from
 * the middle of the video, for use as a thumbnail).
 * Server-side only (it starts a headless browser).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { defaultStyle, settingsFor, type Style } from "./settings";
import { validateStepFile } from "../shared/stepFile";
import { estimateScrollShift } from "./scrollShift";
import {
  buildTimeline,
  posterFrame,
  visibleSteps,
  type Aspect,
  type RenderStepFile,
  type VideoProps,
} from "./timeline";

export interface RenderOptions {
  aspect: Aspect;
  /** Add background music when public/music.mp3 exists. */
  music: boolean;
  /**
   * The look of the video. When left out, demo videos use "trailer" and
   * how-to videos use "tutorial".
   */
  style?: Style;
}

/**
 * Share of the processor's cores used to draw frames at the same time.
 * Higher is faster up to a point; 1 would leave nothing for the rest of the
 * app while a video is being made.
 */
const RENDER_CORE_SHARE = 0.75;

/**
 * How the headless browser draws each frame. "angle" uses the computer's
 * graphics chip, which made renders close to twice as fast on a Windows
 * laptop (blur, zoom and large pictures are exactly what graphics chips are
 * for). It is only asked for on Windows and macOS, where a graphics chip can
 * be expected. Elsewhere (Linux servers, Docker) Remotion's own default is
 * used, which draws in software and works everywhere.
 */
const FAST_GRAPHICS: "angle" | null =
  process.platform === "win32" || process.platform === "darwin" ? "angle" : null;

/**
 * Wraps the caller's progress callback so the numbers it receives are whole,
 * only ever go up, never repeat, and never jump by more than 5. If the real
 * progress leaps ahead (for example from 0 to 15), the steps in between are
 * reported first, so a progress bar always moves in small steps.
 */
function steadyProgress(onProgress?: (percent: number) => void) {
  let last = -1;
  return (percent: number) => {
    const next = Math.min(100, Math.round(percent));
    while (next - last > 5) onProgress?.((last = Math.max(last, 0) + 5));
    if (next > last) onProgress?.((last = next));
  };
}

/** Read and check steps.json. Errors say what is wrong in plain words. */
function readStepFile(jobFolder: string): RenderStepFile {
  const file = path.join(jobFolder, "steps.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No steps.json found in ${jobFolder}. Run the agent first.`);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = validateStepFile(raw);
  if (!result.ok) {
    throw new Error(`steps.json in ${jobFolder} is not valid:\n${result.errors.join("\n")}`);
  }
  // The shared validator drops fields it does not know. "keyWord" is one of
  // those for now, so it is picked up from the raw file here.
  const keyWords = new Map<string, string>();
  for (const step of Array.isArray(raw?.steps) ? raw.steps : []) {
    if (typeof step?.keyWord === "string" && step.keyWord.trim()) {
      keyWords.set(step.id, step.keyWord.trim());
    }
  }
  return {
    ...result.stepFile,
    steps: result.stepFile.steps.map((step) => ({ ...step, keyWord: keyWords.get(step.id) ?? null })),
  };
}

/**
 * Copy only the files the video needs into a fresh folder that Remotion
 * serves as its "public" folder. Returns the step file with audio entries
 * cleared when the audio file is not on disk, so a missing voice file never
 * breaks the render.
 */
const SFX_FILES = ["click.wav", "whoosh.wav", "key.wav"] as const;

function preparePublicFolder(
  jobFolder: string,
  publicDir: string,
  stepFile: RenderStepFile,
  wantMusic: boolean,
  style: Style,
): VideoProps["stepFile"] & { hasMusic: boolean; hasSfx: boolean } {
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
    // For scroll steps, measure how far the page really moved so the video
    // can pan by that amount.
    const withShift =
      step.action === "scroll"
        ? {
            ...step,
            scrollShift: estimateScrollShift(
              path.join(jobFolder, step.screenshotBefore),
              path.join(jobFolder, step.screenshotAfter),
            ),
          }
        : step;
    if (step.audioFile && fs.existsSync(path.join(jobFolder, step.audioFile))) {
      copy(step.audioFile);
      return withShift;
    }
    // No usable audio: the scene falls back to the silent length.
    return { ...withShift, audioFile: null, audioSeconds: null };
  });

  // Music lives in the app's own public folder. The style's own file (for
  // example music-trailer.mp3) is used when it exists, otherwise the shared
  // music.mp3, otherwise the video has no music. Whichever is found is
  // copied under one fixed name, so the video code never needs to know.
  const { music } = settingsFor(style);
  const musicSource = [music.styleFile, music.file]
    .map((name) => path.resolve("public", name))
    .find((file) => fs.existsSync(file));
  const hasMusic = wantMusic && musicSource !== undefined;
  if (wantMusic && musicSource) fs.copyFileSync(musicSource, path.join(publicDir, music.file));

  // Sound effects (click, whoosh, key ticks) live in public/sfx; all three
  // must exist for the video to use them.
  const sfxDir = path.resolve("public", "sfx");
  const hasSfx = SFX_FILES.every((name) => fs.existsSync(path.join(sfxDir, name)));
  if (hasSfx) {
    fs.mkdirSync(path.join(publicDir, "sfx"), { recursive: true });
    for (const name of SFX_FILES) fs.copyFileSync(path.join(sfxDir, name), path.join(publicDir, "sfx", name));
  }

  return { ...stepFile, steps, hasMusic, hasSfx };
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
  const report = steadyProgress(onProgress);
  report(0);

  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-public-"));
  try {
    const rawStepFile = readStepFile(jobFolder);
    const style = options.style ?? defaultStyle(rawStepFile.mode);
    const { hasMusic, hasSfx, ...stepFile } = preparePublicFolder(
      jobFolder,
      publicDir,
      rawStepFile,
      options.music,
      style,
    );
    const inputProps: VideoProps = { stepFile, aspect: options.aspect, style, music: hasMusic, sfx: hasSfx };

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
    const drawVideo = (graphics: "angle" | null) =>
      renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation,
        inputProps,
        // Use most of the processor's cores. Remotion's own default is half
        // of them, which left this laptop mostly idle during a render.
        concurrency: Math.max(1, Math.floor(os.availableParallelism() * RENDER_CORE_SHARE)),
        chromiumOptions: { gl: graphics },
        onProgress: ({ progress }) => report(15 + progress * 80),
      });
    try {
      await drawVideo(FAST_GRAPHICS);
    } catch (error) {
      // A computer without a usable graphics chip (or with a broken driver)
      // can fail in fast mode. Software drawing is slower but always works,
      // so try once more that way before giving up.
      if (FAST_GRAPHICS === null) throw error;
      console.warn("Fast drawing failed, trying again with software drawing:", error);
      await drawVideo(null);
    }

    // Step 3 (95 to 100 percent): one frame as a thumbnail picture. It is
    // replaced on every render, so it always matches the newest video.
    await renderStill({
      composition,
      serveUrl,
      inputProps,
      frame: posterFrame(buildTimeline(stepFile, settingsFor(style))),
      imageFormat: "jpeg",
      jpegQuality: 85,
      output: path.join(jobFolder, "poster.jpg"),
      overwrite: true,
    });

    report(100);
    return outputLocation;
  } finally {
    fs.rmSync(publicDir, { recursive: true, force: true });
  }
}
