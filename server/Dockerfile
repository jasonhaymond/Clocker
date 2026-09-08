FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src
RUN npm install
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

EXPOSE 3001

# `migrate deploy` only applies committed migrations and never prompts, so it's safe to
# run on every container start (a no-op once the database is already current).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
