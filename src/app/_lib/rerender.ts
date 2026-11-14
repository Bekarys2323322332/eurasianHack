/**
 * Edit and re-render: apply the user's edits to the step file, then leave a
 * marker so the pipeline reruns voice and render only. The marker survives a
 * restart, so a resumed job never goes back to the browser agent.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { validateStepFile, type StepFile } from "../../shared/stepFile";

export const rerenderRequestSchema = z.object({
  aspect: z.enum(["16:9", "9:16"]).optional(),
  edits: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        hidden: z.boolean().optional(),
        narration: z.string().max(500).optional(),
        caption: z.string().max(200).optional(),
      }),
    )
    .max(200)
    .default([]),
});

export type RerenderRequest = z.infer<typeof rerenderRequestSchema>;

export interface RerenderMarker {
  aspect?: "16:9" | "9:16";
  /** A video file to delete once the new render succeeds (the other format, now out of date). */
  removeAfter?: string;
}

export class RerenderError extends Error {}

const MARKER = "rerender.json";

function readSteps(jobFolder: string): StepFile {
  const file = path.join(jobFolder, "steps.json");
  if (!fs.existsSync(file)) throw new RerenderError("This video has no recorded steps to edit.");
  const parsed = validateStepFile(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.ok) throw new RerenderError("The recorded steps could not be read.");
  return parsed.stepFile;
}

/**
 * Apply edits to steps.json and write the re-render marker.
 * Returns how many steps changed. A changed narration drops the step's audio
 * so the voice stage records that line again (unchanged lines stay cached).
 */
export function writeRerenderRequest(
  jobFolder: string,
  request: RerenderRequest,
  options: { removeAfter?: string } = {},
): number {
  const stepFile = readSteps(jobFolder);
  const byId = new Map(request.edits.map((edit) => [edit.id, edit]));
  let changed = 0;

  for (const step of stepFile.steps) {
    const edit = byId.get(step.id);
    if (!edit) continue;
    let touched = false;
    if (edit.hidden !== undefined && edit.hidden !== step.hidden) {
      step.hidden = edit.hidden;
      touched = true;
    }
    if (edit.narration !== undefined && edit.narration.trim() !== (step.narration ?? "").trim()) {
      step.narration = edit.narration.trim() || null;
      step.audioFile = null;
      step.audioSeconds = null;
      touched = true;
    }
    if (edit.caption !== undefined && edit.caption.trim() !== (step.caption ?? "").trim()) {
      step.caption = edit.caption.trim() || null;
      touched = true;
    }
    if (touched) changed += 1;
  }

  if (!stepFile.steps.some((step) => step.status === "ok" && !step.hidden)) {
    throw new RerenderError("At least one step has to stay in the video.");
  }

  fs.writeFileSync(path.join(jobFolder, "steps.json"), `${JSON.stringify(stepFile, null, 2)}\n`);
  const marker: RerenderMarker = {
    ...(request.aspect ? { aspect: request.aspect } : {}),
    ...(changed > 0 && options.removeAfter ? { removeAfter: options.removeAfter } : {}),
  };
  fs.writeFileSync(path.join(jobFolder, MARKER), `${JSON.stringify(marker)}\n`);
  return changed;
}

/** The pending re-render for a job folder, if any. */
export function readRerenderMarker(jobFolder: string): RerenderMarker | null {
  const file = path.join(jobFolder, MARKER);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as RerenderMarker;
    return {
      aspect: parsed.aspect === "9:16" || parsed.aspect === "16:9" ? parsed.aspect : undefined,
      removeAfter: /^video-(16x9|9x16)\.mp4$/.test(parsed.removeAfter ?? "") ? parsed.removeAfter : undefined,
    };
  } catch {
    return {};
  }
}

export function clearRerenderMarker(jobFolder: string): void {
  fs.rmSync(path.join(jobFolder, MARKER), { force: true });
}
