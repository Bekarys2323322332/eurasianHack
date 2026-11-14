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

  it("accepts optional findings metadata while older files remain valid", () => {
    const data = loadFixture();
    data.steps[0].loadSeconds = 4.2;
    data.steps[0].attempts = 2;
    data.steps[0].confusion = "Two links looked similar";
    data.steps[0].errors = ["HTTP 500: https://example.com/data"];

    const result = validateStepFile(data);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.stepFile.steps[0]).toMatchObject({
      loadSeconds: 4.2,
      attempts: 2,
      confusion: "Two links looked similar",
      errors: ["HTTP 500: https://example.com/data"],
    });
    expect(validateStepFile(loadFixture()).ok).toBe(true);
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
