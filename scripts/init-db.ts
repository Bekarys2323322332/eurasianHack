/**
 * Load local data-directory configuration and create the SQLite database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDataDir, getDb } from "../src/shared/jobs";

// Node 22+ provides loadEnvFile; keep the fallback for runtimes that omit it.
try {
  process.loadEnvFile?.(".env");
} catch {
  // Setup reports malformed or unreadable environment files before this runs.
}

// Read DATA_DIR directly when loadEnvFile is unavailable in the current Node version.
if (process.env.DATA_DIR === undefined) {
  const dataDirLine = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((line) => /^\s*DATA_DIR\s*=/.test(line));
  if (dataDirLine) {
    const value = dataDirLine.slice(dataDirLine.indexOf("=") + 1).trim();
    process.env.DATA_DIR = value.replace(/^(['"])(.*)\1$/, "$2");
  }
}

// Opening the shared database initializes its schema before reporting its path.
getDb();
console.log(path.join(getDataDir(), "app.db"));
