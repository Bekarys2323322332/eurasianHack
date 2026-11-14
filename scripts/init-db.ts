import { readFileSync } from "node:fs";
import path from "node:path";
import { getDataDir, getDb } from "../src/shared/jobs";

try {
  process.loadEnvFile?.(".env");
} catch {
  // Setup reports malformed or unreadable environment files before this runs.
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

getDb();
console.log(path.join(getDataDir(), "app.db"));
