/** GET /api/jobs/[id] returns the job, its step file and video links. */
import { getJobView } from "../../../_lib/jobView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const view = getJobView(id);
  if (!view) return Response.json({ error: "We could not find that video." }, { status: 404 });
  return Response.json(view);
}
