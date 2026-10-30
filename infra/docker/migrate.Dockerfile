FROM node:24.22.1-alpine AS build
WORKDIR /src
# Corepack reads `packageManager` from package.json, so the image uses the repository's pnpm.
RUN corepack enable
COPY . .
# The migration runner and the SQL it applies: `deploy --prod` keeps `packages/db/drizzle`
# beside `dist/`, which is where `migrationsFolderFor` looks (`../drizzle` from `dist/`).
RUN pnpm install --frozen-lockfile \
  && pnpm --filter "@lupin/db..." build \
  && pnpm --filter "@lupin/db" --prod deploy --legacy /out


# One migration image for both stacks. `db-migrate.Dockerfile` was this file with
# `NODE_ENV=production` added, so the dev and production stacks applied migrations from two
# images that could drift; `NODE_ENV` changes nothing the runner reads.
FROM node:24.22.1-alpine AS runtime
ARG LUPIN_VERSION=dev
ARG LUPIN_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Sergey-Bar/AutoMate" \
  org.opencontainers.image.title="automate-migrate" \
  org.opencontainers.image.version="${LUPIN_VERSION}" \
  org.opencontainers.image.revision="${LUPIN_REVISION}"
WORKDIR /app
COPY --from=build --chown=node:node /out ./
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "dist/migrate.js"]
