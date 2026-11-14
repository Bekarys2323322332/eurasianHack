/**
 * Small self-check for the timeline maths. Run with:
 *   npx tsx src/renderer/timeline.check.ts
 * It throws if dead ends or hidden steps leak into the video or if scene
 * lengths are wrong.
 */
import assert from "node:assert/strict";
import type { Step, StepFile } from "../shared/stepFile";
import { buildTimeline } from "./timeline";

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

const { scenes } = buildTimeline(stepFile);
assert.deepEqual(scenes.map((scene) => scene.step.id), ["silent", "spoken"]);
assert.equal(scenes[0].frames, 75); // 2.5 seconds at 30 frames per second
assert.equal(scenes[1].frames, 90); // 2.4 + 0.6 seconds
assert.equal(scenes[1].from, scenes[0].from + scenes[0].frames);
console.log("timeline check passed");
