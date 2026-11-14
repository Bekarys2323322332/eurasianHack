import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callModel, costUsd, ModelOutputError } from "../src/llm";

const replySchema = z.object({ message: z.string() });

function completion(
  content: string,
  promptTokens = 100,
  completionTokens = 20,
): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return JSON.parse(String(init.body)) as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format?: unknown;
  };
}

describe("callModel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("parses JSON wrapped in Markdown fences", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_BASE_URL", "https://gateway.example/v1/");
    vi.stubEnv("SMALL_MODEL", "anthropic/claude-haiku-5.5");
    const fetchMock = vi.fn().mockResolvedValue(
      completion('```json\n{"message":"ready"}\n```'),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      tier: "small",
      system: "Return a message.",
      user: "Say ready.",
      json: replySchema,
    });

    expect(result.data).toEqual({ message: "ready" });
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
        signal: expect.any(AbortSignal),
      }),
    );
    const body = requestBody(fetchMock, 0);
    expect(body.messages[0].content).toContain("Reply with one JSON object only.");
    expect(body.response_format).toBeUndefined();
  });

  it("retries invalid JSON with the prior reply and validation error", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_BASE_URL", "https://gateway.example/v1");
    vi.stubEnv("SMALL_MODEL", "anthropic/claude-haiku-5.5");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(completion('{"message":42}'))
      .mockResolvedValueOnce(completion('{"message":"corrected"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      tier: "small",
      system: "Return a message.",
      user: "Say corrected.",
      json: replySchema,
    });

    expect(result.data).toEqual({ message: "corrected" });
    expect(result.attempts).toBe(2);
    const retryMessages = requestBody(fetchMock, 1).messages;
    expect(retryMessages).toContainEqual({
      role: "assistant",
      content: '{"message":42}',
    });
    expect(retryMessages.at(-1)?.content).toContain("Your reply was not valid:");
    expect(retryMessages.at(-1)?.content).toContain("Reply again with only the corrected JSON object.");
  });

  it("escalates two invalid small-tier replies to one strong-tier attempt", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_BASE_URL", "https://gateway.example/v1");
    vi.stubEnv("SMALL_MODEL", "anthropic/claude-haiku-5.5");
    vi.stubEnv("STRONG_MODEL", "anthropic/claude-sonnet-5.5");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(completion("not JSON"))
      .mockResolvedValueOnce(completion('{"message":42}'))
      .mockResolvedValueOnce(completion('{"message":"strong result"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callModel({
      tier: "small",
      system: "Return a message.",
      user: "Say strong result.",
      json: replySchema,
    });

    expect(fetchMock.mock.calls.map((_, index) => requestBody(fetchMock, index).model)).toEqual([
      "anthropic/claude-haiku-5.5",
      "anthropic/claude-haiku-5.5",
      "anthropic/claude-sonnet-5.5",
    ]);
    expect(result.data).toEqual({ message: "strong result" });
    expect(result.tier).toBe("strong");
    expect(result.model).toBe("anthropic/claude-sonnet-5.5");
    expect(result.attempts).toBe(3);
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(60);
    expect(result.costUsd).toBeCloseTo(
      2 * costUsd("anthropic/claude-haiku-5.5", 100, 20)! +
        costUsd("anthropic/claude-sonnet-5.5", 100, 20)!,
    );
  });

  it("throws ModelOutputError when all strong-tier attempts return invalid JSON", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_BASE_URL", "https://gateway.example/v1");
    vi.stubEnv("STRONG_MODEL", "anthropic/claude-sonnet-5.5");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(completion("not JSON"))
      .mockResolvedValueOnce(completion('{"message":42}'));
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await callModel({
        tier: "strong",
        system: "Return a message.",
        user: "Say something.",
        json: replySchema,
        maxAttempts: 2,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ModelOutputError);
    expect(caught).toMatchObject({
      usage: {
        model: "anthropic/claude-sonnet-5.5",
        tier: "strong",
        attempts: 2,
        inputTokens: 200,
        outputTokens: 40,
      },
    });
  });
});

describe("costUsd", () => {
  it("calculates the configured Haiku price", () => {
    expect(costUsd("anthropic/claude-haiku-5.5", 2_000_000, 1_000_000)).toBeCloseTo(0.7);
  });

  it("returns null when the model has no configured price", () => {
    expect(costUsd("provider/unlisted-model", 100, 50)).toBeNull();
  });
});
