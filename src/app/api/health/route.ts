/**
 * Expose startup checks without returning environment values; briefly cache
 * results so public health requests cannot repeatedly launch Chromium.
 */
import { getPublicBaseUrl } from "../../../shared/publicUrl";
import { runStartupChecks } from "../../../shared/startupChecks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STARTUP_CHECK_CACHE_MS = 15_000;
type StartupCheckResult = Awaited<ReturnType<typeof runStartupChecks>>;

let cachedResult: StartupCheckResult | undefined;
let cachedAt = 0;
let checksInFlight: Promise<StartupCheckResult> | undefined;

/**
 * Share an active check between requests and reuse its result for fifteen seconds.
 */
async function getStartupCheckResult(): Promise<StartupCheckResult> {
  if (cachedResult && Date.now() - cachedAt < STARTUP_CHECK_CACHE_MS) {
    return cachedResult;
  }

  if (!checksInFlight) {
    checksInFlight = runStartupChecks();
  }
  const activeCheck = checksInFlight;

  try {
    const result = await activeCheck;
    cachedResult = result;
    cachedAt = Date.now();
    return result;
  } finally {
    if (checksInFlight === activeCheck) {
      checksInFlight = undefined;
    }
  }
}

/** Return required-check status, optional warnings, and the configured public URL. */
export async function GET() {
  const result = await getStartupCheckResult();
  return Response.json(
    {
      ...result,
      publicBaseUrl: getPublicBaseUrl(),
    },
    { status: result.ok ? 200 : 503 },
  );
}
