/**
 * Prepare a laptop checkout with dependencies, Chromium, local storage, and
 * an initialized database using only Node.js built-ins.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Fail before installing packages when the current Node runtime is unsupported.
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < 20) {
  console.error(`Node.js 20 or newer is required. Found ${process.versions.node}.`);
  process.exit(1);
}

/** Run one setup command and stop immediately if it cannot complete. */
function run(command, args, label) {
  console.log(label);
  const result = spawnSync(command, args, {
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${command} failed with exit code ${result.status ?? "unknown"}.`);
    if (label.includes("Playwright") && process.platform === "linux") {
      console.error("If Chromium fails to launch, run: npx playwright install-deps chromium");
    }
    process.exit(1);
  }
}

/** Load DATA_DIR from .env on Node versions that provide loadEnvFile. */
function loadEnvFile() {
  try {
    process.loadEnvFile?.(".env");
  } catch (error) {
    console.error(`Could not load .env: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (process.env.DATA_DIR === undefined) {
    const dataDirLine = readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((line) => /^\s*DATA_DIR\s*=/.test(line));
    if (dataDirLine) {
      const value = dataDirLine.slice(dataDirLine.indexOf("=") + 1).trim();
      process.env.DATA_DIR = value.replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

// Install project dependencies first so the Playwright and TypeScript CLIs exist.
run("npm", ["install"], "Installing npm dependencies");
// Install only Chromium; Linux users can install its system dependencies if needed.
run(
  "npx",
  ["playwright", "install", "chromium"],
  "Installing the Playwright Chromium browser",
);

// Preserve a user's existing environment file while creating one for new checkouts.
if (existsSync(".env")) {
  console.log(".env already exists, left unchanged");
} else {
  copyFileSync(".env.example", ".env");
  console.log("Copied .env.example to .env");
}

// Resolve DATA_DIR before creating storage so customized locations are honored.
loadEnvFile();
const dataDir = path.resolve(process.env.DATA_DIR || "./data");
mkdirSync(path.join(dataDir, "jobs"), { recursive: true });
console.log(`Created jobs directory at ${path.join(dataDir, "jobs")}`);

// Initialize SQLite only after dependencies and the configured data directory exist.
run("npx", ["tsx", "scripts/init-db.ts"], "Creating the SQLite database");
console.log("Setup complete. Next: fill in .env, then npm run demo");
