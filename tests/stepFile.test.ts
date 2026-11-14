import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateStepFile } from "../src/shared/stepFile";

const fixtureDir = path.join(__dirname, "..", "fixtures", "fake-job");
const loadFixture = () => JSON.parse(fs.readFileSync(path.join(fixtureDir, "steps.json"), "utf8"));

describe("validateStepFile", () => {
  it("accepts the fake job fixture", () => {
    const result = validateStepFile(loadFixture());
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.stepFile.steps).toHaveLength(5);
  });

  it("points at screenshots that exist in the fixture", () => {
    const result = validateStepFile(loadFixture());
    if (!result.ok) throw new Error(result.errors.join("\n"));
    for (const step of result.stepFile.steps) {
      expect(fs.existsSync(path.join(fixtureDir, step.screenshotBefore))).toBe(true);
      expect(fs.existsSync(path.join(fixtureDir, step.screenshotAfter))).toBe(true);
    }
  });

  it("rejects an unknown action", () => {
    const data = loadFixture();
    data.steps[0].action = "hover";
    const result = validateStepFile(data);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate ids and out-of-order indexes", () => {
    const data = loadFixture();
    data.steps[1].id = data.steps[0].id;
    data.steps[2].index = 9;
    const result = validateStepFile(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBe(2);
  });
});
