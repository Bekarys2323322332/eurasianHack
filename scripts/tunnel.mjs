import { spawn } from "node:child_process";

const port = process.env.PORT || "3000";
const url = `http://localhost:${port}`;
const verbose = process.argv.includes("--verbose");

try {
  await fetch(url, { signal: AbortSignal.timeout(1500) });
} catch {
  console.warn("Warning: Start the app first with npm run demo.");
}

const child = spawn("cloudflared", ["tunnel", "--url", url], {
  stdio: ["inherit", "pipe", "pipe"],
});
let announced = false;
let outputTail = "";
let pendingErrorLine = "";

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

child.stdout.on("data", (chunk) => handleOutput(chunk, process.stdout));
child.stderr.on("data", (chunk) => handleOutput(chunk, process.stderr));
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

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
