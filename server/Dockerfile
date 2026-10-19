# Pulled via Google's Docker Hub mirror rather than docker.io directly —
# anonymous pulls from docker.io get rate-limited (429) surprisingly easily
# on shared-IP CI/build hosts. Swap back to node:20-bookworm-slim if you'd
# rather pull from Docker Hub directly and don't hit that.

# --- deps: install dependencies, with a native build toolchain for
# better-sqlite3 in case no prebuilt binary matches this platform ---
FROM mirror.gcr.io/library/node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime: slim image, no build toolchain ---
FROM mirror.gcr.io/library/node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home /app app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Receipts and the SQLite database live here — mount a volume at this path
# so they survive container restarts/redeploys.
RUN mkdir -p /app/data && chown -R app:app /app
VOLUME ["/app/data"]

USER app
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/index.js"]
