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

import { MODEL } from "./config";

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

/** Turn one line of text into mp3 audio. Throws when the provider refuses. */
export async function synthesize(text: string, voice: string): Promise<Buffer> {
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
  return audio;
}
