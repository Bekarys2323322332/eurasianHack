/**
 * Tiny job store backed by SQLite (better-sqlite3, synchronous API).
 *
 * The database file lives at <DATA_DIR>/app.db. Job output files (step file,
 * screenshots, audio, videos) live next to it under <DATA_DIR>/jobs/<jobId>/.
 *
 * This module must only be imported from server code (API routes, the
 * pipeline, CLI scripts), never from client components.
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { JobMode } from "./stepFile";

/** Every stage a job moves through, in order. "failed" can happen at any point. */
export const JOB_STATUSES = [
  "queued",
  "planning",
  "running",
  "scripting",
  "voicing",
  "rendering",
  "done",
  "failed",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Job {
  id: string;
  mode: JobMode;
  url: string;
  repoUrl: string | null;
  goal: string | null;
  language: string;
  status: JobStatus;
  /** Plain-words message shown in the progress view, e.g. "Exploring the site". */
  progressMessage: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface NewJob {
  mode: JobMode;
  url: string;
  repoUrl?: string | null;
  goal?: string | null;
  language?: string;
}

/** Root folder for all runtime data. Defaults to ./data. */
export function getDataDir(): string {
  return path.resolve(process.env.DATA_DIR || "./data");
}

/** Folder that holds every file produced for one job. */
export function getJobDir(jobId: string): string {
  return path.join(getDataDir(), "jobs", jobId);
}

// One shared connection per process. Next.js dev mode reloads modules, so we
// keep the handle on globalThis to avoid opening a new connection each time.
const globalForDb = globalThis as unknown as { __jobsDb?: Database.Database };

/** Open (and if needed create) the database and the jobs table. */
export function getDb(): Database.Database {
  if (globalForDb.__jobsDb) return globalForDb.__jobsDb;

  const dataDir = getDataDir();
  fs.mkdirSync(path.join(dataDir, "jobs"), { recursive: true });

  const db = new Database(path.join(dataDir, "app.db"));
  // WAL lets the web app read while the pipeline writes.
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
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

  globalForDb.__jobsDb = db;
  return db;
}

/** Create a new job in the "queued" state and return it. */
export function createJob(input: NewJob): Job {
  const job: Job = {
    id: randomUUID().replace(/-/g, "").slice(0, 12),
    mode: input.mode,
    url: input.url,
    repoUrl: input.repoUrl ?? null,
    goal: input.goal ?? null,
    language: input.language ?? "en",
    status: "queued",
    progressMessage: "Waiting to start",
    createdAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `INSERT INTO jobs (id, mode, url, repoUrl, goal, language, status, progressMessage, createdAt)
       VALUES (@id, @mode, @url, @repoUrl, @goal, @language, @status, @progressMessage, @createdAt)`,
    )
    .run(job);

  return job;
}

/** Read one job, or null if it does not exist. */
export function getJob(id: string): Job | null {
  const row = getDb().prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as Job | undefined;
  return row ?? null;
}

/** List jobs, newest first. Optionally filter by status. */
export function listJobs(options: { status?: JobStatus; limit?: number } = {}): Job[] {
  const limit = options.limit ?? 50;
  if (options.status) {
    return getDb()
      .prepare(`SELECT * FROM jobs WHERE status = ? ORDER BY createdAt DESC LIMIT ?`)
      .all(options.status, limit) as Job[];
  }
  return getDb().prepare(`SELECT * FROM jobs ORDER BY createdAt DESC LIMIT ?`).all(limit) as Job[];
}

/** Fields that may change after a job is created. */
export type JobUpdate = Partial<Pick<Job, "status" | "progressMessage" | "goal" | "language">>;

/** Update a job and return the new version, or null if it does not exist. */
export function updateJob(id: string, changes: JobUpdate): Job | null {
  const allowed = ["status", "progressMessage", "goal", "language"] as const;
  const keys = allowed.filter((key) => changes[key] !== undefined);
  if (keys.length > 0) {
    const assignments = keys.map((key) => `${key} = @${key}`).join(", ");
    const values: Record<string, unknown> = { id };
    for (const key of keys) values[key] = changes[key];
    getDb().prepare(`UPDATE jobs SET ${assignments} WHERE id = @id`).run(values);
  }
  return getJob(id);
}
