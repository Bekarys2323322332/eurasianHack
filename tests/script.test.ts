import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";
import { appendCostCall } from "../src/agent/cost";

vi.mock("../src/llm", async () => ({
  ...(await vi.importActual<typeof import("../src/llm")>("../src/llm")),
  callModel: vi.fn(),
}));

import { callModel } from "../src/llm";
import { writeScript } from "../src/agent/script";
import type { Step, StepFile } from "../src/shared/stepFile";

interface ScriptOutput {
  lines: { stepId: string; narration: string; caption: string }[];
}

let jobFolder: string;
let tempRoot: string;
let previousDataDir: string | undefined;
let previousStrongModel: string | undefined;

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

function makeStepFile(steps: Step[], mode: StepFile["mode"] = "demo"): StepFile {
  return {
    jobId: "script-test",
    mode,
    url: "https://example.com",
    repoUrl: null,
    goal: "Show the product",
    language: "en",
    viewport: { width: 1280, height: 720 },
    title: "A product tour",
    steps,
  };
}

function writeFixture(steps: Step[], mode?: StepFile["mode"]): void {
  fs.writeFileSync(
    path.join(jobFolder, "steps.json"),
    `${JSON.stringify(makeStepFile(steps, mode), null, 2)}\n`,
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-script-test-"));
  jobFolder = path.join(tempRoot, "job");
  fs.mkdirSync(jobFolder);
  previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = path.join(tempRoot, "data");
  previousStrongModel = process.env.STRONG_MODEL;
  process.env.STRONG_MODEL = "anthropic/claude-sonnet-5.5";
  vi.mocked(callModel).mockReset();
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  if (previousStrongModel === undefined) delete process.env.STRONG_MODEL;
  else process.env.STRONG_MODEL = previousStrongModel;
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

    const usage = await writeScript(jobFolder, { languageName: "English", style: "trailer" });
    const saved = JSON.parse(fs.readFileSync(path.join(jobFolder, "steps.json"), "utf8")) as StepFile;

    expect(usage).toEqual({
      model: "anthropic/claude-sonnet-5.5",
      tier: "strong",
      inputTokens: 120,
      outputTokens: 40,
      costUsd: 0.00064,
      escalated: false,
      cacheHit: false,
      baselineCostUsd: 0.00064,
      cached: false,
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
    await writeScript(jobFolder, { languageName: "English", style: "trailer" });

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

  it("uses the social word limit while trailer accepts nine words", async () => {
    writeFixture([makeStep("s1", 1, "ok")]);
    mockScriptOutput([{ stepId: "s1", narration: "A compact sentence.", caption: "Step 1" }]);

    await writeScript(jobFolder, { languageName: "English", style: "social" });
    const socialSchema = vi.mocked(callModel).mock.calls[0][0].json as ZodType<ScriptOutput>;
    const nineWordLine = {
      lines: [{
        stepId: "s1",
        narration: "one two three four five six seven eight nine",
        caption: "Step 1",
      }],
    };
    const socialResult = socialSchema.safeParse(nineWordLine);
    expect(socialResult.success).toBe(false);
    if (!socialResult.success) {
      expect(socialResult.error.issues[0]?.message).toContain("8 words or fewer");
    }

    await writeScript(jobFolder, { languageName: "English", style: "trailer" });
    const trailerSchema = vi.mocked(callModel).mock.calls[1][0].json as ZodType<ScriptOutput>;
    expect(trailerSchema.safeParse(nineWordLine).success).toBe(true);
  });

  it("puts the selected style and how-to caption rule in the system prompt", async () => {
    writeFixture([makeStep("s1", 1, "ok")], "howto");
    mockScriptOutput([{ stepId: "s1", narration: "A compact sentence.", caption: "Step 1" }]);

    await writeScript(jobFolder, { languageName: "English", style: "social" });

    const system = vi.mocked(callModel).mock.calls[0][0].system;
    expect(system).toContain(
      "Very short punchy lines of at most 8 words each. The first line is a hook that stops the scroll.",
    );
    expect(system).toContain("Begin each caption with the localized step label in this sequence: Step 1.");
  });

  it("uses a validated cache for repeated script inputs", async () => {
    writeFixture([makeStep("s1", 1, "ok")]);
    mockScriptOutput([{ stepId: "s1", narration: "A compact sentence.", caption: "Step 1" }]);

    const options = { languageName: "English", style: "trailer" as const };
    const first = await writeScript(jobFolder, options);
    const second = await writeScript(jobFolder, options);

    expect(first.cached).toBe(false);
    expect(second).toEqual({
      model: "cache",
      tier: "strong",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      cacheHit: true,
      escalated: false,
      baselineCostUsd: 0.00064,
      cached: true,
    });
    expect(callModel).toHaveBeenCalledTimes(1);

    const cacheDir = path.join(process.env.DATA_DIR!, "script-cache");
    const cacheFile = path.join(cacheDir, fs.readdirSync(cacheDir)[0]);
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as {
      inputTokens: number;
      outputTokens: number;
    };
    expect(cached).toMatchObject({ inputTokens: 120, outputTokens: 40 });
  });

  it("misses the cache when the selected style changes", async () => {
    writeFixture([makeStep("s1", 1, "ok")]);
    mockScriptOutput([{ stepId: "s1", narration: "A compact sentence.", caption: "Step 1" }]);

    await writeScript(jobFolder, { languageName: "English", style: "trailer" });
    await writeScript(jobFolder, { languageName: "English", style: "social" });

    expect(callModel).toHaveBeenCalledTimes(2);
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
