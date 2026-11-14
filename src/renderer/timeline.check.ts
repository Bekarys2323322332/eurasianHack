/**
 * Small self-check for the timeline maths. Run with:
 *   npx tsx src/renderer/timeline.check.ts
 * It throws if dead ends or hidden steps leak into the video or if scene
 * lengths are wrong.
 */
import assert from "node:assert/strict";
import type { Step, StepFile } from "../shared/stepFile";
import { buildTimeline, musicVolume, toFrames } from "./timeline";
import { settingsFor } from "./settings";

const step = (id: string, extra: Partial<Step> = {}): Step => ({
  id,
  index: 1,
  action: "click",
  target: "",
  x: 0,
  y: 0,
  typedText: null,
  reason: "",
  screenshotBefore: "a.png",
  screenshotAfter: "b.png",
  status: "ok",
  narration: null,
  caption: null,
  audioFile: null,
  audioSeconds: null,
  hidden: false,
  ...extra,
});

const stepFile: StepFile = {
  jobId: "check",
  mode: "demo",
  url: "https://example.com",
  repoUrl: null,
  goal: "",
  language: "en",
  viewport: { width: 1280, height: 720 },
  title: "Check",
  steps: [
    step("silent"),
    step("deadend", { status: "deadend" }),
    step("hidden", { hidden: true }),
    step("spoken", { audioFile: "audio/x.mp3", audioSeconds: 2.4 }),
  ],
};

const settings = settingsFor("trailer");
const timeline = buildTimeline(stepFile, settings);
const { scenes, titleFrames } = timeline;
assert.deepEqual(scenes.map((scene) => scene.step.id), ["silent", "spoken"]);
assert.deepEqual(scenes.map((scene) => scene.number), [1, 2]);
assert.equal(scenes[0].from, titleFrames); // scenes start after the title card
assert.equal(scenes[0].frames, toFrames(settings.timing.sceneSecondsWithoutAudio));
assert.equal(scenes[1].frames, toFrames(2.4 + settings.timing.paddingAfterAudio));
assert.equal(scenes[1].from, scenes[0].from + scenes[0].frames);
assert.equal(timeline.totalFrames, timeline.endFrom + timeline.endFrames);

// Music is at full level away from narration and lowered in the middle of it.
assert.equal(musicVolume(scenes[0].from, timeline, settings), settings.music.volume);
assert.equal(
  musicVolume(scenes[1].from + 30, timeline, settings),
  settings.music.volumeUnderNarration,
);
assert.equal(musicVolume(timeline.totalFrames, timeline, settings), 0);

// In every style the action inside a silent scene must be over before the
// scene ends, otherwise the zoom would be cut off mid-move.
for (const style of ["trailer", "tutorial", "social"] as const) {
  const t = settingsFor(style).timing;
  const typeSceneEnds = t.typeEnd + t.zoomHoldAfterSwitch + t.zoomOutSeconds;
  assert.ok(typeSceneEnds <= t.sceneSecondsWithoutAudio + 1e-9, `${style}: scene too short`);
}

// Tutorial leaves a longer pause after narration than trailer does.
assert.ok(
  settingsFor("tutorial").timing.paddingAfterAudio >
    settingsFor("trailer").timing.paddingAfterAudio,
);

// Social never runs past its limit: 40 silent steps are cut down to fit.
const social = settingsFor("social");
const many = { ...stepFile, steps: Array.from({ length: 40 }, (_, i) => step(`m${i}`)) };
const capped = buildTimeline(many, social);
assert.ok(capped.totalFrames <= toFrames(social.maxSeconds ?? 0));
assert.ok(capped.scenes.length > 5 && capped.scenes.length < 40);

// How-to mode is picked up from the step file and gets the longer end card.
const howto = buildTimeline({ ...stepFile, mode: "howto" }, settings);
assert.equal(howto.howto, true);
assert.equal(howto.endFrames, toFrames(settings.timing.recapCardSeconds));
console.log("timeline check passed");
