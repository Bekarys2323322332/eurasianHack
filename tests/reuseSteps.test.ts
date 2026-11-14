import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyStepsForNewJob, readReusableStepFile, ReuseStepsError } from "../src/app/_lib/reuseSteps";

let tempDir: string;
let source: string;

function writeSource(extra: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(source, "steps"), { recursive: true });
  fs.writeFileSync(path.join(source, "steps", "s1-before.png"), "before");
  fs.writeFileSync(path.join(source, "steps", "s1-after.png"), "after");
  fs.writeFileSync(path.join(source, "findings.json"), "{}");
  fs.writeFileSync(
    path.join(source, "steps.json"),
    JSON.stringify({
      jobId: "src",
      mode: "demo",
      url: "https://example.com",
      repoUrl: null,
      goal: "Show the home page",
      language: "en",
      viewport: { width: 1280, height: 720 },
      title: "Example",
      ...extra,
      steps: [
        {
          id: "s1",
          index: 1,
          action: "click",
          target: "Home",
          x: 1,
          y: 2,
          typedText: null,
          reason: "Open the home page",
          screenshotBefore: "steps/s1-before.png",
          screenshotAfter: "steps/s1-after.png",
          status: "ok",
          narration: "Welcome",
          caption: "Welcome",
          audioFile: "audio/s1.mp3",
          audioSeconds: 2,
          hidden: false,
        },
      ],
    }),
  );
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reuse-steps-"));
  source = path.join(tempDir, "src");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("copyStepsForNewJob", () => {
  it("copies steps and screenshots, clears narration and audio, and leaves findings to be rewritten", () => {
    writeSource();
    const target = path.join(tempDir, "new");

    const stepFile = copyStepsForNewJob(source, target, "new", "ru");

    expect(stepFile.jobId).toBe("new");
    expect(stepFile.language).toBe("ru");
    expect(stepFile.steps[0]).toMatchObject({
      narration: null,
      caption: null,
      audioFile: null,
      audioSeconds: null,
      reason: "Open the home page",
    });
    expect(fs.readFileSync(path.join(target, "steps", "s1-after.png"), "utf8")).toBe("after");
    expect(fs.existsSync(path.join(target, "findings.json"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(target, "steps.json"), "utf8")).jobId).toBe("new");
  });

  it("refuses a run that did not complete or has no steps", () => {
    expect(() => readReusableStepFile(source)).toThrow(ReuseStepsError);
    writeSource({ goalAchieved: false, resultText: "Needed a login" });
    expect(() => readReusableStepFile(source)).toThrow(/did not complete/);
  });
});
