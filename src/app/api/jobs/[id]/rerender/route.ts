/**
 * POST /api/jobs/[id]/rerender
 * Body: { aspect?: "16:9" | "9:16", edits?: [{ id, hidden?, narration?, caption? }] }
 * Saves the edits and queues voice and render again. The agent does not run.
 */
import { getJob, getJobDir, updateJob } from "../../../../../shared/jobs";
import { isJobId } from "../../../../_lib/jobView";
import { enqueueJob, isQueueFull } from "../../../../_lib/pipeline";
import { RerenderError, rerenderRequestSchema, writeRerenderRequest } from "../../../../_lib/rerender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = isJobId(id) ? getJob(id) : null;
  if (!job) return Response.json({ error: "We could not find that video." }, { status: 404 });
  if (job.status !== "done") {
    return Response.json({ error: "Wait until this video is finished before changing it." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The request was not valid JSON." }, { status: 400 });
  }
  const parsed = rerenderRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Those edits could not be read." }, { status: 400 });

  if (isQueueFull()) {
    return Response.json(
      { error: "Too many videos are being made right now. Please try again in a few minutes." },
      { status: 503 },
    );
  }

  try {
    // Only one format is rebuilt; the other is removed once the new render succeeds,
    // so it cannot show the old steps and the original survives a failed render.
    const rebuilt = parsed.data.aspect ?? (job.style === "social" ? "9:16" : "16:9");
    const stale = rebuilt === "9:16" ? "video-16x9.mp4" : "video-9x16.mp4";
    const changed = writeRerenderRequest(getJobDir(id), parsed.data, { removeAfter: stale });
    updateJob(id, { status: "voicing", progressMessage: "Recording the voice" });
    enqueueJob(id);
    return Response.json({ ok: true, changed });
  } catch (error) {
    const message = error instanceof RerenderError ? error.message : "We could not save those edits.";
    return Response.json({ error: message }, { status: 400 });
  }
}
