import { formatCheckReport, runStartupChecks } from "./shared/startupChecks";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.SKIP_STARTUP_CHECK === "1") return;

  const result = await runStartupChecks();
  if (!result.ok) {
    console.error(formatCheckReport(result));
    process.exit(1);
  }

  console.log("Startup check passed");
}
