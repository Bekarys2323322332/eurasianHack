/**
 * POST /api/jobs creates a job and puts it in the queue.
 *
 * Body: { mode: "demo" | "howto", url, repoUrl?, goal?, language? }
 * Reply: 201 { id } or 400 { error } with a plain sentence for the form.
 */
import { z } from "zod";
import { createJob } from "../../../shared/jobs";
import { JOB_MODES } from "../../../shared/stepFile";
import { enqueueJob } from "../../_lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only real web addresses: http or https with a host. */
const webAddress = z
  .string()
  .trim()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
    } catch {
      return false;
    }
  });

const bodySchema = z.object({
  mode: z.enum(JOB_MODES).default("demo"),
  url: webAddress,
  repoUrl: z.string().trim().optional().nullable(),
  goal: z.string().trim().max(500).optional().nullable(),
  language: z.string().trim().min(2).max(10).default("en"),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "The form could not be read. Please try again." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error =
      field === "url"
        ? "That does not look like a web address. It should start with https:// like https://example.com"
        : "Something in the form is not right. Check the fields and try again.";
    return Response.json({ error }, { status: 400 });
  }

  const { mode, url, language } = parsed.data;
  const repoUrl = parsed.data.repoUrl || null;
  const goal = parsed.data.goal || null;

  if (repoUrl && !webAddress.safeParse(repoUrl).success) {
    return Response.json(
      { error: "The repository link is not a web address. Use one like https://github.com/owner/repo, or leave it empty." },
      { status: 400 },
    );
  }
  if (mode === "howto" && !goal) {
    return Response.json(
      { error: "Tell us what the video should show, for example: How to create a new project." },
      { status: 400 },
    );
  }

  const job = createJob({ mode, url: new URL(url).toString(), repoUrl, goal, language });
  enqueueJob(job.id);
  return Response.json({ id: job.id }, { status: 201 });
}
