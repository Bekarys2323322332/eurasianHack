import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

// Point the store at a throwaway folder before it is imported.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-test-"));
process.env.DATA_DIR = dataDir;
const legacyDb = new Database(path.join(dataDir, "app.db"));
legacyDb.exec(`
  CREATE TABLE jobs (
    id              TEXT PRIMARY KEY,
    mode            TEXT NOT NULL,
    url             TEXT NOT NULL,
    repoUrl         TEXT,
    goal            TEXT,
    language        TEXT NOT NULL DEFAULT 'en',
    status          TEXT NOT NULL DEFAULT 'queued',
    progressMessage TEXT,
    createdAt       TEXT NOT NULL
  )
`);
legacyDb.close();
const { createJob, getDb, getJob, listJobs, updateJob } = await import("../src/shared/jobs");

describe("job store", () => {
  it("creates, updates and reads a job", () => {
    const columns = getDb().pragma("table_info(jobs)") as { name: string }[];
    expect(columns.map(({ name }) => name)).toContain("style");

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

  it("uses mode defaults and preserves an explicit social style", () => {
    const demo = createJob({ mode: "demo", url: "https://example.com" });
    const howto = createJob({ mode: "howto", url: "https://example.com" });
    const social = createJob({ mode: "demo", style: "social", url: "https://example.com" });

    expect(demo.style).toBe("trailer");
    expect(howto.style).toBe("tutorial");
    expect(social.style).toBe("social");

    getDb().prepare("UPDATE jobs SET style = NULL WHERE id = ?").run(demo.id);
    expect(getJob(demo.id)?.style).toBe("trailer");
  });
});
