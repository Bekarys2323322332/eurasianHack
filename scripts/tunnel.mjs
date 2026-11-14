/**
 * Open a Cloudflare quick tunnel to the local app and announce its public URL.
 */
import { spawn } from "node:child_process";

// The demo command always starts Next.js on port 3000.
const url = "http://localhost:3000";
const verbose = process.argv.includes("--verbose");

// Warn if the local app is not ready, but still let cloudflared start.
try {
  await fetch(url, { signal: AbortSignal.timeout(1500) });
} catch {
  console.warn("Warning: Start the app first with npm run demo.");
}

// Keep cloudflared output quiet by default while retaining its URL and errors.
const child = spawn("cloudflared", ["tunnel", "--url", url], {
  stdio: ["inherit", "pipe", "pipe"],
});
let announced = false;
let outputTail = "";
let pendingErrorLine = "";

/** Forward verbose output, surface errors, and announce the first quick-tunnel URL. */
function handleOutput(chunk, stream) {
  const text = chunk.toString();
  if (verbose) stream.write(chunk);
  if (stream === process.stderr && !verbose) {
    const lines = `${pendingErrorLine}${text}`.split(/\r?\n/);
    pendingErrorLine = lines.pop() ?? "";
    const errors = lines.filter((line) => /error|failed|unable|fatal/i.test(line));
    if (errors.length) console.error(errors.join("\n"));
  }

  outputTail = `${outputTail}${text}`.slice(-2048);
  const match = outputTail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (match && !announced) {
    announced = true;
    const publicUrl = match[0];
    console.log(
      [
        "",
        "Public tunnel ready",
        `App: ${publicUrl}`,
        `Health: ${publicUrl}/api/health`,
        `Optional: set PUBLIC_BASE_URL=${publicUrl} in .env and restart npm run demo so copied links use it.`,
        "",
      ].join("\n"),
    );
  }
}

// Parse both output streams because cloudflared may print the URL on either one.
child.stdout.on("data", (chunk) => handleOutput(chunk, process.stdout));
child.stderr.on("data", (chunk) => handleOutput(chunk, process.stderr));

// Translate process errors into readable installation or startup guidance.
child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error("cloudflared is not installed. Install it with:");
    console.error("  macOS: brew install cloudflared");
    console.error("  Windows: winget install --id Cloudflare.cloudflared");
  } else {
    console.error(`Could not start cloudflared: ${error.message}`);
  }
  process.exitCode = 1;
});

// Preserve cloudflared's exit status so tunnel failures are visible to the shell.
child.on("exit", (code, signal) => {
  if (!verbose && /error|failed|unable|fatal/i.test(pendingErrorLine)) {
    console.error(pendingErrorLine);
  }
  if (signal) {
    process.exitCode = 1;
  } else if (code !== 0 && code !== null) {
    process.exitCode = code;
  }
});

// Forward terminal shutdown signals so the child tunnel does not remain orphaned.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
