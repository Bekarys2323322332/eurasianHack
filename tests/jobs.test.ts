import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Point the store at a throwaway folder before it is imported.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-test-"));
const { createJob, getJob, listJobs, updateJob } = await import("../src/shared/jobs");

describe("job store", () => {
  it("creates, updates and reads a job", () => {
    const job = createJob({ mode: "howto", url: "https://example.com", goal: "Create an invoice" });
    expect(job.status).toBe("queued");
    expect(getJob(job.id)?.goal).toBe("Create an invoice");

    const updated = updateJob(job.id, { status: "planning", progressMessage: "Exploring the site" });
    expect(updated?.status).toBe("planning");
    expect(updated?.progressMessage).toBe("Exploring the site");
    expect(listJobs().map((j) => j.id)).toContain(job.id);
  });

  it("returns null for a missing job", () => {
    expect(getJob("nope")).toBeNull();
  });
});
