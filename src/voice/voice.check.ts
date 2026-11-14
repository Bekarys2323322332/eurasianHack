/**
 * Self-check for the voice stage. Uses a fake provider (no network, no key,
 * no cost). Run with:
 *   npx tsx src/voice/voice.check.ts
 *
 * Checks: mp3 length measuring, which steps get audio, retry then give up
 * on a failing line without failing the job, and that a second run is
 * served entirely from the cache.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateVoice } from "./generateVoice";
import { mp3DurationSeconds } from "./mp3Duration";

/** Build a silent mp3 made of whole frames (MPEG1 Layer III, 128 kbit/s, 44.1 kHz). */
function fakeMp3(frames: number): Buffer {
  const frame = Buffer.alloc(417); // 144 * 128000 / 44100, rounded down
  frame.writeUInt32BE(0xfffb9000, 0);
  // An ID3 tag in front, like real files from the provider have.
  const tag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]);
  return Buffer.concat([tag, ...Array.from({ length: frames }, () => frame)]);
}

async function main() {
  // 100 frames of 1152 samples at 44100 samples per second.
  assert.ok(Math.abs(mp3DurationSeconds(fakeMp3(100)) - (100 * 1152) / 44100) < 1e-9);

  // A throwaway job folder and cache, so the check never touches real data.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "voice-check-"));
  process.env.DATA_DIR = path.join(temp, "data");
  process.env.LLM_API_KEY = "check-key-not-real";
  const job = path.join(temp, "job");
  fs.mkdirSync(job);

  const step = (index: number, extra: object) => ({
    id: `s${index}`,
    index,
    action: "click",
    target: "",
    x: 0,
    y: 0,
    typedText: null,
    reason: "",
    screenshotBefore: "a.png",
    screenshotAfter: "b.png",
    status: "ok",
    narration: `Line ${index}`,
    caption: null,
    audioFile: null,
    audioSeconds: null,
    hidden: false,
    ...extra,
  });
  fs.writeFileSync(
    path.join(job, "steps.json"),
    JSON.stringify({
      jobId: "check",
      mode: "demo",
      url: "https://example.com",
      repoUrl: null,
      goal: "",
      language: "en",
      viewport: { width: 1280, height: 720 },
      title: "Check",
      steps: [
        step(1, {}),
        step(2, { narration: "BROKEN" }), // the fake provider always refuses this one
        step(3, { status: "deadend" }),
        step(4, { hidden: true }),
        step(5, { narration: null }),
        step(6, {}),
      ],
    }),
  );

  // Fake provider: counts speech requests, refuses the text "BROKEN".
  let speechCalls = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/generation")) {
      return new Response(JSON.stringify({ data: { total_cost: 0.001 } }));
    }
    speechCalls += 1;
    if (String(init?.body).includes("BROKEN")) return new Response("upstream error", { status: 502 });
    return new Response(new Uint8Array(fakeMp3(50)), { headers: { "x-generation-id": "gen-1" } });
  }) as typeof fetch;

  const first = await generateVoice(job, { language: "en" });
  assert.equal(first.generated, 2); // steps 1 and 6
  assert.equal(first.cached, 0);
  assert.equal(first.failed, 1);
  assert.equal(first.failures[0].stepId, "s2");
  assert.equal(speechCalls, 4); // two good lines, plus the broken one tried twice
  assert.ok(Math.abs((first.totalCost ?? 0) - 0.002) < 1e-9);

  const steps = JSON.parse(fs.readFileSync(path.join(job, "steps.json"), "utf8")).steps;
  assert.equal(steps[0].audioFile, "audio/s1.mp3");
  assert.equal(steps[0].audioSeconds, 1.306); // 50 frames, rounded to milliseconds
  assert.ok(fs.existsSync(path.join(job, "audio/s1.mp3")));
  // Failed, deadend, hidden and silent steps all stay without audio.
  for (const index of [1, 2, 3, 4]) assert.equal(steps[index].audioFile, null);

  // Second run: both good lines come from the cache, only the broken one is retried.
  speechCalls = 0;
  const second = await generateVoice(job, { language: "en" });
  assert.equal(second.generated, 0);
  assert.equal(second.cached, 2);
  assert.equal(speechCalls, 2);

  // A different voice is a different cache entry.
  const other = await generateVoice(job, { language: "en", voice: "george" });
  assert.equal(other.generated, 2);

  // Unknown languages are refused before anything is generated.
  await assert.rejects(generateVoice(job, { language: "xx" }), /not set up/);

  fs.rmSync(temp, { recursive: true, force: true });
  console.log("voice check passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
