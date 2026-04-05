# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for layer caching — source changes won't
# invalidate the npm ci layer unless package-lock.json also changes.
COPY package.json package-lock.json ./

RUN npm ci --legacy-peer-deps

COPY . .

# TypeScript check + Vite build → dist/
RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove the default nginx site config
RUN rm /etc/nginx/conf.d/default.conf

# Replace the main nginx config (not conf.d/) because our file contains
# top-level directives (worker_processes, events, http) that cannot be
# nested inside the base image's http {} block.
COPY nginx/nginx.conf /etc/nginx/nginx.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# Run as the nginx user — master process gets CAP_NET_BIND_SERVICE from
# docker-compose, so it can bind port 80 without running as root.
USER nginx

CMD ["nginx", "-g", "daemon off;"]
