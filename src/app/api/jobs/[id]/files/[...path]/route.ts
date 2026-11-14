/**
 * GET /api/jobs/[id]/files/<path> serves a file from the job folder
 * (videos, screenshots, audio). The data folder is outside public/, so this
 * route is the only way the browser can reach it.
 *
 * Supports HTTP Range requests, which browsers (Safari in particular) need to
 * play and seek videos.
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getJobDir } from "../../../../../../shared/jobs";
import { isJobId } from "../../../../../_lib/jobView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path: parts } = await context.params;
  if (!isJobId(id)) return new Response("Not found", { status: 404 });

  // Resolve inside the job folder and refuse anything that escapes it.
  const jobDir = path.resolve(getJobDir(id));
  const file = path.resolve(jobDir, ...parts.map((part) => decodeURIComponent(part)));
  if (!file.startsWith(jobDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  if (new URL(request.url).searchParams.has("download")) {
    headers["Content-Disposition"] = `attachment; filename="${id}-${path.basename(file)}"`;
  }

  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    // "bytes=-500" means the last 500 bytes.
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
