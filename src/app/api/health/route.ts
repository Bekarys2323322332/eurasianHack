import { getPublicBaseUrl } from "../../../shared/publicUrl";
import { runStartupChecks } from "../../../shared/startupChecks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
