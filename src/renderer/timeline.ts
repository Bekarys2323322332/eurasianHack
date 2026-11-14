/**
 * Turns a step file into a timeline: which steps are shown, in what order,
 * on which frame each one starts and ends, and what happens inside each
 * scene (when the cursor clicks, when the picture changes, and so on).
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

/**
 * What happens inside one scene. All values are frames counted from the
 * start of the scene.
 */
export interface ScenePlan {
  /** Whether the camera zooms towards the click spot. */
  zoom: boolean;
  /** Frame of the click ripple, or null when the step has no click. */
  rippleAt: number | null;
  /** Frame when the "after" screenshot starts to replace the "before" one. */
  switchAt: number;
  /** How the picture changes. */
  transition: "cut" | "slide" | "fade";
  /** Length of the change in frames (0 for a cut). */
  transitionFrames: number;
  /** When the typed text appears letter by letter, or null. */
  typing: { start: number; end: number } | null;
}

/** One step of the video with its place on the timeline. */
export interface Scene {
  step: Step;
  /** First frame of the scene, counted from the start of the video. */
  from: number;
  /** Length of the scene in frames. */
  frames: number;
  /** Where the cursor starts: the previous step's spot, in viewport pixels. */
  startX: number;
  startY: number;
  /** Where the cursor ends: this step's spot, kept inside the viewport. */
  endX: number;
  endY: number;
  plan: ScenePlan;
}

export interface Timeline {
  /** Length of the title card at the very start. */
  titleFrames: number;
  scenes: Scene[];
  /** First frame and length of the end card. */
  endFrom: number;
  endFrames: number;
  totalFrames: number;
  /** Stretches where narration plays. The music gets quieter during these. */
  narration: { from: number; frames: number }[];
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

/** Decide what happens inside a scene, based on the kind of step. */
export function planScene(step: Step): ScenePlan {
  const t = settings.timing;
  switch (step.action) {
    case "click":
      // Glide, zoom in, click: the ripple and the new picture land together.
      return {
        zoom: true,
        rippleAt: toFrames(t.clickAt),
        switchAt: toFrames(t.clickAt),
        transition: "cut",
        transitionFrames: 0,
        typing: null,
      };
    case "type":
      // Click into the field, show the letters, then show the filled field.
      return {
        zoom: true,
        rippleAt: toFrames(t.typeClickAt),
        switchAt: toFrames(t.typeEnd),
        transition: "cut",
        transitionFrames: 0,
        typing: step.typedText ? { start: toFrames(t.typeStart), end: toFrames(t.typeEnd) } : null,
      };
    case "scroll":
      // No zoom, so the whole page is visible while it slides.
      return {
        zoom: false,
        rippleAt: null,
        switchAt: toFrames(t.scrollStart),
        transition: "slide",
        transitionFrames: toFrames(t.scrollSeconds),
        typing: null,
      };
    default:
      // navigate and wait: nothing was clicked, just blend to the new page.
      return {
        zoom: false,
        rippleAt: null,
        switchAt: toFrames(t.fadeAt),
        transition: "fade",
        transitionFrames: toFrames(t.fadeSeconds),
        typing: null,
      };
  }
}

/** Keep a number between two limits. */
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Lay out title card, then the visible steps end to end, then the end card. */
export function buildTimeline(stepFile: StepFile): Timeline {
  const { width, height } = stepFile.viewport;
  const titleFrames = toFrames(settings.timing.titleCardSeconds);
  const endFrames = toFrames(settings.timing.endCardSeconds);

  let cursor = titleFrames;
  // Before the first step the cursor rests in the middle of the page.
  let lastX = width / 2;
  let lastY = height / 2;
  const narration: Timeline["narration"] = [];

  const scenes = visibleSteps(stepFile).map((step) => {
    const frames = toFrames(sceneSeconds(step));
    // The agent may report a spot slightly outside the page. Pull it back
    // in so the cursor and the zoom never aim at empty space.
    const endX = clamp(step.x, 0, width);
    const endY = clamp(step.y, 0, height);
    const scene: Scene = {
      step,
      from: cursor,
      frames,
      startX: lastX,
      startY: lastY,
      endX,
      endY,
      plan: planScene(step),
    };
    if (step.audioFile && step.audioSeconds) {
      narration.push({ from: cursor, frames: toFrames(step.audioSeconds) });
    }
    cursor += frames;
    lastX = endX;
    lastY = endY;
    return scene;
  });

  return {
    titleFrames,
    scenes,
    endFrom: cursor,
    endFrames,
    totalFrames: cursor + endFrames,
    narration,
  };
}

/**
 * How loud the music is on a given frame: quieter under narration, with a
 * smooth ramp on both sides, and a fade out at the end of the video.
 */
export function musicVolume(frame: number, timeline: Timeline): number {
  const { volume, volumeUnderNarration, rampSeconds, fadeOutSeconds } = settings.music;
  const ramp = Math.max(toFrames(rampSeconds), 1);

  // 0 = no narration nearby, 1 = fully inside a narrated stretch.
  let ducked = 0;
  for (const { from, frames } of timeline.narration) {
    const intoStretch = (frame - (from - ramp)) / ramp;
    const beforeEnd = (from + frames + ramp - frame) / ramp;
    ducked = Math.max(ducked, clamp(Math.min(intoStretch, beforeEnd), 0, 1));
  }

  const fadeOut = clamp((timeline.totalFrames - frame) / toFrames(fadeOutSeconds), 0, 1);
  return (volume + (volumeUnderNarration - volume) * ducked) * fadeOut;
}
