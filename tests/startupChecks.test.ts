import { describe, expect, it } from "vitest";
import {
  checkEnv,
  OPTIONAL_ENV_VARS,
  REQUIRED_ENV_VARS,
  summarizeChecks,
} from "../src/shared/startupChecks";

describe("checkEnv", () => {
  it("identifies missing, blank, and configured values", () => {
    const checks = checkEnv({
      LLM_API_KEY: "   ",
      LLM_BASE_URL: "https://llm.example",
      SMALL_MODEL: "small",
      STRONG_MODEL: "",
    });

    expect(checks).toHaveLength(REQUIRED_ENV_VARS.length + OPTIONAL_ENV_VARS.length);
    expect(checks.map((check) => check.ok)).toEqual([false, true, true, false, false]);
    expect(checks.map((check) => check.name)).toEqual([
      ...REQUIRED_ENV_VARS,
      ...OPTIONAL_ENV_VARS,
    ]);
    expect(checks.map((check) => check.required)).toEqual([true, true, true, true, false]);
  });

  it("allows a missing optional TTS key and reports it as a warning", () => {
    const checks = checkEnv({
      LLM_API_KEY: "key",
      LLM_BASE_URL: "https://llm.example",
      SMALL_MODEL: "small",
      STRONG_MODEL: "strong",
    });
    const summary = summarizeChecks(checks);

    expect(summary.ok).toBe(true);
    expect(summary.warnings.map((check) => check.name)).toEqual(["TTS_API_KEY"]);
  });

  it("never includes configured values in check results", () => {
    const secretValues = ["secret-key-value", "private-endpoint", "small-secret", "strong-secret", "tts-secret"];
    const env = Object.fromEntries(
      [...REQUIRED_ENV_VARS, ...OPTIONAL_ENV_VARS].map((name, index) => [
        name,
        secretValues[index],
      ]),
    );
    const results = checkEnv(env);
    const serialized = JSON.stringify(results);

    expect(results.every((check) => check.ok)).toBe(true);
    for (const secret of secretValues) expect(serialized).not.toContain(secret);
  });
});
