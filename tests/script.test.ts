import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";
import { appendCostCall } from "../src/agent/cost";

vi.mock("../src/llm", () => ({ callModel: vi.fn() }));

import { callModel } from "../src/llm";
import { writeScript } from "../src/agent/script";
import type { Step, StepFile } from "../src/shared/stepFile";

interface ScriptOutput {
  lines: { stepId: string; narration: string; caption: string }[];
}

let jobFolder: string;

function makeStep(
  id: string,
  index: number,
  status: Step["status"],
  hidden = false,
): Step {
  return {
    id,
    index,
    action: "click",
    target: `Target ${id}`,
    x: 100,
    y: 100,
    typedText: null,
    reason: `Reason ${id}`,
    screenshotBefore: `steps/${id}-before.png`,
    screenshotAfter: `steps/${id}-after.png`,
    status,
    narration: hidden || status === "deadend" ? `Existing narration ${id}` : null,
    caption: hidden || status === "deadend" ? `Existing caption ${id}` : null,
    audioFile: null,
    audioSeconds: null,
    hidden,
  };
}

function makeStepFile(steps: Step[]): StepFile {
  return {
    jobId: "script-test",
    mode: "demo",
    url: "https://example.com",
    repoUrl: null,
    goal: "Show the product",
    language: "en",
    viewport: { width: 1280, height: 720 },
    title: "A product tour",
    steps,
  };
}

function writeFixture(steps: Step[]): void {
  fs.writeFileSync(
    path.join(jobFolder, "steps.json"),
    `${JSON.stringify(makeStepFile(steps), null, 2)}\n`,
  );
}

function mockScriptOutput(lines: ScriptOutput["lines"]): void {
  vi.mocked(callModel).mockResolvedValue({
    text: JSON.stringify({ lines }),
    data: { lines },
    model: "anthropic/claude-sonnet-5.5",
    tier: "strong",
    inputTokens: 120,
    outputTokens: 40,
    costUsd: 0.00064,
    attempts: 1,
  } as never);
}

beforeEach(() => {
  jobFolder = fs.mkdtempSync(path.join(os.tmpdir(), "agent-script-test-"));
  vi.mocked(callModel).mockReset();
});

afterEach(() => {
  fs.rmSync(jobFolder, { recursive: true, force: true });
});

describe("writeScript", () => {
  it("applies copy only to visible steps and writes the validated step file", async () => {
    writeFixture([
      makeStep("s1", 1, "ok"),
      makeStep("s2", 2, "deadend"),
      makeStep("s3", 3, "ok"),
      makeStep("s4", 4, "ok", true),
    ]);
    mockScriptOutput([
      { stepId: "s3", narration: "Explore the helpful dashboard.", caption: "See the dashboard" },
      { stepId: "s1", narration: "Welcome to the product.", caption: "Welcome to the product" },
    ]);

    const usage = await writeScript(jobFolder, { languageName: "English" });
    const saved = JSON.parse(fs.readFileSync(path.join(jobFolder, "steps.json"), "utf8")) as StepFile;

    expect(usage).toEqual({
      model: "anthropic/claude-sonnet-5.5",
      inputTokens: 120,
      outputTokens: 40,
      costUsd: 0.00064,
    });
    expect(saved.steps[0]).toMatchObject({
      narration: "Welcome to the product.",
      caption: "Welcome to the product",
    });
    expect(saved.steps[1]).toMatchObject({
      narration: "Existing narration s2",
      caption: "Existing caption s2",
    });
    expect(saved.steps[2]).toMatchObject({
      narration: "Explore the helpful dashboard.",
      caption: "See the dashboard",
    });
    expect(saved.steps[3]).toMatchObject({
      narration: "Existing narration s4",
      caption: "Existing caption s4",
    });
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(vi.mocked(callModel).mock.calls[0][0].tier).toBe("strong");
    expect(vi.mocked(callModel).mock.calls[0][0].user).toContain('"stepId": "s1"');
  });

  it("rejects mismatched step ids and over-long narration in the per-job schema", async () => {
    writeFixture([makeStep("s1", 1, "ok")]);
    mockScriptOutput([{ stepId: "s1", narration: "A short sentence.", caption: "Step 1" }]);
    await writeScript(jobFolder, { languageName: "English" });

    const options = vi.mocked(callModel).mock.calls[0][0];
    const schema = options.json as ZodType<ScriptOutput>;
    const mismatch = schema.safeParse({
      lines: [{ stepId: "wrong-id", narration: "A short sentence.", caption: "Step 1" }],
    });
    const tooLong = schema.safeParse({
      lines: [{
        stepId: "s1",
        narration: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen",
        caption: "Step 1",
      }],
    });
    const captionTooLong = schema.safeParse({
      lines: [{ stepId: "s1", narration: "A short sentence.", caption: "One two three four five six seven" }],
    });

    expect(mismatch.success).toBe(false);
    expect(tooLong.success).toBe(false);
    expect(captionTooLong.success).toBe(false);
  });
});

describe("appendCostCall", () => {
  it("appends script and voice usage while preserving an unknown total", () => {
    appendCostCall(jobFolder, "script", {
      model: "anthropic/claude-sonnet-5.5",
      inputTokens: 120,
      outputTokens: 40,
      costUsd: 0.00064,
    });
    appendCostCall(jobFolder, "voice", {
      model: "openrouter:elevenlabs/eleven-multilingual-v2",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
    });

    const saved = JSON.parse(
      fs.readFileSync(path.join(jobFolder, "agent-cost.json"), "utf8"),
    ) as {
      calls: { stage: string; model: string; costUsd: number | null }[];
      totalUsd: number | null;
    };
    expect(saved.calls.map(({ stage }) => stage)).toEqual(["script", "voice"]);
    expect(saved.calls[0].costUsd).toBe(0.00064);
    expect(saved.calls[1].model).toBe("openrouter:elevenlabs/eleven-multilingual-v2");
    expect(saved.totalUsd).toBeNull();
  });
});
