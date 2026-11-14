import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm", async () => ({
  ...(await vi.importActual<typeof import("../src/llm")>("../src/llm")),
  callModel: vi.fn(),
}));

import { callModel, ModelOutputError } from "../src/llm";
import { collectFindings, headlineFor, writeFindings } from "../src/findings/findings";
import type { Step, StepFile } from "../src/shared/stepFile";

let tempDir: string;
let jobFolder: string;

function makeStep(
  id: string,
  index: number,
  options: Partial<Step> = {},
): Step {
  return {
    id,
    index,
    action: "click",
    target: "Sign up",
    x: 100,
    y: 100,
    typedText: null,
    reason: "Open the account form",
    screenshotBefore: `steps/${id}-before.png`,
    screenshotAfter: `steps/${id}-after.png`,
    status: "ok",
    narration: null,
    caption: null,
    audioFile: null,
    audioSeconds: null,
    hidden: false,
    ...options,
  };
}

function makeStepFile(steps: Step[]): StepFile {
  return {
    jobId: "findings-test",
    mode: "demo",
    url: "https://example.com",
    repoUrl: null,
    goal: "Show the account form",
    language: "en",
    viewport: { width: 1280, height: 720 },
    title: "Example product",
    steps,
  };
}

function writeSteps(steps: Step[]): void {
  fs.writeFileSync(
    path.join(jobFolder, "steps.json"),
    `${JSON.stringify(makeStepFile(steps), null, 2)}\n`,
  );
}

function mockResult(data: { summary: string; findings: { id: string; description: string }[] }) {
  vi.mocked(callModel).mockResolvedValue({
    text: JSON.stringify(data),
    data,
    model: "provider/strong-model",
    tier: "strong",
    inputTokens: 200,
    outputTokens: 80,
    costUsd: 0.002,
    attempts: 1,
  } as never);
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-findings-test-"));
  jobFolder = path.join(tempDir, "job");
  fs.mkdirSync(jobFolder);
  vi.mocked(callModel).mockReset();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("collectFindings", () => {
  it("collects each kind, applies severity rules, merges repeats, and orders by severity", () => {
    const findings = collectFindings(
      makeStepFile([
        makeStep("s1", 1, {
          status: "deadend",
          attempts: 2,
          confusion: "Two links looked similar",
          loadSeconds: 6.1,
          errors: ["HTTP 500: https://example.com/data"],
        }),
        makeStep("s2", 2, {
          hidden: true,
          target: "Pricing",
          confusion: "Two plans look similar",
          loadSeconds: 3.1,
          errors: ["Console error: failed to load"],
        }),
        makeStep("s3", 3, {
          errors: ["HTTP 404: https://example.com/not-found (page)"],
        }),
      ]),
    );

    expect(findings.map(({ id, severity }) => [id, severity])).toEqual([
      ["s1-broken", "high"],
      ["s1-did-nothing", "medium"],
      ["s1-hard-to-find", "medium"],
      ["s1-slow", "medium"],
      ["s3-broken", "medium"],
      ["s2-hard-to-find", "low"],
    ]);
    expect(findings.find(({ id }) => id === "s1-did-nothing")?.description).toBe(
      'Clicking "Sign up" did nothing.',
    );
    expect(findings.find(({ id }) => id === "s1-slow")).toMatchObject({
      stepIndexes: [1, 2],
      description: "The page took 6.1 seconds to load. This happened 2 times.",
    });
    expect(findings.find(({ id }) => id === "s3-broken")?.description).toBe(
      'The page "/not-found" was missing (404).',
    );
    expect(findings.find(({ id }) => id === "s2-hard-to-find")?.screenshot).toBe(
      "steps/s2-after.png",
    );
    expect(headlineFor(findings)).toBe("5 things to fix");
  });

  it("merges the same problem on the same target and keeps the most serious severity", () => {
    const findings = collectFindings(
      makeStepFile([
        makeStep("s1", 1, { confusion: "The menu has two choices" }),
        makeStep("s2", 2, { attempts: 2 }),
        makeStep("s3", 3, { loadSeconds: 3 }),
        makeStep("s4", 4, { loadSeconds: 6 }),
        makeStep("s5", 5, { loadSeconds: 6.1 }),
      ]),
    );

    expect(findings.map(({ kind, severity, stepIndexes }) => [kind, severity, stepIndexes])).toEqual([
      ["hard-to-find", "medium", [1, 2]],
      ["slow", "medium", [4, 5]],
    ]);
  });

  it("gives two different errors on one step different ids", () => {
    const findings = collectFindings(
      makeStepFile([
        makeStep("s1", 1, {
          errors: ["HTTP 500: https://example.com/data", "HTTP 404: https://example.com/img.png"],
        }),
      ]),
    );

    expect(findings.map(({ id, severity }) => [id, severity])).toEqual([
      ["s1-broken", "high"],
      ["s1-broken-2", "medium"],
    ]);
  });

  it("drops console noise and third-party errors, and uses the dead-end reason when there is one", () => {
    const findings = collectFindings(
      makeStepFile([
        makeStep("s1", 1, {
          errors: [
            "Console error: Uncaught TypeError",
            "Request failed: https://fonts.googleapis.com/css (net::ERR_FAILED)",
            "HTTP 404: https://cdn.analytics.net/track.js",
          ],
        }),
        makeStep("s2", 2, { status: "deadend", deadendReason: "The Sign up button opened nothing" }),
        makeStep("s3", 3, { loadSeconds: 3.5 }),
      ]),
    );

    expect(findings.map(({ id }) => id)).toEqual(["s2-did-nothing", "s3-slow"]);
    expect(findings[0].description).toBe("The Sign up button opened nothing.");
    expect(headlineFor(findings)).toBe("1 thing to fix");
    expect(headlineFor([])).toBe("Worked smoothly");
  });
});

describe("writeFindings", () => {
  it("writes a smooth report without calling the model when there are no findings", async () => {
    writeSteps([makeStep("s1", 1)]);

    const usage = await writeFindings(jobFolder, { languageName: "English" });
    const report = JSON.parse(fs.readFileSync(path.join(jobFolder, "findings.json"), "utf8"));

    expect(usage).toBeNull();
    expect(callModel).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      headline: "Worked smoothly",
      summary: "A first-time visitor could follow this route without problems.",
      findings: [],
    });
  });

  it("writes model-rewritten finding descriptions", async () => {
    writeSteps([makeStep("s1", 1, { status: "deadend" })]);
    mockResult({
      summary: "A first-time visitor found the page but the sign-up link did not respond.",
      findings: [{ id: "s1-did-nothing", description: "The sign-up link did not respond." }],
    });

    const usage = await writeFindings(jobFolder, { languageName: "English" });
    const report = JSON.parse(fs.readFileSync(path.join(jobFolder, "findings.json"), "utf8"));

    expect(usage).toMatchObject({
      model: "provider/strong-model",
      tier: "strong",
      inputTokens: 200,
      outputTokens: 80,
      costUsd: 0.002,
    });
    expect(report.headline).toBe("1 thing to fix");
    expect(report.summary).toContain("first-time visitor");
    expect(report.findings[0].description).toBe("The sign-up link did not respond.");
    expect(vi.mocked(callModel).mock.calls[0][0].tier).toBe("strong");
    expect(vi.mocked(callModel).mock.calls[0][0].user).toContain("Title: Example product");
    expect(vi.mocked(callModel).mock.calls[0][0].user).toContain("Goal: Show the account form");
    expect(vi.mocked(callModel).mock.calls[0][0].user).toContain('"whatHappened"');
  });

  it("gives the model a schema that rejects mismatched ids and long text", async () => {
    writeSteps([makeStep("s1", 1, { status: "deadend" })]);
    mockResult({
      summary: "A first-time visitor could not use the sign-up link.",
      findings: [{ id: "wrong-id", description: "The sign-up link did not respond." }],
    });

    await writeFindings(jobFolder, { languageName: "English" });
    const schema = vi.mocked(callModel).mock.calls[0][0].json!;
    expect(
      schema.safeParse({
        summary: "A first-time visitor could not use the sign-up link.",
        findings: [{ id: "wrong-id", description: "The sign-up link did not respond." }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        summary: "A first-time visitor could not use the sign-up link.",
        findings: [
          {
            id: "s1-did-nothing",
            description: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty one two three four five six",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        summary: `${"word ".repeat(60)}word`,
        findings: [{ id: "s1-did-nothing", description: "The sign-up link did not respond." }],
      }).success,
    ).toBe(false);
  });

  it("falls back to raw findings and records usage after ModelOutputError", async () => {
    writeSteps([makeStep("s1", 1, { status: "deadend" })]);
    vi.mocked(callModel).mockRejectedValue(
      new ModelOutputError("Invalid findings output", {
        model: "provider/strong-model",
        tier: "strong",
        inputTokens: 300,
        outputTokens: 60,
        costUsd: 0.003,
        attempts: 2,
      }),
    );

    const usage = await writeFindings(jobFolder, { languageName: "English" });
    const report = JSON.parse(fs.readFileSync(path.join(jobFolder, "findings.json"), "utf8"));

    expect(usage).toMatchObject({
      model: "provider/strong-model",
      inputTokens: 300,
      outputTokens: 60,
      costUsd: 0.003,
    });
    expect(report.summary).toContain("A first-time visitor could explore the page but struggled because");
    expect(report.findings[0].description).toBe('Clicking "Sign up" did nothing.');
  });
});
