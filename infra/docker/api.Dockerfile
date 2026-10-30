FROM node:24.22.1-alpine AS build
WORKDIR /src
# pnpm is not named here: Corepack reads `packageManager` from package.json, so the image uses the
# same pnpm the repository does. A pin written in this file went stale (it said 10.30.2 while the
# repository moved to 11) and was a second place to keep in step.
RUN corepack enable
COPY . .
# `<package>...` builds the package and everything it depends on, in dependency order, so the
# list cannot fall behind the code. A hand-written list did: it omitted @lupin/projects and the
# image never built. `deploy --prod` then writes the package, its built workspace dependencies and
# its production `node_modules` to /out — no Vitest, no ESLint, no TypeScript, no sources of other
# packages. `--legacy` is pnpm 11's deploy without `inject-workspace-packages`.
RUN pnpm install --frozen-lockfile \
  && pnpm --filter "@lupin/api..." build \
  && pnpm --filter "@lupin/api" --prod deploy --legacy /out


FROM node:24.22.1-alpine AS runtime
ARG LUPIN_VERSION=dev
ARG LUPIN_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Sergey-Bar/Lupin" \
  org.opencontainers.image.title="lupin-api" \
  org.opencontainers.image.version="${LUPIN_VERSION}" \
  org.opencontainers.image.revision="${LUPIN_REVISION}"
WORKDIR /app
COPY --from=build --chown=node:node /out ./
ENV NODE_ENV=production
ENV HOST=0.0.0.0
# The artifact volume mounts here. It must be owned by `node` (uid 1000), or every artifact
# write fails at runtime — the defect `runner.Dockerfile` had already fixed for itself.
RUN mkdir -p /var/lib/lupin/artifacts \
  && chown -R node:node /var/lib/lupin
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# `--import` preloads the Sentry SDK ahead of the module graph. Node re-runs
# `--require` preloads on its module loader thread, so the SDK would never reach
# the application; `--import` is the only form v11 supports.
CMD ["node", "--import", "./dist/instrument.js", "dist/index.js"]
