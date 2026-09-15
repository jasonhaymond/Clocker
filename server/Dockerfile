# Build context is the MONOREPO ROOT (see docker-compose.prod.yml's `context: .` for the
# `server` service) — this workspace now depends on the sibling `shared` workspace (added
# for the invoice feature's pay calculations), which only resolves with the root
# package.json/package-lock.json and every workspace's package.json present. Same
# reasoning as web/Dockerfile, which already builds this way for the same reason.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY app/package.json app/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
COPY web/package.json web/package.json
RUN npm ci
COPY shared shared
COPY server server
RUN npx prisma generate --schema=server/prisma/schema.prisma
# Compiles server/'s own TypeScript as a build-time type-check (catches a real error
# before it ever reaches a running container) — the compiled dist/ output itself isn't
# what actually runs, see below for why.
RUN npm run build --workspace=server

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
# @clocker/shared resolves via an npm workspace symlink (node_modules/@clocker/shared ->
# ../../shared) — the actual shared/ directory has to physically exist alongside it, not
# just server/'s own files. It's plain TypeScript source, not a separately-compiled
# artifact (unlike server/'s own dist/) — this project deliberately runs the server via
# `tsx` directly rather than plain `node dist/index.js` specifically so shared/'s source
# (also consumed as-is by app/'s Metro and web/'s Vite, with no build step of its own)
# doesn't need a second, server-specific compiled copy just to be importable at runtime.
COPY --from=build /repo/shared ./shared
COPY --from=build /repo/server/src ./server/src
COPY --from=build /repo/server/prisma ./server/prisma
COPY --from=build /repo/server/package.json ./server/package.json
COPY package.json ./

EXPOSE 3001

# `migrate deploy` only applies committed migrations and never prompts, so it's safe to
# run on every container start (a no-op once the database is already current).
CMD ["sh", "-c", "cd server && npx prisma migrate deploy && npx tsx src/index.ts"]
