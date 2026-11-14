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

## Run on your laptop

The app can run on macOS or Windows and be shared through a temporary public
tunnel. Keep the laptop plugged in and awake while the app is being used.

### macOS

If needed, install Homebrew from [brew.sh](https://brew.sh/), then install
Node.js, ffmpeg and cloudflared:

```bash
brew install node@22 ffmpeg cloudflared
brew link --force --overwrite node@22
```

Node.js 22 is keg-only in Homebrew, so the forced link makes `node` and `npm`
available in the terminal. Alternatively, install Node.js 22 using nvm or the
installer from [nodejs.org](https://nodejs.org/).

```bash
git clone https://github.com/Bekarys2323322332/eurasianHack.git
cd eurasianHack
npm run setup
```

Edit `.env` and fill in the four required values shown in `.env.example`.
`TTS_API_KEY` is optional for now; without it, videos have no voiceover. Start
the app:

```bash
npm run demo
```

In a second terminal, from the same repository directory, start the tunnel:

```bash
npm run tunnel
```

In a third terminal, keep the laptop awake with `caffeinate -dimsu` (press
Ctrl+C to stop it). Keep the lid open and the laptop plugged in.

### Windows (PowerShell)

Install Node.js, ffmpeg and cloudflared, then reopen PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
winget install --id Cloudflare.cloudflared
```

```powershell
git clone https://github.com/Bekarys2323322332/eurasianHack.git
cd eurasianHack
npm run setup
```

Edit `.env` and fill in the four required values shown in `.env.example`.
`TTS_API_KEY` is optional for now; without it, videos have no voiceover. Start
the app:

```powershell
npm run demo
```

In a second PowerShell window, from the same repository directory, start the
tunnel:

```powershell
npm run tunnel
```

To keep the laptop awake while plugged in, run these commands in an
administrator PowerShell window:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
```

Restore 30-minute timeouts with `powercfg /change standby-timeout-ac 30` and
`powercfg /change monitor-timeout-ac 30`, or change the settings under
**Settings > System > Power**. Keep the lid open.

### Check the public link

Copy the tunnel link printed by `npm run tunnel` into a browser and add
`/api/health` to confirm every check is passing. Quick-tunnel links change on
every start. Optionally set `PUBLIC_BASE_URL` in `.env` to the printed
`https://...trycloudflare.com` URL and restart `npm run demo` so future copied
links use the public address. `src/shared/publicUrl.ts` provides helpers for
future share-link call sites.

As an alternative, configure ngrok once with
`ngrok config add-authtoken <token>`, then run `ngrok http 3000`. Set
`PUBLIC_BASE_URL` to the HTTPS URL ngrok prints and restart the app.

Other commands:

| Command | What it does |
|---|---|
| `npm run setup` | Install dependencies and Chromium, create `.env` and initialize SQLite |
| `npm run demo` | Build the production app and start it on port 3000 |
| `npm run tunnel` | Expose the local app through a Cloudflare quick tunnel |
| `npm test` | Unit tests (step file validation, job store) |
| `npm run validate:fixture` | Validate `fixtures/fake-job/steps.json` |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run dev` | Start the app in development mode |
| `python3 scripts/make-fake-job.py` | Regenerate the fake job (needs Pillow) |

## Run the agent alone

After setting the four required model variables in `.env`, run
`npm run agent -- --url https://example.com --goal "Explore the main page"`.
Use `--mode demo --repo https://github.com/owner/repo` to include repository
README context.

## Optional: Docker deployment

The included Dockerfile packages Chromium and ffmpeg. Use a host that runs
Docker (for example, a VM); serverless hosting will not work.

```bash
docker build -t eurasianhack .
docker run -p 3000:3000 --env-file .env -v "$PWD/data:/app/data" eurasianhack
```

Mount a persistent volume at `/app/data` so the SQLite database and job files
survive restarts. Set the variables from `.env.example` in the host's
environment configuration.

## Web app

- `/` home page: pick a mode, paste a link, press Generate. Finished videos show in the gallery.
- `/jobs/<id>` job page: live progress (polls every 2 seconds), then the video with Download and Share, or a plain failure message with Try again.
- `POST /api/jobs` creates a job and queues it. `GET /api/jobs/<id>` returns the job, step file and video links. `GET /api/jobs/<id>/files/<path>` serves job files (supports Range for video).
- Only one job runs at a time; the rest wait in a queue (`src/app/_lib/pipeline.ts`).
- The real browser agent and Remotion renderer are wired through `src/app/_lib/stages.ts`.
