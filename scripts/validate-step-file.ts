/**
 * Validate a step file from the command line.
 * Usage: npx tsx scripts/validate-step-file.ts path/to/steps.json
 */
import fs from "node:fs";
import { validateStepFile } from "../src/shared/stepFile";

const file = process.argv[2];
if (!file) {
  console.error("Usage: tsx scripts/validate-step-file.ts <steps.json>");
  process.exit(1);
}

const result = validateStepFile(JSON.parse(fs.readFileSync(file, "utf8")));
if (result.ok) {
  console.log(`Valid step file: ${result.stepFile.steps.length} steps`);
} else {
  console.error(`Invalid step file:\n  ${result.errors.join("\n  ")}`);
  process.exit(1);
}
