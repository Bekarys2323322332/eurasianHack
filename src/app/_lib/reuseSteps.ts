/**
 * "Make another language" reuses a finished job's steps instead of running
 * the agent again: the step file and screenshots are copied, and narration,
 * captions and audio are cleared so the script and voice stages run fresh.
 */
import fs from "node:fs";
import path from "node:path";
import { validateStepFile, type StepFile } from "../../shared/stepFile";

export class ReuseStepsError extends Error {}

/** Read a finished job's step file, or explain in plain words why it cannot be reused. */
export function readReusableStepFile(sourceFolder: string): StepFile {
  const file = path.join(sourceFolder, "steps.json");
  if (!fs.existsSync(file)) {
    throw new ReuseStepsError("The original video has no recorded steps to reuse.");
  }
  const parsed = validateStepFile(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.ok) {
    throw new ReuseStepsError("The original video's steps could not be read.");
  }
  if (parsed.stepFile.goalAchieved === false) {
    throw new ReuseStepsError("The original run did not complete, so there is nothing to translate.");
  }
  return parsed.stepFile;
}

/** Copy steps and screenshots into a new job folder, ready for script, voice and render. */
export function copyStepsForNewJob(
  sourceFolder: string,
  targetFolder: string,
  jobId: string,
  language: string,
): StepFile {
  const source = readReusableStepFile(sourceFolder);
  const stepFile: StepFile = {
    ...source,
    jobId,
    language,
    steps: source.steps.map((step) => ({
      ...step,
      narration: null,
      caption: null,
      audioFile: null,
      audioSeconds: null,
    })),
  };

  fs.mkdirSync(targetFolder, { recursive: true });
  for (const step of source.steps) {
    for (const relative of [step.screenshotBefore, step.screenshotAfter]) {
      const from = path.join(sourceFolder, relative);
      if (!fs.existsSync(from)) continue;
      const to = path.join(targetFolder, relative);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
  const findings = path.join(sourceFolder, "findings.json");
  if (fs.existsSync(findings)) fs.copyFileSync(findings, path.join(targetFolder, "findings.json"));

  fs.writeFileSync(path.join(targetFolder, "steps.json"), `${JSON.stringify(stepFile, null, 2)}\n`);
  return stepFile;
}
