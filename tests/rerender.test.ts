import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearRerenderMarker, readRerenderMarker, RerenderError, writeRerenderRequest } from "../src/app/_lib/rerender";

let folder: string;

function step(id: string, index: number, status: "ok" | "deadend" = "ok") {
  return {
    id,
    index,
    action: "click",
    target: `Link ${index}`,
    x: 1,
    y: 2,
    typedText: null,
    reason: "Because",
    screenshotBefore: `steps/${id}-before.png`,
    screenshotAfter: `steps/${id}-after.png`,
    status,
    narration: status === "ok" ? `Line ${index}` : null,
    caption: status === "ok" ? `Caption ${index}` : null,
    audioFile: status === "ok" ? `audio/${id}.mp3` : null,
    audioSeconds: status === "ok" ? 2 : null,
    hidden: false,
  };
}

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "rerender-"));
  fs.writeFileSync(
    path.join(folder, "steps.json"),
    JSON.stringify({
      jobId: "job",
      mode: "demo",
      url: "https://example.com",
      repoUrl: null,
      goal: "Look around",
      language: "en",
      viewport: { width: 1280, height: 720 },
      title: "Example",
      steps: [step("s1", 1), step("s2", 2), step("s3", 3, "deadend")],
    }),
  );
});

afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

describe("writeRerenderRequest", () => {
  it("hides a step, rewords a line and drops only that line's audio", () => {
    const changed = writeRerenderRequest(folder, {
      aspect: "9:16",
      edits: [
        { id: "s1", hidden: true },
        { id: "s2", narration: "A new line", caption: "Caption 2" },
      ],
    });
    expect(changed).toBe(2);
    const saved = JSON.parse(fs.readFileSync(path.join(folder, "steps.json"), "utf8"));
    expect(saved.steps[0]).toMatchObject({ hidden: true, audioFile: "audio/s1.mp3" });
    expect(saved.steps[1]).toMatchObject({ narration: "A new line", caption: "Caption 2", audioFile: null, audioSeconds: null });
    expect(readRerenderMarker(folder)).toEqual({ aspect: "9:16" });
    clearRerenderMarker(folder);
    expect(readRerenderMarker(folder)).toBeNull();
  });

  it("counts unchanged edits as nothing and keeps at least one visible step", () => {
    expect(writeRerenderRequest(folder, { edits: [{ id: "s1", narration: "Line 1" }] })).toBe(0);
    expect(() =>
      writeRerenderRequest(folder, { edits: [{ id: "s1", hidden: true }, { id: "s2", hidden: true }] }),
    ).toThrow(RerenderError);
  });
});
