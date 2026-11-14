# One container that can run the whole pipeline: the Next.js app, Playwright
# (browser agent), Remotion (video renderer) and ffmpeg.
#
# The official Playwright image ships Node.js, Chromium and every system
# library a headless browser needs. Its version must match the "playwright"
# version in package.json.
FROM mcr.microsoft.com/playwright:v1.56.1-noble AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ffmpeg for audio/video work, plus build tools in case better-sqlite3 has no
# prebuilt binary for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# ---- dependencies (cached unless package files change) ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data

# Full node_modules (not only the standalone trace) so CLI tools such as the
# agent and the Remotion renderer can run inside the container too.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/fixtures ./fixtures
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /app/data/jobs
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.js"]
