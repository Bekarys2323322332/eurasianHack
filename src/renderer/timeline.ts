/**
 * Turns a step file into a timeline: which steps are shown, in what order,
 * and on which frame each one starts and ends.
 *
 * This file has no React in it on purpose. Both the video component and the
 * Node side (to know the total length) use it, and it can be checked with a
 * plain script (see timeline.check.ts).
 */
import type { Step, StepFile } from "../shared/stepFile";
import { settings } from "./settings";

/** The two video shapes we can make. */
export type Aspect = "16:9" | "9:16";

/**
 * Everything the Remotion composition needs to draw the video.
 * (A type alias, not an interface, because Remotion wants props to be a
 * plain record.)
 */
export type VideoProps = {
  stepFile: StepFile;
  aspect: Aspect;
  /** True when a music file was found and the caller wants music. */
  music: boolean;
};

/** One step of the video with its place on the timeline. */
export interface Scene {
  step: Step;
  /** First frame of the scene, counted from the start of the video. */
  from: number;
  /** Length of the scene in frames. */
  frames: number;
}

export interface Timeline {
  scenes: Scene[];
  totalFrames: number;
}

/** Convert seconds to a whole number of frames. */
export function toFrames(seconds: number): number {
  return Math.round(seconds * settings.fps);
}

/**
 * Steps that appear in the video. Dead ends (the agent tried something that
 * did not work) and steps the user removed in the editor are left out.
 */
export function visibleSteps(stepFile: StepFile): Step[] {
  return stepFile.steps.filter((step) => step.status === "ok" && !step.hidden);
}

/** How long one step stays on screen, in seconds. */
export function sceneSeconds(step: Step): number {
  const { sceneSecondsWithoutAudio, paddingAfterAudio } = settings.timing;
  // A step only counts as narrated when it has both a file and a length.
  if (step.audioFile && step.audioSeconds) return step.audioSeconds + paddingAfterAudio;
  return sceneSecondsWithoutAudio;
}

/** Lay the visible steps end to end. */
export function buildTimeline(stepFile: StepFile): Timeline {
  let cursor = 0;
  const scenes = visibleSteps(stepFile).map((step) => {
    const frames = toFrames(sceneSeconds(step));
    const scene: Scene = { step, from: cursor, frames };
    cursor += frames;
    return scene;
  });
  // Remotion refuses a zero-length video, so an empty job still gets one frame.
  return { scenes, totalFrames: Math.max(cursor, 1) };
}
