# Build context is the MONOREPO ROOT (see docker-compose.prod.yml's `context: .` for the
# `web` service), not web/ alone — unlike server/Dockerfile, this workspace depends on the
# sibling `shared` workspace via npm workspaces, which only resolves with the root
# package.json/package-lock.json and every workspace's package.json present.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY app/package.json app/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY web/package.json web/package.json
RUN npm ci
COPY shared shared
COPY web web
# Vite inlines VITE_* variables at build time, same as EAS baking in EXPO_PUBLIC_* (see
# docs/deployment.md's "How EXPO_PUBLIC_API_URL gets into a real build") — there's no
# web/.env inside this build, so it has to come in as a build arg instead.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build --workspace=web

# The build output is a handful of static files — no Node runtime needed to serve them.
# Reusing Caddy (already the project's one reverse-proxy dependency, see the root
# Caddyfile) instead of introducing nginx as a second proxy technology just for this.
FROM caddy:2-alpine
COPY --from=build /repo/web/dist /srv
COPY web/Caddyfile /etc/caddy/Caddyfile
