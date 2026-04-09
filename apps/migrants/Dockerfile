# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:24-bookworm AS build

WORKDIR /app

# Install dependencies first (layer-cached unless package files change)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and build
# NOTE: No VITE_* ARGs here. Runtime config is fetched from /config.json.
#       The only env var Vite sees is NODE_ENV=production (set automatically).
COPY . .
RUN npm run build

# ── Stage 2: serve ────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy built app
COPY --from=build /app/dist/spa /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy and wire the entrypoint that writes config.json from env vars at startup
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# config.json is generated at container startup — do not COPY a static one here.
# The entrypoint will create /usr/share/nginx/html/config.json from env vars.

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]