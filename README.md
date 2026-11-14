# eurasianHack

**Send an AI agent to use your product like a first-time visitor. You get a
cinematic video of what it did, and a report of where it got stuck.**

Paste a link. A browser agent explores your app the way a stranger would,
narrates what it does, and comes back with a trailer-style video, a plain-language
list of things to fix, and a cost receipt that shows how cheap the run was.

Built in one day at the Eurasian Hub x Cognition hackathon.

![A finished job: the video, the findings, the steps and the cost](docs/job-page.png)

## Try it in two minutes

1. Open the app, keep **Demo** mode, paste `https://the-internet.herokuapp.com/`
   and press **Generate**.
2. Watch the progress view: exploring the site, writing the script, recording
   the voice, building the video. About two minutes.
3. On the finished page: play the video, click a step to jump to it, read the
   **things to fix**, open the **Cost** panel, then press **Make another
   language** to get the same video in Russian without exploring the site again.

For a how-to, switch to **How-to** mode and give a goal, for example
`calculate 15 percent of 240` on `https://www.calculator.net/percentage-calculator.html`.
The agent types 15 and 240, presses Calculate, reads **36** off the page and
stops, and the video says so.

## What you get

| On the job page | What it is |
|---|---|
| **Video** | Landscape or vertical, narrated, captioned, with zooms on each click, sound effects and music. Download or share. |
| **Result** | For how-to jobs, the answer the agent reached (`Result: 15% of 240 = 36`). |
| **Steps** | Every step with its screenshot, the action in plain words, the agent's reason and any dead end. Click to seek. Press **Edit** to hide steps or reword lines, then **Re-render**. |
| **Things to fix** | Usability findings written for a non-technical reader, most serious first, duplicates merged, console noise removed. |
| **Cost** | What this video cost, what it would have cost with the strongest model everywhere, the percentage saved, and a **Savings forecast** at any monthly volume. |
| **Another language / audience** | Rerun only script, voice and render for another language, or make a cut for investors or developers. |
| **Could not complete** | When the goal cannot honestly be reached (login wall, missing feature), the page says so with the steps tried and a **Try again** button. No video is invented. |

## Why it is different

**The agent is honest.** It does not play back a plan blind. After every
action it reads the page again: new error messages, whether anything changed,
whether what it typed is really in the field. A failed step is recorded as a
dead end with the reason, the same action is never repeated, two dead ends in a
row trigger a re-plan, and a goal check decides when to stop. If the goal is
not reached, the job ends as *could not complete*.

**One step file drives everything.** The agent writes `steps.json` (every
step with screenshots, click position, typed text, reason, observed result).
Script, voice, render and findings only read it. That is why "Make another
language" and "Re-render" take a minute instead of five: the browser never
runs again.

**Narration says what really happened.** The script model sees the real typed
text and the observed result for every step, and the last line states the
outcome.

**Cheap by design.** Only planning, scripting and the findings write-up use a
strong model; the dozen "what do I click next" decisions go to a small one.
Every call is logged with its cost and with what the strong model would have
charged, so the saving is measured, not estimated.

## How it works

```
  link (+ goal, repo)
        |
        v
+-----------------+      +----------------------+      +---------------+
| planner (strong)|----->| browser agent (small)|----->|  steps.json   |
| plans the route |      | observe, decide, act,|      |  screenshots  |
+-----------------+      | verify, goal check   |      +-------+-------+
                         +----------------------+              |
                      every later stage only reads and updates the step file
                                                               |
         +-----------------------+-----------------------+-----+----------+
         v                       v                       v                v
+----------------+     +------------------+     +----------------+  +-----------+
| script (strong)|---->| voice (TTS, one  |---->| render         |  | findings  |
| narration and  |     | mp3 per step,    |     | (Remotion +    |  | (strong,  |
| caption per    |     | cached by text)  |     |  ffmpeg, sfx,  |  | plain     |
| step, language |     +------------------+     |  music)        |  | language) |
| and style      |                              +----------------+  +-----------+
+----------------+
```

- `src/agent` plans and explores; `src/shared/stepFile.ts` is the contract;
  `src/findings` writes the report; `src/voice` records lines; `src/renderer`
  builds the video; `src/app` is the Next.js web app and job queue; `src/llm`
  is the only place that talks to a model (schema-checked JSON, retries,
  small-to-strong escalation, cost log).
- Jobs live in SQLite and run one at a time. Everything a job produces is in
  `data/jobs/<id>/`.

## The token cutter, in real numbers

One 12-step demo job on the-internet.herokuapp.com, small model
`deepseek/deepseek-v4.1-flash`, strong model `stepfun/step-5-preview`:

| Stage | Calls | Model | Cost |
|---|---|---|---|
| Planning | 1 | strong | $0.008 |
| Exploring the site | 12 | small | $0.002 (would be $0.033 on the strong model) |
| Writing the script | 1 | strong | $0.005 |
| Writing up what we found | 1 | strong | $0.016 |
| Voice | 1 | TTS | $0.020 |

Model calls: **$0.030** against **$0.061** without routing, **50% saved**.
Whole video with voice: **$0.051**. The Cost panel shows these figures for
every job; the Savings forecast turns them into a monthly number at the volume
you choose.

## Run it on your laptop

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
Narration and voice use the same model gateway configuration. Start the app:

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
Narration and voice use the same model gateway configuration. Start the app:

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
| `npm test` | Unit tests (step file, job store, script, findings, cost, language reuse) |
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

## Add a voice and make the video from the command line

Both steps work on a job folder that already has a `steps.json` (for example
a copy of `fixtures/fake-job`). Run them with `npx tsx <file>` exactly as
shown. This form works in PowerShell, cmd, bash and zsh. Do not use
`npm run voice -- --job ...` or `npm run render -- --job ...` in PowerShell:
it drops the flag names and the command stops with a usage message.

```
npx tsx src/voice/cli.ts --job data/jobs/my-job --language en
npx tsx src/renderer/cli.ts --job data/jobs/my-job --aspect 16:9
```

**Voice** (`src/voice/cli.ts`) turns each step's narration text into
`audio/<stepId>.mp3` and records the length in `steps.json`. It uses
`LLM_API_KEY` and `LLM_BASE_URL` from `.env.local` or `.env`; no other key is
needed. Lines made before are reused from `data/voice-cache` at no cost.

| Option | Values | Default |
|---|---|---|
| `--job` | job folder | required |
| `--language` | `en`, `ru` | `en` |
| `--voice` | `sarah`, `george` | `sarah` |

**Video** (`src/renderer/cli.ts`) writes `video-16x9.mp4` or `video-9x16.mp4`
into the job folder. A step file with `"mode": "howto"` automatically gets
step badges, a "How to ..." title card and a written recap at the end.

| Option | Values | Default |
|---|---|---|
| `--job` | job folder | required |
| `--aspect` | `16:9`, `9:16` | `9:16` for the social style, otherwise `16:9` |
| `--style` | `trailer` (fast, strong zooms), `tutorial` (slow, gentle, pause after each step), `social` (quick cuts, large captions, 30 seconds at most) | `trailer` for demo videos, `tutorial` for how-to videos |
| `--no-music` | leave out `public/music.mp3` even if it exists | music on |

Checks that need no key and no network:
`npx tsx src/renderer/timeline.check.ts` and `npx tsx src/voice/voice.check.ts`.

## Deploy

The included Dockerfile packages Chromium and ffmpeg. Use a host that runs
Docker (for example, a VM); serverless hosting will not work.

```bash
docker build -t eurasianhack .
docker run -p 3000:3000 --env-file .env -v "$PWD/data:/app/data" eurasianhack
```

Mount a persistent volume at `/app/data` so the SQLite database and job files
survive restarts. Set the variables from `.env.example` in the host's
environment configuration.

## Known limits

- One job at a time, about 1.5 to 4 minutes each, and at most 10 waiting.
- The agent is blocked from local and private network addresses, so it cannot
  test an app that only runs on your machine. Put it behind a tunnel first.
- Sites that need a login, a CAPTCHA or an email code end as "could not
  complete".
- Links that open a new tab are opened in the same tab instead.
- A planner call can occasionally come back malformed twice and the job stops
  with a plain message. Try again works.
- There are no accounts: anyone with a share link can see, edit and re-render
  that video. Fine for a demo, not for production.
- The Docker image serves the web app but does not render videos yet; run on a
  laptop for the demo.

## How we built it with AI

### Tools used

### What worked

### Where it helped

### Where it failed
