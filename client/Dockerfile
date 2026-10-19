# Pulled via Google's Docker Hub mirror rather than docker.io directly —
# anonymous pulls from docker.io get rate-limited (429) surprisingly easily
# on shared-IP CI/build hosts. Swap back to the docker.io image names if
# you'd rather pull from Docker Hub directly and don't hit that.

# --- build: compile the Vite/React app ---
FROM mirror.gcr.io/library/node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# No VITE_API_URL here on purpose — the app falls back to relative '/api'
# requests, which nginx below proxies to the API container. That keeps the
# auth cookie same-origin instead of fighting cross-site SameSite rules.
RUN npm run build

# --- runtime: serve the static build + proxy /api to the server container ---
FROM mirror.gcr.io/library/nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O - http://localhost/ >/dev/null || exit 1
