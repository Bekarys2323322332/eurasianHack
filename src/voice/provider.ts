/**
 * The text-to-speech provider. This is the only file that knows which
 * service makes the audio, so swapping the service means rewriting this file
 * and nothing else.
 *
 * Current provider: OpenRouter's speech endpoint with an ElevenLabs model.
 * It is OpenAI-compatible (POST <base>/audio/speech) and works with the same
 * LLM_API_KEY and LLM_BASE_URL the rest of the app already uses, so no extra
 * key is needed.
 *
 * Note on the "all model calls go through src/llm" rule: this file calls the
 * gateway directly because the voice task was limited to src/voice. If
 * src/llm grows a speech helper, call it from synthesize() below.
 */

/** The ElevenLabs model used for every line. Handles English and Russian. */
const MODEL = "elevenlabs/eleven-multilingual-v2";

/**
 * Identifies the provider and model in the cache key, so changing either
 * never serves audio made by a different voice engine.
 */
export const PROVIDER_NAME = `openrouter:${MODEL}`;

/** How long to wait for one line before giving up. */
const TIMEOUT_MS = 60_000;

function gateway(): { baseUrl: string; apiKey: string } {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("LLM_API_KEY is not set. Add it to .env.local (see .env.example).");
  }
  const baseUrl = (process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  return { baseUrl, apiKey };
}

export interface Speech {
  /** The mp3 file contents. */
  audio: Buffer;
  /** Id the provider gave this request, used to look up its cost later. */
  requestId: string | null;
}

/** Turn one line of text into mp3 audio. Throws when the provider refuses. */
export async function synthesize(text: string, voice: string): Promise<Speech> {
  const { baseUrl, apiKey } = gateway();
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    // The endpoint returns raw pcm unless mp3 is asked for.
    body: JSON.stringify({ model: MODEL, input: text, voice, response_format: "mp3" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    // Errors come back as JSON text. Keep it short for the summary.
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Speech request failed (${response.status}): ${detail}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) throw new Error("Speech request returned an empty file.");
  return { audio, requestId: response.headers.get("x-generation-id") };
}

/**
 * Ask the provider what one request cost, in US dollars. Returns null when
 * the provider does not say. The record takes a few seconds to appear after
 * the audio is made, so this tries three times over about ten seconds.
 */
export async function lookupCost(requestId: string): Promise<number | null> {
  const { baseUrl, apiKey } = gateway();
  for (const waitMs of [1500, 3000, 6000]) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      const response = await fetch(`${baseUrl}/generation?id=${encodeURIComponent(requestId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) continue;
      const cost = (await response.json())?.data?.total_cost;
      if (typeof cost === "number") return cost;
    } catch {
      // Cost is nice to have. Never let a failed lookup break the job.
    }
  }
  return null;
}
