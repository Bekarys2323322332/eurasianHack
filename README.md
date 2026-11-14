# eurasianHack

Agent-made cinematic product videos. Built with Devin at the Eurasian Hub x
Cognition hackathon.

> We send an AI agent to use your product like a first-time visitor. You get a
> cinematic video of what it did, and a report of where it got stuck.

Status: skeleton. The home page shows "Skeleton is live". The agent, the
renderer and the real web app get built next, each in its own folder.

## How it is organised

```
src/app/        web pages and API routes
src/agent/      planner and browser agent (Playwright)
src/renderer/   video builder (Remotion)
src/llm/        model gateway, routing, cache, cost log
src/shared/     step file types and validator, SQLite job store
fixtures/       fake-job: a 5-step step file with placeholder screenshots
data/jobs/      output per job (not committed)
```

The **step file** (`src/shared/stepFile.ts`) is the contract between all
parts. The agent writes it; every later stage only reads or updates it.
`validateStepFile(json)` checks a step file and returns readable errors.

The **job store** (`src/shared/jobs.ts`) keeps jobs in SQLite at
`$DATA_DIR/app.db` with `createJob`, `getJob`, `listJobs` and `updateJob`.
Job statuses: queued, planning, running, scripting, voicing, rendering, done,
failed.

## Run locally

Needs Node.js 22 or newer.

```bash
cp .env.example .env.local   # fill in keys when the AI parts land
npm install
npm run dev                  # http://localhost:3000
```

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Unit tests (step file validation, job store) |
| `npm run validate:fixture` | Validate `fixtures/fake-job/steps.json` |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run build && npm start` | Production build and server |
| `python3 scripts/make-fake-job.py` | Regenerate the fake job (needs Pillow) |

## Deploy

The app drives a real browser and uses ffmpeg, so it needs a host that runs a
Docker container (Railway, Fly.io, Render, a VM). Serverless hosting will not
work.

```bash
docker build -t eurasianhack .
docker run -p 3000:3000 --env-file .env.local -v "$PWD/data:/app/data" eurasianhack
```

The image is based on the official Playwright image (Node.js, Chromium and
browser libraries included) and adds ffmpeg. Mount a persistent volume at
`/app/data` so jobs and videos survive restarts. Set the variables from
`.env.example` in the host's dashboard.
