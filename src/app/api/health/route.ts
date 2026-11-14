/**
 * Expose live startup checks without returning environment values or caching
 * results, so tunnel users can inspect the current app readiness.
 */
import { getPublicBaseUrl } from "../../../shared/publicUrl";
import { runStartupChecks } from "../../../shared/startupChecks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Return required-check status, optional warnings, and the configured public URL. */
export async function GET() {
  const result = await runStartupChecks();
  return Response.json(
    {
      ...result,
      publicBaseUrl: getPublicBaseUrl(),
    },
    { status: result.ok ? 200 : 503 },
  );
}
