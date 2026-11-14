const startupCheckScript = `
const checksModule = await import("./src/shared/startupChecks.ts");
const { formatCheckReport, runStartupChecks } = checksModule.default ?? checksModule;
const result = await runStartupChecks();
console.log(JSON.stringify({ result, report: formatCheckReport(result) }));
`;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.SKIP_STARTUP_CHECK === "1") return;

  const { spawnSync } = (eval("require") as NodeRequire)("node:child_process");
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", startupCheckScript],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const output = child.stdout.trim().split(/\r?\n/).at(-1);

  if (child.error || child.status !== 0 || !output) {
    console.error(
      `Startup checks could not run${child.stderr.trim() ? `: ${child.stderr.trim()}` : ""}`,
    );
    process.exit(1);
  }

  let report: {
    result: { ok: boolean; warnings: { name: string }[] };
    report: string;
  };
  try {
    report = JSON.parse(output);
  } catch {
    console.error("Startup checks returned an invalid result.");
    process.exit(1);
  }

  if (!report.result.ok) {
    console.error(report.report);
    process.exit(1);
  }

  for (const warning of report.result.warnings) {
    console.warn(
      `Warning: ${warning.name} is not set. Videos will have no voiceover until you add it to .env.`,
    );
  }

  console.log("Startup check passed");
}
