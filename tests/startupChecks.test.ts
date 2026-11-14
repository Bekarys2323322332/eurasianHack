import { describe, expect, it } from "vitest";
import { checkEnv, REQUIRED_ENV_VARS } from "../src/shared/startupChecks";

describe("checkEnv", () => {
  it("identifies missing, blank, and configured values", () => {
    const checks = checkEnv({
      LLM_API_KEY: "   ",
      LLM_BASE_URL: "https://llm.example",
      SMALL_MODEL: "small",
      STRONG_MODEL: "",
    });

    expect(checks).toHaveLength(REQUIRED_ENV_VARS.length);
    expect(checks.map((check) => check.ok)).toEqual([false, true, true, false, false]);
    expect(checks.map((check) => check.name)).toEqual(REQUIRED_ENV_VARS);
  });

  it("never includes configured values in check results", () => {
    const secretValues = ["secret-key-value", "private-endpoint", "small-secret", "strong-secret", "tts-secret"];
    const env = Object.fromEntries(
      REQUIRED_ENV_VARS.map((name, index) => [name, secretValues[index]]),
    );
    const results = checkEnv(env);
    const serialized = JSON.stringify(results);

    expect(results.every((check) => check.ok)).toBe(true);
    for (const secret of secretValues) expect(serialized).not.toContain(secret);
  });
});
